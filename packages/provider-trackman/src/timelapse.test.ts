// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The load guard, a target's plan and the provider together, days in milliseconds: a made-up
 * Trackman, a made-up target that answers the target API, and a client that asks every minute.
 * Whatever the target plans, Trackman never sees more than the guard's limits; a long history
 * arrives over days, as a person paging back would bring it.
 */
import { Guard, HttpTarget, LIMITS, MemoryStorage, pair, sync, type SyncOutcome } from '@glmsync/core';
import { FakeTarget, VirtualClock, type PlanAsked } from '@glmsync/core/testing';
import type { Reason } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { trackman } from './index.ts';
import { FakeTrackman, fakeToken, type Json } from './testing.ts';

const DAY = 86_400_000;
const START = Date.parse('2026-11-16T00:00:00Z');
const TOKEN = fakeToken('7c1d2e3f-0000-4000-8000-00000000000a');

function history(n: number, clock: VirtualClock): FakeTrackman {
  const tm = new FakeTrackman(clock.now);
  tm.tokens.add(TOKEN);
  // One session every ~1.4 days back from yesterday, newest first, each with a few strokes.
  tm.activities = Array.from({ length: n }, (_, i) => ({
    id: `H${i}`,
    time: new Date(START - DAY - i * 1.4 * DAY).toISOString(),
    kind: i % 3 ? 'SIMULATOR' : 'RANGE_PRACTICE',
  }));
  for (const a of tm.activities) tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  return tm;
}

/** Every provider request stays within the rolling hour's and day's limits. */
function withinLimits(times: number[]): { hour: number; day: number } {
  let hour = 0;
  let day = 0;
  for (let i = 0; i < times.length; i++) {
    const t = times[i] as number;
    let h = 0;
    let d = 0;
    for (let j = i; j >= 0 && t - (times[j] as number) < DAY; j--) {
      d += 1;
      if (t - (times[j] as number) < 3600_000) h += 1;
    }
    hour = Math.max(hour, h);
    day = Math.max(day, d);
  }
  return { hour, day };
}

async function client(target: FakeTarget, clock: VirtualClock) {
  const pairing = await pair({ target: target.base, code: 'K7M2PQ9X', provider: 'trackman', client: { kind: 'extension', name: 'Test' }, fetch: target.fetch });
  const http = new HttpTarget(pairing, { fetch: target.fetch, now: clock.now });
  const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep });
  const provider = trackman();
  return (reason: Reason, fetchImpl: FakeTrackman['fetch']) =>
    sync({ target: http, provider, credential: TOKEN, reason, client: 'extension', guard, fetch: fetchImpl, now: clock.now, sleep: clock.sleep });
}

describe('a long history, a day at a time', () => {
  it('arrives over days, never past the limits, and all of it', async () => {
    const clock = new VirtualClock(START);
    const tm = history(500, clock);
    // A target that plans like the reference: a regular sync 45 minutes after the last, the history
    // in chunks of 10, 90 s apart, until a chunk says there is no more.
    const imports = () => target.imports.map((b) => ({ reason: b.sync?.reason, at: Date.parse(b.generated_at), more: b.progress?.more_available }));
    const plan = (ask: PlanAsked, t: FakeTarget): Json => {
      const done = imports().some((i) => i.reason === 'backfill' && i.more === false);
      const last = (r: string) => Math.max(-Infinity, ...imports().filter((i) => i.reason === r).map((i) => i.at));
      const base = { plan_id: `pl_${clock.t}`, known_ids: t.known(), rounds: false, round_shots: false };
      if (ask.reason === 'backfill') {
        return done || clock.t - last('backfill') < 90_000
          ? { due: false, history: { done } }
          : { ...base, due: true, since: '2011-01-01T00:00:00Z', max_sessions: 10 };
      }
      return clock.t - last('timer') < 45 * 60_000 ? { due: false } : { ...base, due: true, since: new Date(clock.t - 3 * DAY).toISOString(), max_sessions: 40 };
    };
    const target = new FakeTarget({ plan });
    const run = await client(target, clock);
    const perRun: number[] = [];
    let doneAt: number | null = null;
    while (clock.t < START + 5 * DAY && doneAt === null) {
      for (const reason of ['timer', 'backfill'] as const) {
        const before = tm.count();
        const out: SyncOutcome = await run(reason, tm.fetch);
        perRun.push(tm.count() - before);
        expect(['synced', 'not_due']).toContain(out.status);
      }
      if (imports().some((i) => i.reason === 'backfill' && i.more === false)) doneAt = clock.t;
      clock.advance(60_000);
    }
    expect(target.sessions.size).toBe(500);
    expect(doneAt).not.toBeNull();
    expect((doneAt as number) - START).toBeGreaterThan(DAY); // not in one night
    expect(Math.max(...perRun)).toBeLessThanOrEqual(LIMITS.per_run);
    const { hour, day } = withinLimits(tm.requests.map((r) => r.at));
    expect(hour).toBeLessThanOrEqual(LIMITS.per_hour);
    expect(day).toBeLessThanOrEqual(LIMITS.per_day);
  });
});

describe('a target that always says "due"', () => {
  it('cannot take the guard past its limits, however often and however fast it asks', async () => {
    const clock = new VirtualClock(START);
    const tm = history(3000, clock);
    const target = new FakeTarget({
      plan: () => ({ due: true, plan_id: 'pl_x', since: '2011-01-01T00:00:00Z', max_sessions: 100_000, pace: 0.5, rounds: true, round_shots: true }),
    });
    const run = await client(target, clock);
    const perRun: number[] = [];
    const notices: string[] = [];
    while (clock.t < START + 1.5 * DAY) {
      const before = tm.count();
      const out = await run('manual', tm.fetch);
      perRun.push(tm.count() - before);
      if (out.status === 'synced' && out.notice) notices.push(out.notice.code);
      clock.advance(30_000);
    }
    expect(Math.max(...perRun)).toBeLessThanOrEqual(LIMITS.per_run);
    const { hour, day } = withinLimits(tm.requests.map((r) => r.at));
    expect(hour).toBeLessThanOrEqual(LIMITS.per_hour);
    expect(day).toBeLessThanOrEqual(LIMITS.per_day);
    expect(tm.count()).toBeLessThanOrEqual(LIMITS.per_day * 2); // a day and a half: at most two days' worth
    expect(notices).toContain('guard_limit'); // and it said so
    // Never two requests closer than the guard's minimum pause.
    const gaps = tm.requests.slice(1).map((r, i) => r.at - (tm.requests[i]?.at ?? 0));
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(LIMITS.pause_s.min * 1000);
  });
});
