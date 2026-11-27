// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One sync: the target's plan first, every time; the provider only when the plan says so and only
 * through the guard; the batch checked, cut to the target's limits and handed over.
 *
 * Nothing here throws at the caller - a background task must not die of a sync. Every way it ends
 * is an outcome the client can show.
 *
 * The first sync after connecting hands its sessions over in parts while it still fetches (LMS-AS-6): the target app
 * counts them as they come, where one batch at the end would leave the player staring at a sentence for half a minute.
 * Only the last part says which plan it answers (`sync`, with `failed`, `progress` and `notice`), as when a large batch
 * is split (`split`); a target that stores each part and moves the plan on with the last takes both alike.
 */

import { FORMAT, type Batch, type Reason, type Session, type SignIn } from '@glmsync/spec';
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
  /** Where the client's sign-in stands, told with the plan (1.5.0); a client syncs only when it is `ready`. */
  signin?: SignIn;
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
      /**
       * For a history chunk (`backfill`): how many sessions of the history are still to come (olmd's
       * `progress.sessions_left`), when the provider could tell. A client shows it ("about 140 still to come").
       */
      left?: number;
      /** The plan's `history.older` (since 1.21.0), when it said: false while the history only fills gaps. */
      older?: boolean;
      parts: number;
      /** Values the schema refused, and items too large for the target, left out. */
      dropped: number;
    }
  | { status: 'failed'; error: GlmsError }
  | { status: 'cancelled' };

/** Retry-After of a target we wait out before handing a part over once more; longer ones end the sync. */
const MAX_TARGET_WAIT_S = 30;

/**
 * The first sync after connecting hands a part over once this many sessions have come, or once this long has passed
 * since the last part and one has come (LMS-AS-6). Trackman sends a session every few seconds at a person's pace; the
 * target app reads every 5 s. More parts cost the target a little each (its checks after an import), not the provider.
 */
export const PART_SESSIONS = 2;
export const PART_MS = 5_000;

/** A target's answer to a part that a later try may not get: the part goes with the last one instead. */
const PASSING: ReadonlySet<string> = new Set(['unavailable', 'unreachable', 'rate_limited', 'too_large', 'bad_answer']);

export async function sync<C>(opts: SyncOptions<C>): Promise<SyncOutcome> {
  const now = opts.now ?? Date.now;
  const { target, provider, reason } = opts;
  try {
    // 1. The plan, always first: a request to the target, not to the provider.
    const plan = await target.plan(provider.id, reason, opts.client, opts.signin, provider.can);
    if (plan.disconnected) return { status: 'disconnected' };
    if (plan.busy) return { status: 'busy', plan };
    if (!plan.due) return { status: 'not_due', plan };

    // 2. Whose account: refused before the provider is asked anything.
    const subject = provider.subject(opts.credential);
    const ref = accountRefOf(target.salt, provider.id, subject ?? '?');
    if (plan.account_ref && plan.account_ref !== ref) return { status: 'other_account' };

    // The head every part of this sync carries. Made-up data says so in every batch (and `split` copies it into every
    // part): a target refuses it for a real account.
    const head = () => ({
      format: FORMAT,
      provider: provider.id,
      account_ref: ref,
      generated_at: new Date(now()).toISOString(),
      ...(opts.generator ? { generator: opts.generator } : {}),
      ...(provider.test ? { test: true as const } : {}),
    });
    // The first sync after connecting hands over while it fetches, to a target that takes parts (LMS-AS-6).
    const early = reason === 'connect' && target.takesEarlyParts === true ? new Early(opts, head, now) : null;

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
        ...(early ? { signal: early.signal } : opts.signal ? { signal: opts.signal } : {}),
        ...(early ? { got: early.got } : {}),
        now,
      });
      fetched = await provider.fetch(plan, opts.credential, ctx);
    } catch (e) {
      if (e instanceof Cancelled) {
        // A part the target refused for good stopped the fetch: that is the outcome, not a cancel.
        if (early) throw (await early.settle()) ?? e;
        throw e;
      }
      // Nothing came (the guard said no before the first request, a provider module failed): the
      // target still hears why, and the lease is released.
      fetched = { sessions: [], rounds: [], failed: [], notice: noticeFor(e, now()) };
    }
    if (early) {
      const stop = await early.settle();
      if (stop) throw stop;
      if (opts.signal?.aborted) throw new Cancelled();
    }

    // 4. The batch: what went before in parts left out, the sessions those parts couldn't carry as failed.
    const failed = [...fetched.failed, ...(early?.failed ?? [])];
    const batch: Batch = {
      ...head(),
      sync: { ...(plan.plan_id ? { plan_id: plan.plan_id } : {}), reason },
      sessions: early ? fetched.sessions.filter((s) => !early.taken.has(s.external_id)) : fetched.sessions,
      rounds: fetched.rounds,
    };
    if (failed.length) batch.failed = failed;
    if (fetched.progress && Object.keys(fetched.progress).length) batch.progress = fetched.progress;
    if (fetched.notice) batch.notice = fetched.notice;
    const { batch: valid, dropped } = clean(batch);
    const { parts, left_out } = split(valid, target.limits);

    // 5. Handed over, part by part.
    let result = early?.result ?? emptyResult();
    for (const part of parts) result = addResults(result, await importPart(opts, part, 0));
    const out: SyncOutcome = {
      status: 'synced',
      result,
      more: valid.progress?.more_available === true,
      parts: (early?.parts ?? 0) + parts.length,
      dropped: (early?.dropped ?? 0) + dropped + left_out,
    };
    if (valid.notice) out.notice = valid.notice;
    const left = valid.progress?.sessions_left;
    if (reason === 'backfill' && typeof left === 'number' && Number.isFinite(left) && left >= 0) out.left = left;
    if (typeof plan.history?.older === 'boolean') out.older = plan.history.older;
    return out;
  } catch (e) {
    if (e instanceof Cancelled) return { status: 'cancelled' };
    if (e instanceof TargetError && e.code === 'other_account') return { status: 'other_account' };
    if (e instanceof TargetError && e.code === 'disconnected') return { status: 'disconnected' };
    if (e instanceof GlmsError) return { status: 'failed', error: e };
    return { status: 'failed', error: new GlmsError(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * The parts of a first sync handed over while it fetches (LMS-AS-6). The provider tells each session as it has it
 * (`got`, which never waits for the target); every PART_SESSIONS sessions, or PART_MS after the last part, they go to
 * the target one part after another, behind the fetch. What was handed over (or left out as failed: `failed`) is
 * `taken`, so the last part leaves it out.
 *
 * - A part the target can't take now (`PASSING`: down, unreachable, a long Retry-After) stays with the provider's
 *   `Fetched` and goes with the last part, and so does everything after it: the rest goes on, the target isn't
 *   asked once per session while it is away.
 * - A part the target refuses for good (the player disconnected, another account, the token, test data) stops the
 *   fetch at once - the provider is asked nothing more for a target that won't take it - and is the sync's outcome.
 * - The player's stop (`opts.signal`) stops the fetch as before; what went before stays with the target, and the next
 *   plan names it as known.
 */
class Early<C> {
  readonly taken = new Set<string>();
  readonly failed: { external_id: string; started_at?: string }[] = [];
  result: ImportResult = emptyResult();
  parts = 0;
  dropped = 0;
  private readonly abort = new AbortController();
  private buffer: Session[] = [];
  private chain: Promise<void> = Promise.resolve();
  private last: number;
  private off = false;
  private stop: unknown = null;
  private readonly unlink: () => void;

  constructor(
    private readonly opts: SyncOptions<C>,
    private readonly head: () => Omit<Batch, 'sessions' | 'rounds'>,
    private readonly now: () => number,
  ) {
    this.last = now();
    const outer = opts.signal;
    const onAbort = () => this.abort.abort();
    if (outer?.aborted) this.abort.abort();
    outer?.addEventListener('abort', onAbort, { once: true });
    this.unlink = () => outer?.removeEventListener('abort', onAbort);
  }

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  /** `ProviderContext.got`: never throws, never waits. */
  readonly got = (items: { sessions: Session[] }): void => {
    if (this.off || this.stop) return;
    const sessions = Array.isArray(items?.sessions) ? items.sessions : [];
    for (const s of sessions) if (s && typeof s.external_id === 'string' && !this.taken.has(s.external_id)) this.buffer.push(s);
    if (!this.buffer.length) return;
    if (this.buffer.length < PART_SESSIONS && this.now() - this.last < PART_MS) return;
    const part = this.buffer;
    this.buffer = [];
    this.last = this.now();
    for (const s of part) this.taken.add(s.external_id);
    this.chain = this.chain.then(() => this.send(part));
  };

  /** Waits for the parts under way; the error that refused one for good, if any. Never throws. */
  async settle(): Promise<unknown> {
    await this.chain;
    this.unlink();
    return this.stop;
  }

  private async send(sessions: Session[]): Promise<void> {
    if (this.off || this.stop) return this.giveBack(sessions);
    const sent = new Set<string>();
    try {
      const { batch, dropped } = clean({ ...this.head(), sessions, rounds: [] } as Batch);
      const { parts, left_out } = split(batch, this.opts.target.limits);
      const failed = parts.flatMap((p) => p.failed ?? []);
      for (const { failed: _, ...part } of parts) {
        // What concerns the whole fetch goes with the last part of the sync: here only `failed` can come (a session
        // the schema refused, or too big for a part on its own), and it waits for that.
        if (!part.sessions.length) continue;
        this.result = addResults(this.result, await importPart(this.opts, part as Batch, 0));
        for (const s of part.sessions) sent.add(s.external_id);
        this.parts += 1;
      }
      this.failed.push(...failed);
      this.dropped += dropped + left_out;
    } catch (e) {
      // Only what reached the target stays taken: the rest is in the provider's `Fetched`, for the last part.
      this.giveBack(sessions.filter((s) => !sent.has(s.external_id)));
      if (e instanceof TargetError && PASSING.has(e.code)) {
        // The last part tries them again, and everything after them goes there too.
        this.off = true;
        return;
      }
      this.stop = e instanceof Cancelled ? null : e;
      this.abort.abort();
    }
  }

  /** Sessions a part didn't hand over: the last part carries them (they are in the provider's `Fetched`). */
  private giveBack(sessions: Session[]): void {
    for (const s of sessions) this.taken.delete(s.external_id);
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
