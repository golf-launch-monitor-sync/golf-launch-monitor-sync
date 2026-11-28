// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a provider module is (Trackman, the demo, another maker with a cloud account later), and
 * the context it fetches in: every request it makes goes through the load guard, at the plan's pace.
 *
 * The headers of a request are the module's own (`Content-Type`, `Accept`, `Authorization` for Trackman) and, on a
 * phone, the User-Agent of the browser the player signed in with on that device (`userAgent`: read in the sign-in
 * window, kept beside the sign-in). Nothing else: no cookies, no `Origin`, no `Referer`. A browser client passes none -
 * the browser sends its own.
 */

import type { Batch, Reason, Round, Session } from '@glmsync/spec';
import type { Can, Plan } from './api.ts';
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
  /**
   * Its answers come from a target's test scenario, not from the provider (spec/test-mode.md): every batch a sync
   * makes with it carries `test: true`, so a target keeps the made-up data away from real accounts.
   */
  readonly test?: boolean;
  /** What its fetch can do beyond earlier versions (spec 1.20.0, `can`): named with every plan, so a target plans it. */
  readonly can?: readonly Can[];
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
  /**
   * What the provider has so far, told while it fetches (LMS-AS-6): a session as soon as it is fetched, already in
   * olmd/1. The sync may hand it to the target before the fetch is over (the first sync after connecting, so the target
   * app can count it as it comes); the provider still returns everything in its `Fetched`, and the sync leaves out
   * what went before. Absent, or never called: one hand-over at the end, as before. Never throws and never waits.
   */
  got?(items: { sessions: Session[] }): void;
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
  /** Where the provider tells what it has so far (`ProviderContext.got`). */
  got?: (items: { sessions: Session[] }) => void;
  /**
   * The User-Agent of the browser the player signed in with on this device, kept beside the sign-in: every request to
   * the provider carries it (a phone; `cleanUserAgent` drops anything that is no header value). Absent: none is set.
   */
  userAgent?: string | null;
}

/** The longest User-Agent kept: a phone's web view sends about 150 characters. */
export const MAX_USER_AGENT = 512;

/**
 * A User-Agent as it may go out: printable ASCII only (so no line break can add a header), trimmed, 1-512 characters;
 * anything else null. It was read in a web view's page and is treated as untrusted like everything from there.
 */
export function cleanUserAgent(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= MAX_USER_AGENT && /^[\x20-\x7E]+$/.test(t) ? t : null;
}

/** The module's headers, with the sign-in browser's User-Agent in place of any it set itself. */
function withUserAgent(headers: Record<string, string>, ua: string | null): Record<string, string> {
  if (!ua) return headers;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() !== 'user-agent') out[k] = v;
  out['User-Agent'] = ua;
  return out;
}

type Guarded = ProviderContext['guarded'];

/** `http` of a context: one request through `fetch`, counted and paced by the guard's `guarded`. */
function httpThrough(guarded: Guarded, fetchOf: () => FetchLike, now: () => number, ua: string | null = null): ProviderContext['http'] {
  return (kind, url, init) => {
    const f = fetchOf();
    const sent = { ...init, headers: withUserAgent(init.headers, ua) };
    return guarded(kind, async (signal) => {
      try {
        const x = await exchange(f, url, sent, { signal, now });
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
  };
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
    ...(opts.got ? { got: opts.got } : {}),
    guarded,
    http: httpThrough(guarded, () => (fetchImpl ??= defaultFetch()), now, cleanUserAgent(opts.userAgent)),
  };
}

/**
 * The same context, its provider requests sent through another `fetch` (a test scenario's playback, spec/test-mode.md)
 * - still one at a time through the same guard, at the same pace, with the same limits.
 */
export function withFetch(ctx: ProviderContext, fetchImpl: FetchLike): ProviderContext {
  return { ...ctx, http: httpThrough(ctx.guarded, () => fetchImpl, ctx.now) };
}
