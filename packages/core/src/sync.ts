// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One sync: the target's plan first, every time; the provider only when the plan says so and only
 * through the guard; the batch checked, cut to the target's limits and handed over.
 *
 * Nothing here throws at the caller - a background task must not die of a sync. Every way it ends
 * is an outcome the client can show.
 */

import { FORMAT, type Batch, type Reason } from '@glmsync/spec';
import { addResults, emptyResult, type ClientKind, type ImportResult, type Plan } from './api.ts';
import { clean, split } from './batch.ts';
import { Cancelled, GlmsError, noticeFor, TargetError, type Notice } from './errors.ts';
import { defaultSleep, guardAccount, type Guard } from './guard.ts';
import type { FetchLike } from './http.ts';
import { providerContext, type Fetched, type Provider } from './provider.ts';
import { accountRefOf } from './sha256.ts';
import type { Target } from './target.ts';

export interface SyncOptions<C> {
  target: Target;
  provider: Provider<C>;
  credential: C;
  reason: Reason;
  client: ClientKind;
  guard: Guard;
  /** For the provider's requests (the target brings its own). */
  fetch?: FetchLike;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  generator?: { name: string; version?: string };
}

export type SyncOutcome =
  /** The plan said not now (`wait_s`: for a history chunk, when it may go). */
  | { status: 'not_due'; plan: Plan }
  /** Another client of the player holds the plan's lease. */
  | { status: 'busy'; plan: Plan }
  /** The player ended the connection in the target app: drop the provider sign-in and stop. */
  | { status: 'disconnected' }
  /** The sign-in opens another provider account than the one connected: nothing was asked of the provider. */
  | { status: 'other_account' }
  | {
      status: 'synced';
      result: ImportResult;
      /** Why the fetch stopped early, or what it left out. */
      notice?: Notice;
      /** More is waiting at the provider (the next sync or history chunk brings it). */
      more: boolean;
      parts: number;
      /** Values the schema refused, and items too large for the target, left out. */
      dropped: number;
    }
  | { status: 'failed'; error: GlmsError }
  | { status: 'cancelled' };

/** Retry-After of a target we wait out before handing a part over once more; longer ones end the sync. */
const MAX_TARGET_WAIT_S = 30;

export async function sync<C>(opts: SyncOptions<C>): Promise<SyncOutcome> {
  const now = opts.now ?? Date.now;
  const { target, provider, reason } = opts;
  try {
    // 1. The plan, always first: a request to the target, not to the provider.
    const plan = await target.plan(provider.id, reason, opts.client);
    if (plan.disconnected) return { status: 'disconnected' };
    if (plan.busy) return { status: 'busy', plan };
    if (!plan.due) return { status: 'not_due', plan };

    // 2. Whose account: refused before the provider is asked anything.
    const subject = provider.subject(opts.credential);
    const ref = accountRefOf(target.salt, provider.id, subject ?? '?');
    if (plan.account_ref && plan.account_ref !== ref) return { status: 'other_account' };

    // 3. The fetch, through the guard.
    const account = guardAccount(provider.id, subject);
    let fetched: Fetched;
    try {
      await opts.guard.beginRun(account);
      const ctx = providerContext({
        guard: opts.guard,
        account,
        pace: plan.pace,
        reason,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
        now,
      });
      fetched = await provider.fetch(plan, opts.credential, ctx);
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      // Nothing came (the guard said no before the first request, a provider module failed): the
      // target still hears why, and the lease is released.
      fetched = { sessions: [], rounds: [], failed: [], notice: noticeFor(e, now()) };
    }

    // 4. The batch.
    const batch: Batch = {
      format: FORMAT,
      provider: provider.id,
      account_ref: ref,
      generated_at: new Date(now()).toISOString(),
      ...(opts.generator ? { generator: opts.generator } : {}),
      sync: { ...(plan.plan_id ? { plan_id: plan.plan_id } : {}), reason },
      sessions: fetched.sessions,
      rounds: fetched.rounds,
    };
    if (fetched.failed.length) batch.failed = fetched.failed;
    if (fetched.progress && Object.keys(fetched.progress).length) batch.progress = fetched.progress;
    if (fetched.notice) batch.notice = fetched.notice;
    const { batch: valid, dropped } = clean(batch);
    const { parts, left_out } = split(valid, target.limits);

    // 5. Handed over, part by part.
    let result = emptyResult();
    for (const part of parts) result = addResults(result, await importPart(opts, part, 0));
    const out: SyncOutcome = {
      status: 'synced',
      result,
      more: valid.progress?.more_available === true,
      parts: parts.length,
      dropped: dropped + left_out,
    };
    if (valid.notice) out.notice = valid.notice;
    return out;
  } catch (e) {
    if (e instanceof Cancelled) return { status: 'cancelled' };
    if (e instanceof TargetError && e.code === 'other_account') return { status: 'other_account' };
    if (e instanceof TargetError && e.code === 'disconnected') return { status: 'disconnected' };
    if (e instanceof GlmsError) return { status: 'failed', error: e };
    return { status: 'failed', error: new GlmsError(e instanceof Error ? e.message : String(e)) };
  }
}

async function importPart<C>(opts: SyncOptions<C>, part: Batch, depth: number): Promise<ImportResult> {
  try {
    return await opts.target.import(part);
  } catch (e) {
    if (!(e instanceof TargetError)) throw e;
    // Larger than the target takes after all: in halves, a few times.
    if (e.code === 'too_large' && depth < 4 && part.sessions.length + part.rounds.length > 1) {
      const half = (xs: unknown[]) => Math.ceil(xs.length / 2);
      const { sessions, rounds, failed, progress, notice, sync: s, ...head } = part;
      const first: Batch = { ...head, sessions: sessions.slice(0, half(sessions)), rounds: rounds.slice(0, half(rounds)) } as Batch;
      const second: Batch = { ...head, sessions: sessions.slice(half(sessions)), rounds: rounds.slice(half(rounds)) } as Batch;
      Object.assign(second, failed ? { failed } : {}, progress ? { progress } : {}, notice ? { notice } : {}, s ? { sync: s } : {});
      return addResults(await importPart(opts, first, depth + 1), await importPart(opts, second, depth + 1));
    }
    // A short wait the target asked for: once.
    if (e.code === 'rate_limited' && depth === 0 && e.retryAfterS !== null && e.retryAfterS <= MAX_TARGET_WAIT_S) {
      await (opts.sleep ?? defaultSleep)(e.retryAfterS * 1000, opts.signal);
      return importPart(opts, part, depth + 1);
    }
    throw e;
  }
}
