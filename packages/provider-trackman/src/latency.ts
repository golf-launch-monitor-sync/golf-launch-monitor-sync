// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * How long Trackman takes to answer each query, for playing a test scenario back (spec/test-mode.md): a scenario's
 * `latency` (the median and spread per query, by the query's own name), a default where it says nothing, and the way
 * to work a profile out of the request log a client keeps anyway (guard.ts: time, kind, status, duration - never
 * content).
 */

import type { Latency } from '@glmsync/spec';

export type LatencyProfile = { default?: Latency; queries: Record<string, Latency> };

/**
 * Where a scenario names no time for a query and gives no default. Estimates of how the portal's answers feel (a list
 * page a second, a session with its strokes a little more, a page of round shots the most), until a request log of a
 * real sync replaces them (`latencyFromLog`): times only, never content.
 */
export const DEFAULT_LATENCY: Required<LatencyProfile> = {
  default: { median_s: 1, spread_s: 0.4 },
  queries: {
    Activities: { median_s: 1, spread_s: 0.4 },
    Session: { median_s: 1.4, spread_s: 0.6 },
    Rounds: { median_s: 1, spread_s: 0.4 },
    RoundShots: { median_s: 2.5, spread_s: 1 },
    Who: { median_s: 0.8, spread_s: 0.3 },
    Profile: { median_s: 0.6, spread_s: 0.2 },
  },
};

/** The guard's kind of a request (fetch.ts) to the name of Trackman's query it sends. */
export const KIND_QUERY: Readonly<Record<string, string>> = {
  list: 'Activities',
  session: 'Session',
  rounds: 'Rounds',
  round_shots: 'RoundShots',
  who: 'Who',
};

/** The longest an answer may be made to take (seconds): a scenario's own limit (spec/test-mode.md). */
const MAX_S = 60;

/** The time for one query: the scenario's for it, else the scenario's default, else this module's. */
export function latencyOf(profile: LatencyProfile | undefined, query: string): Latency {
  return profile?.queries[query] ?? profile?.default ?? DEFAULT_LATENCY.queries[query] ?? DEFAULT_LATENCY.default;
}

/**
 * One answer's time in ms: about the median, scattered by the spread (as a standard deviation), never below nothing,
 * never past three spreads above the median or a minute. `random` in [0, 1) (tests pass their own).
 */
export function sampleMs(l: Latency, random: () => number = Math.random): number {
  const u1 = Math.min(Math.max(random(), 1e-9), 1 - 1e-9);
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller
  const s = Math.min(Math.max(l.median_s + l.spread_s * z, 0), l.median_s + 3 * l.spread_s, MAX_S);
  return Math.round(s * 1000);
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
};
const round2 = (x: number) => Math.round(x * 100) / 100;
const clampS = (x: number) => Math.min(Math.max(round2(x), 0), MAX_S);

/** The median and spread of durations (ms): the spread from the median absolute deviation, robust to a stray one. */
function profileOf(ms: number[]): Latency {
  const m = median(ms);
  const mad = median(ms.map((x) => Math.abs(x - m)));
  return { median_s: clampS(m / 1000), spread_s: clampS((1.4826 * mad) / 1000) };
}

/**
 * A latency profile for a scenario out of an exported request log (`glmsync-guard-log/1`, the companion app's *Export
 * the log*): only the answers that came (status 200), per kind of request with at least `min` of them, the default
 * over all. Reads only times and kinds - the log holds nothing else - and never throws: what isn't a log gives an
 * empty profile.
 */
export function latencyFromLog(log: unknown, min = 3): LatencyProfile {
  const out: LatencyProfile = { queries: {} };
  const accounts = (log as { accounts?: unknown } | null)?.accounts;
  if (!Array.isArray(accounts)) return out;
  const byQuery = new Map<string, number[]>();
  const all: number[] = [];
  for (const a of accounts) {
    const requests = (a as { requests?: unknown } | null)?.requests;
    if (!Array.isArray(requests)) continue;
    for (const r of requests) {
      const { kind, status, ms } = (r ?? {}) as { kind?: unknown; status?: unknown; ms?: unknown };
      if (status !== 200 || typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || typeof kind !== 'string') continue;
      const query = KIND_QUERY[kind];
      if (!query) continue;
      byQuery.set(query, [...(byQuery.get(query) ?? []), ms]);
      all.push(ms);
    }
  }
  for (const [query, ms] of byQuery) if (ms.length >= min) out.queries[query] = profileOf(ms);
  if (all.length >= min) out.default = profileOf(all);
  return out;
}
