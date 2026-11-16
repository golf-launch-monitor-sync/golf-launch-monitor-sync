// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The load guard (spec/guard.md): the limits a client never exceeds against a provider, whatever a
 * target's plan says - a faulty or hostile target must not be able to make it hammer a provider.
 *
 * Two layers. The pure rules (`checkState`, `startState`, `finishState`, `beginRunState`) are the
 * port of spec/reference/guard.py and answer spec/testvectors/guard.json alike. `Guard` keeps them
 * per provider account in a `Storage`, so the counts outlive a restart, and keeps a log of the last
 * 14 days - time, kind of request, status, duration, never content - that the player can export.
 *
 * There is nothing to switch it off with: the limits come from spec/guard/limits.json and are
 * frozen; no option, plan field or setting reaches them. A request the guard can't count (its
 * storage fails) is not sent.
 */

import { GUARD_LIMITS } from '@glmsync/spec';
import { Cancelled, GuardLimitError, GuardStorageError, type GuardReason } from './errors.ts';
import { base64url, sha256, utf8 } from './sha256.ts';
import { readJson, type Storage } from './storage.ts';

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

/** The limits in force: spec/guard/limits.json, frozen. */
export const LIMITS = deepFreeze(JSON.parse(JSON.stringify(GUARD_LIMITS)) as typeof GUARD_LIMITS);

// ---------------------------------------------------------------------------
// The rules, in seconds on one clock (as the reference and the vectors)
// ---------------------------------------------------------------------------

export interface GuardState {
  /** Every request started within the day window. */
  starts: number[];
  /** Requests in the current sync run. */
  run: number;
  in_flight: boolean;
  last_end: number | null;
  /** Bad answers in a row. */
  streak: number;
  /** Backoff or Retry-After. */
  blocked_until: number | null;
}

export type GuardCheck = { ok: true } | { ok: false; reasons: GuardReason[]; until: number | null };

export function freshState(): GuardState {
  return { starts: [], run: 0, in_flight: false, last_end: null, streak: 0, blocked_until: null };
}

/** An answer that asks for less load: 429, a server error, or none at all (timeout, network). */
export function isBad(status: number): boolean {
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}

export function beginRunState(a: GuardState): GuardState {
  return { ...a, run: 0 };
}

/**
 * {ok: true}, or the reasons (sorted) and `until`, the earliest time all reasons that have one are
 * over (null when none has: `busy` ends with the request in flight, `per_run` with the run).
 */
export function checkState(a: GuardState, now: number): GuardCheck {
  const reasons: GuardReason[] = [];
  const untils: number[] = [];
  const window = (name: GuardReason, most: number, length: number) => {
    const inside = a.starts.filter((s) => now - s < length);
    if (inside.length >= most) {
      reasons.push(name);
      untils.push((inside[inside.length - most] as number) + length);
    }
  };
  if (a.in_flight) reasons.push('busy');
  if (a.blocked_until !== null && now < a.blocked_until) {
    reasons.push('backoff');
    untils.push(a.blocked_until);
  }
  if (a.run >= LIMITS.per_run) reasons.push('per_run');
  window('per_hour', LIMITS.per_hour, LIMITS.hour_window_s);
  window('per_day', LIMITS.per_day, LIMITS.day_window_s);
  if (a.last_end !== null && now < a.last_end + LIMITS.pause_s.min) {
    reasons.push('pause');
    untils.push(a.last_end + LIMITS.pause_s.min);
  }
  if (!reasons.length) return { ok: true };
  return { ok: false, reasons: reasons.sort(), until: untils.length ? Math.max(...untils) : null };
}

export function startState(a: GuardState, now: number): GuardState {
  if (!checkState(a, now).ok) throw new Error('the guard refused this request');
  return {
    ...a,
    in_flight: true,
    run: a.run + 1,
    starts: [...a.starts.filter((s) => now - s < LIMITS.day_window_s), now],
  };
}

/**
 * The request ended with `status` (0: no answer). After a bad one the next waits the backoff (60 s,
 * doubled each time, at most an hour); Retry-After holds whenever it is longer, even past the hour.
 */
export function finishState(a: GuardState, now: number, status: number, retryAfterS: number | null = null): GuardState {
  const out = { ...a, in_flight: false, last_end: now };
  if (!isBad(status)) return { ...out, streak: 0 };
  const streak = a.streak + 1;
  const b = LIMITS.backoff;
  let wait = Math.min(b.max_s, b.first_s * b.factor ** (streak - 1));
  if (retryAfterS !== null && retryAfterS > wait) wait = retryAfterS;
  return { ...out, streak, blocked_until: now + wait };
}

// ---------------------------------------------------------------------------
// The guard a client runs with
// ---------------------------------------------------------------------------

/**
 * The key the guard counts under: per provider and account (the provider's stable id of it, e.g.
 * a sign-in's subject), the same for every target, and hashed so the exported log names nobody. An
 * account whose id can't be read shares one key per provider: counted together, never less.
 */
export function guardAccount(provider: string, subject: string | null): string {
  return `g1_${base64url(sha256(utf8(`glmsync-guard-v1|${provider}|${subject ?? ''}`))).slice(0, 22)}`;
}

/** What a request sent: the provider's status (0 for none) and what the caller wants back. */
export interface Sent<T> {
  status: number;
  retryAfterS?: number | null;
  value: T;
}

export interface GuardOptions {
  storage: Storage;
  /** ms since the epoch. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** In [0, 1): where the pause between requests falls. */
  random?: () => number;
}

export interface GuardCounts {
  run: number;
  hour: number;
  day: number;
  limits: { per_run: number; per_hour: number; per_day: number };
  /** When a backoff or Retry-After ends (RFC 3339), if one holds. */
  blocked_until: string | null;
}

export interface LogEntry {
  at: string;
  kind: string;
  /** The provider's HTTP status; 0: no answer; -1: stopped by the player. */
  status: number;
  ms: number;
}

export interface GuardLogExport {
  format: 'glmsync-guard-log/1';
  exported_at: string;
  limits: typeof GUARD_LIMITS;
  accounts: { account: string; requests: LogEntry[] }[];
}

interface Stored {
  v: 1;
  starts: number[]; // ms
  run: number;
  in_flight_since: number | null;
  last_end: number | null;
  streak: number;
  blocked_until: number | null;
}

/** A request in flight that a crash left marked: busy for at most this long. */
const IN_FLIGHT_STALE_MS = 120_000;
/** A pause the guard waits out itself; anything longer is a limit, said and not waited for. */
const MAX_WAIT_MS = 10_000;
const KIND = /^[a-z][a-z0-9_]{0,31}$/;
const KEY = 'glmsync/guard/';
const LOG_KEY = 'glmsync/guard-log/';
const ACCOUNTS_KEY = 'glmsync/guard-accounts';
const MAX_LOG = LIMITS.per_day * LIMITS.log_days + 100;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): v is number | null => v === null || isNum(v);

function readStored(v: unknown): Stored | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>;
  if (s.v !== 1 || !Array.isArray(s.starts) || !s.starts.every(isNum)) return null;
  if (!isNum(s.run) || !isNum(s.streak) || !numOrNull(s.in_flight_since) || !numOrNull(s.last_end) || !numOrNull(s.blocked_until)) {
    return null;
  }
  return s as unknown as Stored;
}

export const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((done, fail) => {
    if (signal?.aborted) return fail(new Cancelled());
    if (ms <= 0) return done();
    const onAbort = () => {
      clearTimeout(timer);
      fail(new Cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      done();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export class Guard {
  private readonly storage: Storage;
  private readonly now: () => number;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(opts: GuardOptions) {
    this.storage = opts.storage;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.random = opts.random ?? Math.random;
  }

  /** One request at a time per account, in this client; the stored in-flight mark covers others. */
  private async locked<T>(account: string, fn: () => Promise<T>): Promise<T> {
    const before = this.locks.get(account) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((done) => (release = done));
    const chain = before.then(() => mine);
    this.locks.set(account, chain);
    await before;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(account) === chain) this.locks.delete(account);
    }
  }

  private async load(account: string): Promise<Stored> {
    let raw: unknown;
    try {
      raw = await readJson(this.storage, KEY + account);
    } catch (e) {
      throw new GuardStorageError(`The guard's counts could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (raw === null) return { v: 1, starts: [], run: 0, in_flight_since: null, last_end: null, streak: 0, blocked_until: null };
    const stored = readStored(raw);
    if (stored) return stored;
    // Counts that can't be read can't be trusted to be low: a day's pause, then afresh.
    const now = this.now();
    return { v: 1, starts: [], run: 0, in_flight_since: null, last_end: null, streak: 0, blocked_until: now + LIMITS.day_window_s * 1000 };
  }

  private async save(account: string, s: Stored): Promise<void> {
    try {
      await this.storage.set(KEY + account, JSON.stringify(s));
    } catch (e) {
      throw new GuardStorageError(`The guard's counts could not be kept: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private toState(s: Stored, now: number): GuardState {
    return {
      starts: s.starts.map((t) => t / 1000),
      run: s.run,
      in_flight: s.in_flight_since !== null && now - s.in_flight_since < IN_FLIGHT_STALE_MS && now >= s.in_flight_since,
      last_end: s.last_end === null ? null : s.last_end / 1000,
      streak: s.streak,
      blocked_until: s.blocked_until === null ? null : s.blocked_until / 1000,
    };
  }

  private fromState(a: GuardState, inFlightSince: number | null): Stored {
    // Not rounded: a pause measured from a rounded end could fall short of the minimum by a fraction.
    const ms = (t: number) => t * 1000;
    return {
      v: 1,
      starts: a.starts.map(ms),
      run: a.run,
      in_flight_since: inFlightSince,
      last_end: a.last_end === null ? null : ms(a.last_end),
      streak: a.streak,
      blocked_until: a.blocked_until === null ? null : ms(a.blocked_until),
    };
  }

  private async remember(account: string): Promise<void> {
    const known = await readJson(this.storage, ACCOUNTS_KEY).catch(() => null);
    const list = Array.isArray(known) ? known.filter((a): a is string => typeof a === 'string') : [];
    if (!list.includes(account)) await this.storage.set(ACCOUNTS_KEY, JSON.stringify([...list, account].slice(-50)));
  }

  private async log(account: string, entry: [number, string, number, number]): Promise<void> {
    const now = this.now();
    const old = await readJson(this.storage, LOG_KEY + account);
    const keep = (Array.isArray(old) ? old : []).filter(
      (e): e is [number, string, number, number] =>
        Array.isArray(e) && isNum(e[0]) && typeof e[1] === 'string' && isNum(e[2]) && isNum(e[3]) && now - e[0] < LIMITS.log_days * 86_400_000,
    );
    keep.push(entry);
    await this.storage.set(LOG_KEY + account, JSON.stringify(keep.slice(-MAX_LOG)));
  }

  /** A new sync run: the per-run count starts again (the hourly and daily ones don't). */
  async beginRun(account: string): Promise<void> {
    await this.locked(account, async () => {
      const s = await this.load(account);
      await this.save(account, { ...s, run: 0 });
    });
  }

  /** Whether a request could go now, and if not, why and until when (ms). Asks nothing. */
  async check(account: string): Promise<{ ok: true } | { ok: false; reasons: GuardReason[]; until: number | null }> {
    const now = this.now();
    const c = checkState(this.toState(await this.load(account), now), now / 1000);
    return c.ok ? c : { ...c, until: c.until === null ? null : c.until * 1000 };
  }

  /**
   * One request to the provider: the pause before it (a random 1–3 s × `pace`, not before the first
   * of a run; never under the guard's minimum), the check, the count - stored before anything is
   * sent - and, once it ended, its status and the log entry. A limit throws `GuardLimitError` and
   * sends nothing; nothing is queued to fire later.
   *
   * `send` answers with the provider's status; it throws only when there was no answer (status 0)
   * or the player stopped (`Cancelled`).
   */
  async request<T>(
    account: string,
    kind: string,
    send: (signal?: AbortSignal) => Promise<Sent<T>>,
    opts: { pace?: number; signal?: AbortSignal } = {},
  ): Promise<T> {
    const { signal } = opts;
    const pace = typeof opts.pace === 'number' && Number.isFinite(opts.pace) ? Math.max(0.5, opts.pace) : 1;
    const label = KIND.test(kind) ? kind : 'other';
    return this.locked(account, async () => {
      if (signal?.aborted) throw new Cancelled();
      let stored = await this.load(account);
      if (stored.run > 0) {
        const r = Math.min(Math.max(this.random(), 0), 0.999_999);
        const { min, max } = LIMITS.pause_s;
        await this.sleep((min + r * (max - min)) * pace * 1000, signal);
        stored = await this.load(account);
      }
      for (;;) {
        const now = this.now();
        const c = checkState(this.toState(stored, now), now / 1000);
        if (c.ok) break;
        const until = c.until === null ? null : c.until * 1000;
        if (c.reasons.every((r) => r === 'pause') && until !== null && until - now <= MAX_WAIT_MS) {
          await this.sleep(until - now, signal);
          stored = await this.load(account);
          continue;
        }
        throw new GuardLimitError(c.reasons, until);
      }
      const t0 = this.now();
      const started = startState(this.toState(stored, t0), t0 / 1000);
      await this.save(account, this.fromState(started, t0));
      try {
        await this.remember(account);
      } catch {
        // Only the list of accounts for the export; the counts are kept.
      }
      let sent: Sent<T>;
      try {
        sent = await send(signal);
      } catch (e) {
        const t1 = this.now();
        const stopped = e instanceof Cancelled;
        // Stopped by the player: no answer to hold against the provider, so no backoff either.
        const done = stopped
          ? { ...started, in_flight: false, last_end: t1 / 1000 }
          : finishState(started, t1 / 1000, 0);
        await this.save(account, this.fromState(done, null));
        await this.log(account, [t0, label, stopped ? -1 : 0, t1 - t0]).catch(() => undefined);
        throw e;
      }
      const t1 = this.now();
      const status = Number.isInteger(sent.status) ? sent.status : 0;
      const retry = typeof sent.retryAfterS === 'number' && Number.isFinite(sent.retryAfterS) ? sent.retryAfterS : null;
      await this.save(account, this.fromState(finishState(started, t1 / 1000, status, retry), null));
      try {
        await this.log(account, [t0, label, status, t1 - t0]);
      } catch (e) {
        throw new GuardStorageError(`The guard's log could not be kept: ${e instanceof Error ? e.message : String(e)}`);
      }
      return sent.value;
    });
  }

  /** "Today 14 of 300": the counts as a client shows them. */
  async counts(account: string): Promise<GuardCounts> {
    const now = this.now();
    const s = await this.load(account);
    return {
      run: s.run,
      hour: s.starts.filter((t) => now - t < LIMITS.hour_window_s * 1000).length,
      day: s.starts.filter((t) => now - t < LIMITS.day_window_s * 1000).length,
      limits: { per_run: LIMITS.per_run, per_hour: LIMITS.per_hour, per_day: LIMITS.per_day },
      blocked_until: s.blocked_until !== null && s.blocked_until > now ? new Date(s.blocked_until).toISOString() : null,
    };
  }

  /** The log of the last 14 days, for the player to export: times, kinds, statuses, durations. */
  async exportLog(): Promise<GuardLogExport> {
    const now = this.now();
    const known = await readJson(this.storage, ACCOUNTS_KEY);
    const accounts = Array.isArray(known) ? known.filter((a): a is string => typeof a === 'string') : [];
    const out: GuardLogExport['accounts'] = [];
    for (const account of accounts) {
      const raw = await readJson(this.storage, LOG_KEY + account);
      const requests = (Array.isArray(raw) ? raw : [])
        .filter((e): e is [number, string, number, number] => Array.isArray(e) && isNum(e[0]) && typeof e[1] === 'string' && isNum(e[2]) && isNum(e[3]))
        .filter((e) => now - e[0] < LIMITS.log_days * 86_400_000)
        .map(([t, kind, status, ms]) => ({ at: new Date(t).toISOString(), kind: KIND.test(kind) ? kind : 'other', status, ms }));
      out.push({ account, requests });
    }
    return {
      format: 'glmsync-guard-log/1',
      exported_at: new Date(now).toISOString(),
      limits: JSON.parse(JSON.stringify(LIMITS)) as typeof GUARD_LIMITS,
      accounts: out,
    };
  }
}
