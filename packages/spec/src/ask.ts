// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The question and the answer (spec 1.22.0; spec/target-api.md *Asking and answering*, spec/deep-links.md *The answer
 * over the binding*, spec/planning.md *Who asks when*), the TypeScript port of spec/reference/ask.py; both answer
 * spec/testvectors/ask.json alike. Types and readers only: what a client or a target does with them is theirs.
 */

import type { SignIn } from './bridge.ts';

/** Why a client asks for a plan now, beside its reason (`cause` on GET /plan): the target's own ask, answered. */
export const ASK_CAUSES = ['wake', 'nudge', 'link', 'page'] as const;
export type AskCause = (typeof ASK_CAUSES)[number];

/**
 * What a client tells about its system with every plan (`env` on GET /plan; since 1.29.0 on GET /status too), key by
 * key. `power` (1.29.0): whether the phone saves power now (Low Power Mode, Battery Saver).
 */
export const ENV_VALUES = {
  os: ['android', 'ios', 'other'],
  background: ['available', 'restricted', 'denied'],
  battery: ['optimized', 'exempt'],
  push: ['on', 'off'],
  power: ['low', 'normal'],
} as const;
export type EnvKey = keyof typeof ENV_VALUES;
export type Env = { [K in EnvKey]?: (typeof ENV_VALUES)[K][number] };
export const ENV_MAX = 200;

/** The answer over the Android binding: its protocol version, and what it may say. */
export const ANSWER_V = '1';
export const ANSWER_STATES = ['accepted', 'started', 'not_due', 'busy', 'signin', 'outdated', 'blocked', 'failed'] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];
export const ANSWER_BLOCKED = ['guard', 'provider', 'system'] as const;
export type AnswerBlocked = (typeof ANSWER_BLOCKED)[number];
export const ANSWER_FAILED = ['target', 'unpaired', 'disconnected', 'error'] as const;
export type AnswerFailed = (typeof ANSWER_FAILED)[number];
/** A target waits this long for `accepted`, then takes the ask as not started (seconds). */
export const ANSWER_ACCEPT_S = 5;
/** ... and this long for the final answer, then takes the ask as failed (seconds). */
export const ANSWER_FINAL_S = 60;
/** The Android Message codes over the binding's Messenger, and the manifest's meta-data of a service that answers. */
export const ANSWER_MSG_ASK = 1;
export const ANSWER_MSG_ANSWER = 2;
export const ANSWER_META = 'glmsync.service.ANSWERS';

/** A client's own timer waits for `next_at` at most this long from the plan that said it (seconds). */
export const OWN_MAX_S = 6 * 3600;

const CLIENT_KINDS = ['extension', 'web', 'companion', 'cli', 'other'] as const;
export type AnswerClientKind = (typeof CLIENT_KINDS)[number];

export type Answer =
  | { state: 'accepted' | 'started' | 'outdated' }
  | { state: 'not_due'; until?: string }
  | { state: 'busy'; by: AnswerClientKind; since?: string }
  | { state: 'signin'; signin: Exclude<SignIn, 'ready'> }
  | { state: 'blocked'; why: AnswerBlocked; until?: string }
  | { state: 'failed'; why: AnswerFailed };

const VERSION = /^[0-9A-Za-z.+-]{1,50}$/;
const TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;
const NOT_READY = ['none', 'confirm', 'expired', 'other'] as const;

const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function one(values: unknown): string | null {
  return Array.isArray(values) && values.length === 1 && typeof values[0] === 'string' ? values[0] : null;
}

export function readCause(values: unknown): AskCause | null {
  const v = one(values);
  return has(ASK_CAUSES, v) ? v : null;
}

export function readVersion(values: unknown): string | null {
  const v = one(values);
  return v !== null && VERSION.test(v) ? v : null;
}

/** The pairs of `env` this spec knows; an unknown pair is left out, a known key given twice altogether. */
export function readEnv(values: unknown): Env {
  const v = one(values);
  if (v === null || v.length > ENV_MAX) return {};
  const seen = new Map<string, string[]>();
  for (const pair of v.split(',')) {
    const at = pair.indexOf(':');
    if (at < 0) continue;
    const key = pair.slice(0, at);
    if (!Object.hasOwn(ENV_VALUES, key)) continue;
    seen.set(key, [...(seen.get(key) ?? []), pair.slice(at + 1)]);
  }
  const out: Record<string, string> = {};
  for (const key of Object.keys(ENV_VALUES) as EnvKey[]) {
    const got = seen.get(key);
    if (got?.length === 1 && has(ENV_VALUES[key], got[0])) out[key] = got[0] as string;
  }
  return out as Env;
}

/** The query value of `env` for what a client knows of its system (the known pairs, in the spec's order). */
export function envParam(env: Env): string {
  return (Object.keys(ENV_VALUES) as EnvKey[]).filter((k) => has(ENV_VALUES[k], env[k])).map((k) => `${k}:${env[k]}`).join(',');
}

const time = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && TIME.test(v) ? v : null);

/** The strings of the Bundle the companion app sent over the binding; null when it is no answer. */
export function readAnswer(data: unknown): Answer | null {
  if (!isObject(data) || data.v !== ANSWER_V || !has(ANSWER_STATES, data.state)) return null;
  const state = data.state;
  let withUntil: { until?: string } = {};
  if ('until' in data) {
    if (state !== 'not_due' && state !== 'blocked') return null;
    const until = time(data.until);
    if (until === null) return null;
    withUntil = { until };
  }
  switch (state) {
    case 'busy': {
      if (!has(CLIENT_KINDS, data.by)) return null;
      if (!('since' in data)) return { state, by: data.by };
      const since = time(data.since);
      return since === null ? null : { state, by: data.by, since };
    }
    case 'signin':
      return has(NOT_READY, data.signin) ? { state, signin: data.signin } : null;
    case 'blocked':
      return has(ANSWER_BLOCKED, data.why) ? { state: 'blocked', why: data.why, ...withUntil } : null;
    case 'failed':
      return has(ANSWER_FAILED, data.why) ? { state, why: data.why } : null;
    case 'not_due':
      return { state: 'not_due', ...withUntil };
    default:
      return { state };
  }
}

/** A time as the reference reads it (RFC 3339 with a zone; a day that doesn't exist is none), in ms since 1970. */
function parse(v: unknown): number | null {
  if (time(v) === null) return null;
  const m = TIME.exec(v as string) as RegExpExecArray;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const ms = Number((m[7] ?? '.0').slice(1, 4).padEnd(3, '0'));
  const local = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  const back = new Date(local);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return null;
  const zone = m[8] as string;
  if (zone === 'Z') return local;
  const sign = zone.startsWith('-') ? -1 : 1;
  return local - sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * 60_000;
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * When the client's own timer may next ask a plan: its own time, but not before the target's `next_at` - and that wait
 * at most OWN_MAX_S from when the plan came. null only when `ownAt` or `receivedAt` isn't a time.
 */
export function ownAskAt(ownAt: unknown, nextAt: unknown, receivedAt: unknown): string | null {
  const own = parse(ownAt);
  const got = parse(receivedAt);
  if (own === null || got === null) return null;
  const next = parse(nextAt);
  if (next === null) return iso(own);
  return iso(Math.max(own, Math.min(next, got + OWN_MAX_S * 1000)));
}

/**
 * Whether a client asks for a plan now: only its own regular look (reason `timer`, no cause) waits for `next_at`; the
 * target's ask, the player's and the older history always go. Anything unreadable: it asks, as before 1.22.0.
 */
export function mayAsk(reason: unknown, cause: unknown, now: unknown, nextAt: unknown, receivedAt: unknown): boolean {
  if (has(ASK_CAUSES, cause) || reason !== 'timer') return true;
  const t = parse(now);
  const next = parse(nextAt);
  const got = parse(receivedAt);
  if (t === null || next === null || got === null) return true;
  return t >= Math.min(next, got + OWN_MAX_S * 1000);
}
