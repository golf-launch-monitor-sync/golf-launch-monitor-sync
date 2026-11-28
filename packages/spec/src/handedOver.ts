// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A sign-in handed over to a target app (spec/deep-links.md, *Signing in for a target*; since 1.27.0), read strictly as
 * a target reads it once it opened the seal (handover.ts) - apart from the seal, so that what only reads one (the
 * engine in a target's app) needs no NaCl. Both answer spec/testvectors/handover.json's `open` alike.
 *
 * Since 1.28.0 a sign-in may be a test mode's (spec/test-mode.md, *Only signing in for a target*): `test` true, the token
 * a target's test code, never a provider's key, and `expires_at` always there. A target tells the two apart by `test`.
 */

const TOKEN = /^[\x21-\x7e]{1,4096}$/;
const USER_AGENT = /^[\x20-\x7e]{1,512}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{1,39}$/;
const ACCOUNT_REF = /^[A-Za-z0-9_-]{16,128}$/;
/** A test sign-in's token is a test code (1.28.0): never shaped like a provider's key, so one can't pass for the other. */
const TEST_TOKEN = /^[0-9A-Za-z-]{6,64}$/;
const TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?(Z|[+-]([0-9]{2}):([0-9]{2}))$/;

/** The handed-over sign-in, as a target reads it. */
export interface HandedOver {
  provider: string;
  /** The provider's key, as it goes into its requests. */
  token: string;
  /** Which provider account (spec/olmd.md, `account_ref`, with the target's salt). */
  account_ref: string;
  /** When the key runs out, when the provider's key says (RFC 3339). */
  expires_at?: string;
  /** The User-Agent of the browser the player signed in with on this device: every call to the provider carries it. */
  user_agent: string;
  /**
   * A test mode's sign-in (1.28.0; spec/test-mode.md): `token` is the target's test code, `expires_at` is there. The
   * target's app plays its test scenario back instead of asking the provider - and never sends a real key as a code.
   */
  test?: true;
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function daysIn(y: number, m: number): number {
  return [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0;
}

/** An RFC 3339 time with its zone, exactly as given (a time a reader would have to guess at is none). */
function exactTime(t: unknown): t is string {
  if (typeof t !== 'string') return false;
  const m = TIME.exec(t);
  if (!m) return false;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || s > 59) return false;
  return m[7] === 'Z' || (Number(m[8]) <= 23 && Number(m[9]) <= 59);
}

/** The handed-over sign-in read strictly: one wrong required value and it is none (a target never keeps half of one). */
export function readHandedOver(data: unknown): HandedOver | null {
  if (!isObject(data) || data.v !== 1) return null;
  // 1.28.0: absent or false a provider's sign-in, true a test's; any other value none at all (never one for the other).
  const test = data.test === undefined ? false : data.test;
  if (test !== true && test !== false) return null;
  const { provider, token, account_ref: ref, user_agent: ua } = data;
  if (typeof provider !== 'string' || !PROVIDER.test(provider)) return null;
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  if (typeof ref !== 'string' || !ACCOUNT_REF.test(ref)) return null;
  if (typeof ua !== 'string' || !USER_AGENT.test(ua) || ua !== ua.trim()) return null;
  const out: HandedOver = { provider, token, account_ref: ref, user_agent: ua };
  if (exactTime(data.expires_at)) out.expires_at = data.expires_at;
  if (test) {
    if (!TEST_TOKEN.test(token) || out.expires_at === undefined) return null;
    out.test = true;
  }
  return out;
}
