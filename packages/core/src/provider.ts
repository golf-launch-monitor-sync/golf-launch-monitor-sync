// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a provider module is (Trackman, the demo, another maker with a cloud account later), and
 * the context it fetches in: every request it makes goes through the load guard, at the plan's pace.
 */

import type { Batch, Reason, Round, Session } from '@glmsync/spec';
import type { Plan } from './api.ts';
import { Cancelled, ProviderBlockedError, ProviderUnavailableError, type Notice } from './errors.ts';
import type { Guard, Sent } from './guard.ts';
import { defaultFetch, exchange, TransportError, type FetchLike } from './http.ts';

/** One sync's worth of what a provider fetched, already in olmd/1. */
export interface Fetched {
  sessions: Session[];
  rounds: Round[];
  /** Sessions the provider couldn't send this time. */
  failed: { external_id: string; started_at?: string }[];
  progress?: NonNullable<Batch['progress']>;
  /** Why the fetch stopped early or left something out. */
  notice?: Notice;
}

export interface Provider<Credential> {
  /** The olmd provider id, e.g. "trackman". */
  readonly id: string;
  /** Shown to the player. */
  readonly name: string;
  /** Shown wherever the provider is named: e.g. "Unofficial; not affiliated with …". */
  readonly notice?: string;
  /** The provider's stable id of the account a sign-in opens, read without asking anyone; null if none. */
  subject(credential: Credential): string | null;
  /**
   * One sync's worth of fetching against a plan. Trouble with the provider as a whole (the sign-in,
   * the connection, the guard) ends the fetch, and what it has so far comes back with a `notice`;
   * only `Cancelled` is thrown.
   */
  fetch(plan: Plan, credential: Credential, ctx: ProviderContext): Promise<Fetched>;
}

export interface HttpAnswer {
  status: number;
  body: string;
  /** How long the provider asked to wait (Retry-After), when it said. */
  retryAfterS: number | null;
}

export interface ProviderContext {
  readonly signal?: AbortSignal;
  /** Why this sync runs: a history chunk (`backfill`) fetches differently from a regular sync. */
  readonly reason: Reason;
  /** ms since the epoch. */
  now(): number;
  /**
   * One request to the provider, through the guard. Answers whatever status the provider sent; no
   * answer at all throws `ProviderBlockedError` (no network, CORS) or `ProviderUnavailableError`
   * (none in time, or too large), a guard limit `GuardLimitError`.
   */
  http(kind: string, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<HttpAnswer>;
  /** Any other kind of request (the demo's), through the guard, answering with a status. */
  guarded<T>(kind: string, send: (signal?: AbortSignal) => Promise<Sent<T>>): Promise<T>;
}

export interface ContextOptions {
  guard: Guard;
  /** The guard's key for this provider account (`guardAccount`). */
  account: string;
  /** The plan's pace (never below 0.5). */
  pace?: number;
  /** Why it runs (default: the player asked). */
  reason?: Reason;
  fetch?: FetchLike;
  signal?: AbortSignal;
  now?: () => number;
}

export function providerContext(opts: ContextOptions): ProviderContext {
  const now = opts.now ?? Date.now;
  let fetchImpl: FetchLike | undefined = opts.fetch;
  const guarded = <T>(kind: string, send: (signal?: AbortSignal) => Promise<Sent<T>>) =>
    opts.guard.request(opts.account, kind, send, {
      ...(opts.pace !== undefined ? { pace: opts.pace } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  return {
    ...(opts.signal ? { signal: opts.signal } : {}),
    reason: opts.reason ?? 'manual',
    now,
    guarded,
    async http(kind, url, init) {
      fetchImpl ??= defaultFetch();
      const f = fetchImpl;
      return guarded(kind, async (signal) => {
        try {
          const x = await exchange(f, url, init, { signal, now });
          return { status: x.status, retryAfterS: x.retryAfterS, value: { status: x.status, body: x.body, retryAfterS: x.retryAfterS } };
        } catch (e) {
          if (e instanceof Cancelled) throw e;
          if (e instanceof TransportError) {
            if (e.kind === 'network') throw new ProviderBlockedError('The provider could not be reached (no network, or this page may not ask it).');
            throw new ProviderUnavailableError(e.kind === 'timeout' ? 'The provider did not answer in time.' : 'The provider sent too much.');
          }
          throw e;
        }
      });
    },
  };
}
