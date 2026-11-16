// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The file target: a sync whose batch is written to a file instead of sent to an app, and the
 * cursor that remembers what was written, so the next file brings only what is new.
 *
 * It plans like a target, gently: only when the player asks (`manual`), or for the next chunk of
 * the older history (`backfill`) until that is done - never on a timer. The salt of its
 * `account_ref` is random and kept with the cursor (spec/olmd.md).
 */

import { PLAN_RULES, type Batch, type Reason } from '@glmsync/spec';
import type { ClientKind, ImportLimits, ImportResult, Plan } from './api.ts';
import { base64url } from './sha256.ts';
import { readJson, type Storage } from './storage.ts';
import type { Target } from './target.ts';
import { ms } from './values.ts';

const DAY = 86_400_000;
const MAX_IDS = 20_000;
const KEY = 'glmsync/cursor/';

export interface CursorData {
  v: 1;
  salt: string;
  /** When the last regular file was written. */
  last_at: string | null;
  /** What was written: external id -> when it was played (null: unknown). */
  ids: Record<string, string | null>;
  history: { started: boolean; done: boolean; oldest_seen?: string };
}

function randomSalt(randomBytes?: (n: number) => Uint8Array): string {
  const bytes = randomBytes
    ? randomBytes(24)
    : (() => {
        const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
        if (!c?.getRandomValues) throw new Error('No random source in this environment: pass randomBytes.');
        return c.getRandomValues(new Uint8Array(24));
      })();
  return base64url(bytes);
}

function readCursor(v: unknown): CursorData | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Record<string, unknown>;
  const h = c.history as Record<string, unknown> | undefined;
  if (c.v !== 1 || typeof c.salt !== 'string' || c.salt.length < 16 || !c.ids || typeof c.ids !== 'object') return null;
  if (!(c.last_at === null || typeof c.last_at === 'string') || !h || typeof h !== 'object') return null;
  const ids: Record<string, string | null> = {};
  for (const [k, t] of Object.entries(c.ids as Record<string, unknown>)) ids[k] = typeof t === 'string' ? t : null;
  const out: CursorData = { v: 1, salt: c.salt, last_at: c.last_at, ids, history: { started: h.started === true, done: h.done === true } };
  if (typeof h.oldest_seen === 'string') out.history.oldest_seen = h.oldest_seen;
  return out;
}

/** What has been delivered to one target, per provider and account. */
export class Cursor {
  private constructor(
    private readonly storage: Storage,
    private readonly key: string,
    public data: CursorData,
    private readonly randomBytes: ((n: number) => Uint8Array) | undefined,
  ) {}

  /** `name`: which target and provider, e.g. "file:trackman". A cursor that can't be read starts afresh. */
  static async open(storage: Storage, name: string, randomBytes?: (n: number) => Uint8Array): Promise<Cursor> {
    const key = KEY + name;
    const data = readCursor(await readJson(storage, key));
    return new Cursor(storage, key, data ?? Cursor.fresh(randomBytes), randomBytes);
  }

  private static fresh(randomBytes?: (n: number) => Uint8Array): CursorData {
    return { v: 1, salt: randomSalt(randomBytes), last_at: null, ids: {}, history: { started: false, done: false } };
  }

  /** The ids played since `since` (and those without a time). */
  knownSince(since: string | null): string[] {
    const from = since ? ms(since) : Number.NEGATIVE_INFINITY;
    return Object.entries(this.data.ids)
      .filter(([, t]) => t === null || !(ms(t) < from))
      .map(([id]) => id);
  }

  /** A batch was delivered. */
  record(batch: Batch, reason: Reason | null, at: number): void {
    for (const s of batch.sessions) this.data.ids[s.external_id] = s.started_at ?? null;
    for (const r of batch.rounds) {
      // A round counts once its shots are in, or it has none to send.
      if (r.shots) this.data.ids[r.external_id] = r.played_at ?? this.data.ids[r.external_id] ?? null;
    }
    const entries = Object.entries(this.data.ids);
    if (entries.length > MAX_IDS) {
      entries.sort(([, a], [, b]) => (ms(b) || 0) - (ms(a) || 0));
      this.data.ids = Object.fromEntries(entries.slice(0, MAX_IDS));
    }
    if (reason === 'backfill') {
      this.data.history.started = true;
      if (batch.progress?.more_available === false) this.data.history.done = true;
      const oldest = batch.progress?.oldest_seen;
      if (oldest && !(ms(this.data.history.oldest_seen) <= ms(oldest))) this.data.history.oldest_seen = oldest;
    } else if (reason !== null) this.data.last_at = new Date(at).toISOString();
  }

  async save(): Promise<void> {
    await this.storage.set(this.key, JSON.stringify(this.data));
  }

  /** Start afresh, with a new salt. */
  async reset(): Promise<void> {
    await this.storage.remove(this.key);
    this.data = Cursor.fresh(this.randomBytes);
  }
}

export interface FileOut {
  name: string;
  /** The batch as JSON, UTF-8. */
  text: string;
}

export interface FileTargetOptions {
  storage: Storage;
  provider: string;
  /** Writes the file: a download in a browser, the share sheet on a phone. Throws when it couldn't. */
  write: (file: FileOut) => Promise<void>;
  now?: () => number;
  randomBytes?: (n: number) => Uint8Array;
}

const pad = (n: number) => String(n).padStart(2, '0');

export class FileTarget implements Target {
  readonly name = 'File';
  readonly limits: ImportLimits = {
    max_bytes: 256 * 1024 * 1024,
    max_sessions: 100_000,
    max_shots: 10_000_000,
    max_rounds: 100_000,
    max_round_shots: 10_000_000,
  };
  private reason: Reason | null = null;

  private constructor(
    private readonly cursor: Cursor,
    private readonly opts: FileTargetOptions,
  ) {}

  static async open(opts: FileTargetOptions): Promise<FileTarget> {
    return new FileTarget(await Cursor.open(opts.storage, `file:${opts.provider}`, opts.randomBytes), opts);
  }

  get salt(): string {
    return this.cursor.data.salt;
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  async plan(_provider: string, reason: Reason, _client: ClientKind): Promise<Plan> {
    const now = this.now();
    const plan: Plan = { due: false, known_ids: [], give_up: [], rounds: false, round_shots: false, rounds_wanted: [], pace: 1 };
    const h = this.cursor.data.history;
    if (reason === 'backfill') {
      if (h.done) return { ...plan, history: { done: true } };
      const since = new Date(now - PLAN_RULES.history_days * DAY).toISOString();
      this.reason = reason;
      return {
        ...plan,
        due: true,
        plan_id: `file-${now}`,
        since,
        max_sessions: PLAN_RULES.history_chunk_sessions,
        known_ids: this.cursor.knownSince(null),
        // The scorecards are listed with the first chunk; later chunks need them no more.
        rounds: !h.started,
        round_shots: !h.started,
        history: { done: false },
      };
    }
    if (reason !== 'manual') return plan; // a file is written when the player asks, never on a timer
    const last = this.cursor.data.last_at;
    const days = last
      ? Math.min(PLAN_RULES.max_window_days, Math.ceil((now - ms(last)) / DAY) + PLAN_RULES.window_slack_days)
      : PLAN_RULES.recent_days;
    const since = new Date(now - days * DAY).toISOString();
    this.reason = reason;
    return {
      ...plan,
      due: true,
      plan_id: `file-${now}`,
      since,
      max_sessions: PLAN_RULES.sync_max_sessions,
      known_ids: this.cursor.knownSince(since),
      rounds: true,
      round_shots: true,
    };
  }

  async import(batch: Batch): Promise<ImportResult> {
    const now = new Date(this.now());
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
    // A file stands on its own: no plan it answers.
    const { sync: _, ...file } = batch;
    await this.opts.write({ name: `olmd-${batch.provider}-${stamp}.json`, text: `${JSON.stringify(file, null, 2)}\n` });
    const known = new Set(Object.keys(this.cursor.data.ids));
    const result: ImportResult = { sessions: 0, shots: 0, rounds: 0, round_shots: 0, duplicates: 0 };
    for (const s of batch.sessions) {
      if (known.has(s.external_id)) result.duplicates += 1;
      else {
        result.sessions += 1;
        result.shots += s.shots.length;
      }
    }
    for (const r of batch.rounds) {
      if (known.has(r.external_id)) result.duplicates += 1;
      else result.rounds += 1;
      if (r.shots) result.round_shots += 1;
    }
    this.cursor.record(batch, this.reason, this.now());
    await this.cursor.save();
    return result;
  }

  /** Start afresh: the next file brings everything again (with a new salt). */
  async forget(): Promise<void> {
    await this.cursor.reset();
  }
}
