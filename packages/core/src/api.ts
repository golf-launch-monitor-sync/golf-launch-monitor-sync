// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The target API's shapes (spec/api/target-api.yaml) and the readers for what a target answers.
 *
 * A target is untrusted too: a faulty or hostile one must not make a client misbehave. So its
 * answers are read field by field - a value of the wrong kind is dropped, never trusted - and a plan
 * can only ever make a client do less (the load guard holds whatever it says).
 */

import { REASONS, validReturn, type Reason } from '@glmsync/spec';
import { externalId, when } from './values.ts';

export type ClientKind = 'extension' | 'web' | 'companion' | 'cli' | 'other';
export const CLIENT_KINDS: readonly ClientKind[] = ['extension', 'web', 'companion', 'cli', 'other'];

export const PROVIDER_ID = /^[a-z][a-z0-9_-]{1,39}$/;
export const ACCOUNT_REF = /^[A-Za-z0-9_-]{16,128}$/;

export interface ImportLimits {
  max_bytes: number;
  max_sessions: number;
  max_shots: number;
  max_rounds: number;
  max_round_shots: number;
}

export interface RoundWanted {
  external_id: string;
  played_at?: string;
  /** About where it stands in the provider's list (newest first): known rounds played after it. */
  newer?: number;
}

/** A plan as the client reads it (spec/target-api.md, "The target plans, the client fetches"). */
/** Who holds a busy plan's lease (spec 1.13.0): a kind of client, and since when. Never the asking client itself. */
export interface Holder {
  kind: ClientKind;
  since?: string;
}

export interface Plan {
  due: boolean;
  busy?: boolean;
  holder?: Holder;
  wait_s?: number;
  disconnected?: boolean;
  account_ref?: string;
  plan_id?: string;
  lease_until?: string;
  since?: string;
  max_sessions?: number;
  known_ids: string[];
  give_up: string[];
  rounds: boolean;
  round_shots: boolean;
  rounds_wanted: RoundWanted[];
  /**
   * Since 1.20.0, with `rounds` in a history chunk: how many of the newest scorecards to pass over (planning.md, *The
   * whole history*). Absent: the scorecards are listed from the top, as before.
   */
  rounds_skip?: number;
  /** Since 1.20.0, in a history chunk: known sessions the target holds without shots, to fetch once more. */
  sessions_wanted: SessionWanted[];
  /** Multiplies the pauses between provider requests; never below 0.5. */
  pace: number;
  /**
   * `older` (since 1.21.0): false while the history isn't done but nothing older than what the target has comes any
   * more - it only fills gaps (planning.md, *Only gaps*). A client then says it runs, not that it loads the history.
   */
  history?: { done?: boolean; older?: boolean; from?: string };
  last_import_at?: string;
}

export interface SessionWanted {
  external_id: string;
  started_at?: string;
}

/**
 * What a client can do beyond earlier versions, named with every plan (`can`, since 1.20.0; target-api.md, *What a
 * client can*): a target plans these parts only for a client that says so.
 */
export const CAN = ['older_rounds', 'sessions_again'] as const;
export type Can = (typeof CAN)[number];

export interface ImportResult {
  sessions: number;
  shots: number;
  rounds: number;
  round_shots: number;
  duplicates: number;
  not_stored?: string[];
}

export interface TargetStatus {
  target: { name: string };
  connected: boolean;
  provider?: string;
  account_ref?: string;
  last_import_at?: string;
  token?: { created_at?: string; last_used_at?: string };
}

/** What a client keeps of a pairing (the token like a password, in the platform's secure store). */
export interface Pairing {
  /** The target's base URL, e.g. https://app.example.org/lm/v1 */
  base: string;
  token: string;
  provider: string;
  target: { name: string; return_prefixes: string[] };
  account_salt: string;
  account_ref?: string;
  limits: ImportLimits;
  paired_at: string;
}

const MAX_IDS = 20_000;
const MAX_WANTED = 200;

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const posInt = (v: unknown, min: number): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : null;
const str = (v: unknown, min: number, max: number): string | null =>
  typeof v === 'string' && v.length >= min && v.length <= max ? v : null;

function ids(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v.slice(0, MAX_IDS)) {
    const id = typeof x === 'string' ? externalId(x) : null;
    if (id) out.push(id);
  }
  return out;
}

/** A target's plan, read field by field. Anything unreadable is "not due". */
export function readPlan(data: unknown): Plan {
  const p = obj(data);
  const plan: Plan = { due: p?.due === true, known_ids: [], give_up: [], rounds: false, round_shots: false, rounds_wanted: [], sessions_wanted: [], pace: 1 };
  if (!p) return plan;
  if (p.busy === true) {
    plan.busy = true;
    plan.due = false; // another client holds the lease: never both
    const h = obj(p.holder);
    if (h) {
      const kind = CLIENT_KINDS.find((k) => k === h.kind) ?? 'other';
      const since = when(h.since);
      plan.holder = since ? { kind, since } : { kind };
    }
  }
  if (p.disconnected === true) {
    plan.disconnected = true;
    plan.due = false;
  }
  if (typeof p.wait_s === 'number' && Number.isFinite(p.wait_s) && p.wait_s >= 0) plan.wait_s = p.wait_s;
  if (typeof p.account_ref === 'string' && ACCOUNT_REF.test(p.account_ref)) plan.account_ref = p.account_ref;
  const planId = str(p.plan_id, 1, 200);
  if (planId) plan.plan_id = planId;
  const lease = when(p.lease_until);
  if (lease) plan.lease_until = lease;
  const since = when(p.since);
  if (since) plan.since = since;
  const max = posInt(p.max_sessions, 0);
  if (max !== null) plan.max_sessions = max;
  plan.known_ids = ids(p.known_ids);
  plan.give_up = ids(p.give_up);
  plan.rounds = p.rounds === true;
  plan.round_shots = p.round_shots === true;
  if (Array.isArray(p.rounds_wanted)) {
    for (const w of p.rounds_wanted.slice(0, MAX_WANTED)) {
      const o = obj(w);
      const id = o && typeof o.external_id === 'string' ? externalId(o.external_id) : null;
      if (!o || !id) continue;
      const want: RoundWanted = { external_id: id };
      const played = when(o.played_at);
      if (played) want.played_at = played;
      const newer = posInt(o.newer, 0);
      if (newer !== null) want.newer = newer;
      plan.rounds_wanted.push(want);
    }
  }
  const skip = posInt(p.rounds_skip, 0);
  if (skip !== null) plan.rounds_skip = skip;
  if (Array.isArray(p.sessions_wanted)) {
    for (const w of p.sessions_wanted.slice(0, MAX_WANTED)) {
      const o = obj(w);
      const id = o && typeof o.external_id === 'string' ? externalId(o.external_id) : null;
      if (!o || !id) continue;
      const want: SessionWanted = { external_id: id };
      const started = when(o.started_at);
      if (started) want.started_at = started;
      plan.sessions_wanted.push(want);
    }
  }
  if (typeof p.pace === 'number' && Number.isFinite(p.pace)) plan.pace = Math.max(0.5, p.pace);
  const h = obj(p.history);
  if (h) {
    plan.history = {};
    if (typeof h.done === 'boolean') plan.history.done = h.done;
    if (typeof h.older === 'boolean') plan.history.older = h.older;
    const from = when(h.from);
    if (from) plan.history.from = from;
  }
  const last = when(p.last_import_at);
  if (last) plan.last_import_at = last;
  return plan;
}

/**
 * Below this a batch can't carry one session of a provider: a client would fetch for nothing, and
 * fetch it again next time. A target that takes less is not paired with.
 */
export const MIN_BATCH_BYTES = 65_536;

export function readLimits(data: unknown): ImportLimits | null {
  const l = obj(data);
  if (!l) return null;
  const keys = ['max_bytes', 'max_sessions', 'max_shots', 'max_rounds', 'max_round_shots'] as const;
  const out: Partial<ImportLimits> = {};
  for (const k of keys) {
    const v = posInt(l[k], 1);
    if (v === null) return null;
    out[k] = v;
  }
  if ((out.max_bytes as number) < MIN_BATCH_BYTES) return null;
  return out as ImportLimits;
}

/**
 * Where a link may jump back to after this target's pairing (`return_prefixes` of `POST /pair`; since spec 1.18.0 a
 * handicap target's too): only prefixes that can't be stretched to another host, at most ten. Anything else is dropped.
 */
export function readReturnPrefixes(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 10)
    .filter((x): x is string => typeof x === 'string' && x.length >= 4 && x.length <= 200)
    .filter((x) => (x.endsWith('/') || x.endsWith('://')) && validReturn(x));
}

/** The answer to POST /pair, or null when it isn't one. */
export function readPairing(data: unknown, base: string, provider: string, now: number): Pairing | null {
  const p = obj(data);
  const token = str(p?.token, 32, 256);
  const salt = str(p?.account_salt, 16, 128);
  const target = obj(p?.target);
  const name = str(target?.name, 1, 100);
  const limits = readLimits(p?.limits);
  if (!p || !token || !salt || !name || !limits) return null;
  const prefixes = readReturnPrefixes(target?.return_prefixes);
  const pairing: Pairing = {
    base,
    token,
    provider,
    target: { name, return_prefixes: prefixes },
    account_salt: salt,
    limits,
    paired_at: new Date(now).toISOString(),
  };
  if (typeof p.account_ref === 'string' && ACCOUNT_REF.test(p.account_ref)) pairing.account_ref = p.account_ref;
  return pairing;
}

export function readImportResult(data: unknown): ImportResult | null {
  const r = obj(data);
  if (!r) return null;
  const n = (k: string) => posInt(r[k], 0);
  const [sessions, shots, rounds, roundShots, duplicates] = [n('sessions'), n('shots'), n('rounds'), n('round_shots'), n('duplicates')];
  if (sessions === null || shots === null || rounds === null || roundShots === null || duplicates === null) return null;
  const out: ImportResult = { sessions, shots, rounds, round_shots: roundShots, duplicates };
  const notStored = ids(r.not_stored);
  if (notStored.length) out.not_stored = notStored;
  return out;
}

export function readStatus(data: unknown): TargetStatus | null {
  const s = obj(data);
  const name = str(obj(s?.target)?.name, 1, 100);
  if (!s || !name || typeof s.connected !== 'boolean') return null;
  const out: TargetStatus = { target: { name }, connected: s.connected };
  if (typeof s.provider === 'string' && PROVIDER_ID.test(s.provider)) out.provider = s.provider;
  if (typeof s.account_ref === 'string' && ACCOUNT_REF.test(s.account_ref)) out.account_ref = s.account_ref;
  const last = when(s.last_import_at);
  if (last) out.last_import_at = last;
  const t = obj(s.token);
  if (t) {
    const token: NonNullable<TargetStatus['token']> = {};
    const created = when(t.created_at);
    const used = when(t.last_used_at);
    if (created) token.created_at = created;
    if (used) token.last_used_at = used;
    out.token = token;
  }
  return out;
}

export function isReason(v: unknown): v is Reason {
  return typeof v === 'string' && (REASONS as readonly string[]).includes(v);
}

export function emptyResult(): ImportResult {
  return { sessions: 0, shots: 0, rounds: 0, round_shots: 0, duplicates: 0 };
}

export function addResults(a: ImportResult, b: ImportResult): ImportResult {
  const out: ImportResult = {
    sessions: a.sessions + b.sessions,
    shots: a.shots + b.shots,
    rounds: a.rounds + b.rounds,
    round_shots: a.round_shots + b.round_shots,
    duplicates: a.duplicates + b.duplicates,
  };
  const notStored = [...(a.not_stored ?? []), ...(b.not_stored ?? [])];
  if (notStored.length) out.not_stored = notStored;
  return out;
}
