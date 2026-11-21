// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A target's test scenario as a client reads it (spec/test-mode.md, since 1.8.0), the TypeScript port of
 * spec/reference/testmode.py; both answer spec/testvectors/test-scenario.json alike.
 *
 * The answer of `GET /test-scenario` is untrusted like everything a target sends: the required parts must
 * be right or the scenario is refused; a bad response time is dropped (it only shapes the pace). Never an
 * exception, never a guess.
 */

/** A scenario larger than this (bytes of the answer's body) a client refuses before reading it. */
export const TEST_SCENARIO_MAX_BYTES = 64 * 1024 * 1024;
/** The longest response time a scenario may ask for, median or spread (seconds). */
export const TEST_SCENARIO_MAX_LATENCY_S = 60;
/** At most this many queries with a response time of their own; the rest are dropped. */
export const TEST_SCENARIO_MAX_QUERIES = 50;
/** The header that carries the test code (never the address). */
export const TEST_CODE_HEADER = 'X-Test-Code';
/** What a test code looks like (the same as a pairing code). */
export const TEST_CODE = /^[0-9A-Za-z-]{6,64}$/;

export interface Latency {
  median_s: number;
  spread_s: number;
}

export interface TestScenario {
  name: string;
  provider: string;
  subject: string;
  /** The provider's answer about whose account it is, in its own shape. */
  profile: Record<string, unknown>;
  /** The provider's answers, in its own shape (spec/test-mode.md). */
  data: Record<string, unknown>;
  latency: { default?: Latency; queries: Record<string, Latency> };
  valid_until: string;
}

export type TestScenarioResult = { ok: true; scenario: TestScenario } | { ok: false; error: string };

const PROVIDER = /^[a-z][a-z0-9_-]{1,39}$/;
const SUBJECT = /^[\x21-\x7e]{1,200}$/;
const QUERY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,9}))?(Z|[+-][0-9]{2}:[0-9]{2})$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * An RFC 3339 time with its zone as milliseconds since 1970, or null. A fraction counts to the
 * millisecond, so that every language compares alike; a time without a zone is no time here.
 */
export function instantMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = TIME.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i])) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || se > 59) return null;
  const zone = m[8] as string;
  let offset = 0;
  if (zone !== 'Z') {
    const zh = Number(zone.slice(1, 3));
    const zm = Number(zone.slice(4, 6));
    if (zh > 23 || zm > 59) return null;
    offset = (zone[0] === '+' ? 1 : -1) * (zh * 60 + zm) * 60_000;
  }
  const at = new Date(0);
  at.setUTCFullYear(y, mo - 1, d); // Date.UTC would read the years 0-99 as 1900-1999
  at.setUTCHours(h, mi, se, Number((m[7] ?? '0').slice(0, 3).padEnd(3, '0')));
  return at.getTime() - offset;
}

function latency(v: unknown): Latency | null {
  if (!isObj(v)) return null;
  const median = num(v.median_s);
  const spread = num(v.spread_s);
  if (median === null || spread === null) return null;
  if (median < 0 || median > TEST_SCENARIO_MAX_LATENCY_S || spread < 0 || spread > TEST_SCENARIO_MAX_LATENCY_S) return null;
  return { median_s: median, spread_s: spread };
}

/** The answer of `GET /test-scenario`; `now`: the client's clock (RFC 3339). */
export function readTestScenario(answer: unknown, now: string): TestScenarioResult {
  if (!isObj(answer)) return { ok: false, error: 'invalid:scenario' };
  const { name, provider, subject, profile, data } = answer;
  // Characters as Python counts them: code points, not UTF-16 units.
  if (typeof name !== 'string' || CONTROL.test(name) || !name.replace(/ /g, '')) return { ok: false, error: 'invalid:name' };
  const length = Array.from(name).length;
  if (length < 1 || length > 100) return { ok: false, error: 'invalid:name' };
  if (typeof provider !== 'string' || !PROVIDER.test(provider)) return { ok: false, error: 'invalid:provider' };
  if (typeof subject !== 'string' || !SUBJECT.test(subject)) return { ok: false, error: 'invalid:subject' };
  if (!isObj(profile)) return { ok: false, error: 'invalid:profile' };
  if (!isObj(data)) return { ok: false, error: 'invalid:data' };
  const until = instantMs(answer.valid_until);
  if (until === null) return { ok: false, error: 'invalid:valid_until' };
  const at = instantMs(now);
  // A clock that can't be read counts as past every end: better no test than one past its end.
  if (at === null || at >= until) return { ok: false, error: 'expired' };
  const lat: TestScenario['latency'] = { queries: {} };
  const raw = answer.latency;
  if (isObj(raw)) {
    const d = latency(raw.default);
    if (d) lat.default = d;
    if (isObj(raw.queries)) {
      for (const [q, v] of Object.entries(raw.queries)) {
        const entry = latency(v);
        if (entry && QUERY.test(q) && Object.keys(lat.queries).length < TEST_SCENARIO_MAX_QUERIES) lat.queries[q] = entry;
      }
    }
  }
  return { ok: true, scenario: { name, provider, subject, profile, data, latency: lat, valid_until: answer.valid_until as string } };
}
