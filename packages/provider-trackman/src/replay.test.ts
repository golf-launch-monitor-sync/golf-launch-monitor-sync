// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A target's test scenario played back (spec/test-mode.md), days in milliseconds: the same chunks as the real
 * provider against a Trackman with the same answers, never past the guard's limits, `test` on every batch, the
 * scenario's response times, the scenario's subject as the guard's account - and never a request to the network.
 */
import { Guard, guardAccount, HttpTarget, LIMITS, MemoryStorage, pair, sync, type FetchLike, type ProviderContext } from '@glmsync/core';
import { FakeTarget, VirtualClock, type PlanAsked } from '@glmsync/core/testing';
import { readTestScenario, type Reason, type TestScenario } from '@glmsync/spec';
import { afterEach, describe, expect, it } from 'vitest';
import { trackman, type TrackmanProvider } from './index.ts';
import { DEFAULT_LATENCY, latencyFromLog, latencyOf, sampleMs } from './latency.ts';
import { NotTrackmanScenario, replay } from './replay.ts';
import { FakeTrackman, fakeToken, type Json } from './testing.ts';

const DAY = 86_400_000;
const START = Date.parse('2026-11-21T08:00:00Z');
const SUBJECT = 'test-T17-leon-0001';
const LATENCY = { default: { median_s: 1, spread_s: 0.3 }, queries: { Session: { median_s: 2, spread_s: 0.5 }, RoundShots: { median_s: 3, spread_s: 1 } } };
const HALF = () => 0.5;

const card = (id: string, startedAt: string) => ({ id, startedAt, course: { displayName: 'Example Links' }, par: 72, grossScore: 90 });
const hole = (n: number) => ({ holeNumber: n, pinPosition: { x: 10, z: 20 }, shots: [{ shotNumber: 1, club: 'Iron8', launchLie: 'Tee', finalLie: 'Green', launchPosition: { x: 10, z: 170 }, finalPosition: { x: 12, z: 25 } }] });

/** Made up: `n` sessions back from yesterday, a few rounds, in Trackman's shapes. */
function data(n: number): Json {
  const activities = Array.from({ length: n }, (_, i) => ({
    __typename: i % 3 ? 'SimulatorSessionActivity' : 'RangePracticeActivity',
    id: `S${i}`,
    time: new Date(START - DAY - i * 1.4 * DAY).toISOString(),
    kind: i % 3 ? 'SIMULATOR' : 'RANGE_PRACTICE',
  }));
  const nodes = Object.fromEntries(activities.map((a) => [a.id, { strokes: [{ club: 'Iron7', measurement: { carry: 140 + (Number(a.id.slice(1)) % 9), ballSpeed: 50 } }] }]));
  const scorecards = [card('R2', new Date(START - 2 * DAY).toISOString()), card('R1', new Date(START - 20 * DAY).toISOString())];
  return { activities, nodes, scorecards, shotHoles: { R2: [hole(1)], R1: [hole(1), hole(2)] } };
}

function scenario(over: Partial<TestScenario> = {}, n = 150): TestScenario {
  const read = readTestScenario(
    { name: 'Leon (test T17)', provider: 'trackman', subject: SUBJECT, profile: { fullName: 'Leon Made-Up' }, data: data(n), latency: LATENCY, valid_until: '2026-12-21T18:00:00+01:00', ...over },
    new Date(START).toISOString(),
  );
  if (!read.ok) throw new Error(read.error);
  return read.scenario;
}

/** A target that plans like the reference: a regular sync 45 minutes after the last, the history in chunks of 10, 90 s apart. */
function planner(clock: VirtualClock) {
  return (ask: PlanAsked, t: FakeTarget): Json => {
    const imports = t.imports.map((b) => ({ reason: b.sync?.reason, at: Date.parse(b.generated_at), more: b.progress?.more_available }));
    const done = imports.some((i) => i.reason === 'backfill' && i.more === false);
    const last = (r: string) => Math.max(-Infinity, ...imports.filter((i) => i.reason === r).map((i) => i.at));
    const base = { plan_id: `pl_${clock.t}`, known_ids: t.known() };
    if (ask.reason === 'backfill') {
      return done || clock.t - last('backfill') < 90_000
        ? { due: false, history: { done } }
        : { ...base, due: true, since: '2011-01-01T00:00:00Z', max_sessions: 10, rounds: true, round_shots: false };
    }
    return clock.t - last('timer') < 45 * 60_000
      ? { due: false }
      : { ...base, due: true, since: new Date(clock.t - 3 * DAY).toISOString(), max_sessions: 40, rounds: true, round_shots: true };
  };
}

/** Every provider request stays within the rolling hour's and day's limits. */
function busiest(times: number[]): { hour: number; day: number } {
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

const noNetwork: FetchLike = async (url) => {
  throw new Error(`no network in a test: ${url}`);
};

async function timeLapse(make: (clock: VirtualClock) => { provider: TrackmanProvider; credential: string; fake: FakeTrackman; fetch: FetchLike }) {
  const clock = new VirtualClock(START);
  const { provider, credential, fake, fetch } = make(clock);
  const target = new FakeTarget({ plan: planner(clock) });
  target.testAccount = true;
  const pairing = await pair({ target: target.base, code: 'K7M2PQ9X', provider: 'trackman', client: { kind: 'companion', name: 'Test' }, fetch: target.fetch });
  const http = new HttpTarget(pairing, { fetch: target.fetch, now: clock.now });
  const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep, random: HALF });
  const perRun: number[] = [];
  let doneAt: number | null = null;
  while (clock.t < START + 5 * DAY && doneAt === null) {
    for (const reason of ['timer', 'backfill'] as Reason[]) {
      const before = fake.requests.length;
      const out = await sync({ target: http, provider, credential, reason, client: 'companion', guard, fetch, now: clock.now, sleep: clock.sleep });
      expect(['synced', 'not_due']).toContain(out.status);
      perRun.push(fake.requests.length - before);
    }
    if (target.imports.some((b) => b.sync?.reason === 'backfill' && b.progress?.more_available === false)) doneAt = clock.t;
    clock.advance(60_000);
  }
  return { target, fake, guard, perRun, doneAt };
}

describe('a test scenario played back', () => {
  it('the first sync after connecting comes in parts while it fetches, played back as from Trackman (LMS-AS-6)', async () => {
    const sc = scenario({}, 10);
    const firstSync = async (make: (clock: VirtualClock) => { provider: TrackmanProvider; credential: string; fetch: FetchLike }) => {
      const clock = new VirtualClock(START);
      const { provider, credential, fetch } = make(clock);
      const plan = (_: PlanAsked, t: FakeTarget): Json => ({ due: true, plan_id: 'pl_1', known_ids: t.known(), since: new Date(START - 90 * DAY).toISOString(), max_sessions: 40, rounds: true, round_shots: true });
      const target = new FakeTarget({ plan });
      target.testAccount = true;
      const pairing = await pair({ target: target.base, code: 'K7M2PQ9X', provider: 'trackman', client: { kind: 'companion', name: 'Test' }, fetch: target.fetch });
      const http = new HttpTarget(pairing, { fetch: target.fetch, now: clock.now });
      const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep, random: HALF });
      const out = await sync({ target: http, provider, credential, reason: 'connect', client: 'companion', guard, fetch, now: clock.now, sleep: clock.sleep });
      return { out, target };
    };
    const real = await firstSync((clock) => {
      const tm = new FakeTrackman(clock.now).load(sc.data);
      const credential = fakeToken(SUBJECT);
      tm.tokens.add(credential);
      tm.delay = (req) => sampleMs(latencyOf(sc.latency, req.name), HALF);
      tm.sleep = clock.sleep;
      return { provider: trackman(), credential, fetch: tm.fetch };
    });
    const played = await firstSync((clock) => {
      const r = replay(sc, { now: clock.now, sleep: clock.sleep, random: HALF });
      return { provider: r, credential: r.credential, fetch: noNetwork };
    });
    expect(played.out).toMatchObject({ status: 'synced', result: { sessions: 10, rounds: 2 } });
    const imports = played.target.imports;
    expect(imports.length).toBeGreaterThanOrEqual(5); // a part every two sessions or so, then the last
    expect(imports.slice(0, -1).every((b) => b.sync === undefined && b.rounds.length === 0 && b.sessions.length > 0)).toBe(true);
    expect(imports.at(-1)).toMatchObject({ sync: { reason: 'connect', plan_id: 'pl_1' }, progress: { more_available: false } });
    expect(imports.at(-1)?.rounds.map((r) => r.external_id)).toEqual(['R2', 'R1']);
    expect(imports.every((b) => b.test === true)).toBe(true);
    // The parts' times grow with the fetch: the first came well before the last.
    expect(Date.parse(imports.at(-1)?.generated_at ?? '') - Date.parse(imports[0]?.generated_at ?? '')).toBeGreaterThan(10_000);
    // The same parts as from Trackman with the same answers: only `test` tells them apart.
    expect(imports.map(({ test: _, ...b }) => b)).toEqual(real.target.imports);
  });

  it('brings the same chunks as the real provider with the same answers, test on each, never past the limits', async () => {
    const sc = scenario();
    const real = await timeLapse((clock) => {
      const tm = new FakeTrackman(clock.now).load(sc.data);
      const credential = fakeToken(SUBJECT);
      tm.tokens.add(credential);
      tm.delay = (req) => sampleMs(latencyOf(sc.latency, req.name), HALF);
      tm.sleep = clock.sleep;
      return { provider: trackman(), credential, fake: tm, fetch: tm.fetch };
    });
    let asked = 0;
    const played = await timeLapse((clock) => {
      const r = replay(sc, { now: clock.now, sleep: clock.sleep, random: HALF });
      r.fake.keep = Number.POSITIVE_INFINITY; // the whole record, for the limits below
      const counting: FetchLike = async (url, init) => {
        asked += 1;
        return noNetwork(url, init);
      };
      return { provider: r, credential: r.credential, fake: r.fake, fetch: counting };
    });

    expect(asked).toBe(0); // Trackman (or anyone) never asked: the fake answered everything
    expect(played.target.sessions.size).toBe(150);
    expect(played.target.rounds.size).toBe(2);
    expect(played.doneAt).not.toBeNull();
    expect((played.doneAt as number) - START).toBeGreaterThan(3600_000); // over hours (the plan and the guard set the pace), not at once
    expect(played.target.imports.length).toBeGreaterThan(5);
    expect(played.target.imports.every((b) => b.test === true)).toBe(true);
    expect(real.target.imports.some((b) => 'test' in b)).toBe(false);
    // The same batches, chunk for chunk, at the same times: only `test` tells them apart.
    expect(played.target.imports.map(({ test: _, ...b }) => b)).toEqual(real.target.imports);
    expect(played.fake.requests.map((r) => [r.name, r.at, r.variables])).toEqual(real.fake.requests.map((r) => [r.name, r.at, r.variables]));
    // Within the guard's limits, a run, an hour, a day.
    expect(Math.max(...played.perRun)).toBeLessThanOrEqual(LIMITS.per_run);
    const { hour, day } = busiest(played.fake.requests.map((r) => r.at));
    expect(hour).toBeLessThanOrEqual(LIMITS.per_hour);
    expect(day).toBeLessThanOrEqual(LIMITS.per_day);
  });

  it('counts under the scenario’s subject, at the scenario’s response times', async () => {
    const sc = scenario({}, 12);
    const { guard } = await timeLapse((clock) => {
      const r = replay(sc, { now: clock.now, sleep: clock.sleep, random: HALF });
      return { provider: r, credential: r.credential, fake: r.fake, fetch: noNetwork };
    });
    const log = await guard.exportLog();
    expect(log.accounts.map((a) => a.account)).toEqual([guardAccount('trackman', SUBJECT)]);
    const took = (kind: string) => [...new Set(log.accounts[0]?.requests.filter((r) => r.kind === kind).map((r) => r.ms))];
    expect(took('session')).toEqual([sampleMs(LATENCY.queries.Session, HALF)]);
    expect(took('list')).toEqual([sampleMs(LATENCY.default, HALF)]);
    // And the profile read back from that log is the scenario's.
    const back = latencyFromLog(log);
    expect(back.queries.Session?.median_s).toBeCloseTo(sampleMs(LATENCY.queries.Session, HALF) / 1000, 2);
  });

  it('answers “Is this you?” with the scenario’s profile and account, through the guard', async () => {
    const clock = new VirtualClock(START);
    const r = replay(scenario({}, 7), { now: clock.now, sleep: clock.sleep, random: HALF });
    expect(r.test).toBe(true);
    expect(r.subject(r.credential)).toBe(SUBJECT);
    const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep });
    const account = guardAccount('trackman', SUBJECT);
    await guard.beginRun(account);
    const ctx: ProviderContext = { reason: 'connect', now: clock.now, guarded: (kind, send) => guard.request(account, kind, send), http: () => Promise.reject(new Error('no network')) };
    expect(await r.who(ctx, r.credential)).toEqual({ player: 'Leon Made-Up', activities: { count: 7, last: expect.any(String), place: null } });
    expect((await guard.counts(account)).run).toBe(1);
  });

  it('refuses another provider’s scenario, and takes data of the wrong shape as none', () => {
    expect(() => replay({ ...scenario({}, 1), provider: 'demo' })).toThrow(NotTrackmanScenario);
    const tm = new FakeTrackman().load({ activities: 'all', nodes: [1], scorecards: [null, 3, { id: 'R' }], shotHoles: null });
    expect(tm.activities).toEqual([]);
    expect(tm.scorecards).toEqual([{ id: 'R' }]);
    expect(tm.nodes.size).toBe(0);
    expect(new FakeTrackman().load(undefined).activities).toEqual([]);
  });

  describe('on a phone’s engine', () => {
    const had = (globalThis as { Buffer?: unknown }).Buffer;
    afterEach(() => {
      (globalThis as { Buffer?: unknown }).Buffer = had;
    });

    it('needs no Buffer', async () => {
      (globalThis as { Buffer?: unknown }).Buffer = undefined;
      const r = replay(scenario({}, 3));
      expect(r.subject(r.credential)).toBe(SUBJECT);
      expect(fakeToken('x')).toMatch(/^[\w-]+\.[\w-]+\.sig$/);
    });
  });
});

describe('response times', () => {
  it('fall about the median, never below nothing, never past three spreads or a minute', () => {
    const l = { median_s: 2, spread_s: 0.5 };
    expect(sampleMs(l, HALF)).toBe(Math.round((2 - 0.5 * Math.sqrt(2 * Math.log(2))) * 1000));
    for (const r of [() => 0, () => 1e-12, () => 0.999999]) {
      const ms = sampleMs(l, r);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(3500);
    }
    expect(sampleMs({ median_s: 59, spread_s: 60 }, () => 1e-9)).toBeLessThanOrEqual(60_000);
    expect(sampleMs({ median_s: 0, spread_s: 0 })).toBe(0);
  });

  it('come from the scenario, its default, then this module’s', () => {
    expect(latencyOf(LATENCY, 'Session')).toEqual(LATENCY.queries.Session);
    expect(latencyOf(LATENCY, 'Activities')).toEqual(LATENCY.default);
    expect(latencyOf({ queries: {} }, 'RoundShots')).toEqual(DEFAULT_LATENCY.queries.RoundShots);
    expect(latencyOf(undefined, 'Unknown')).toEqual(DEFAULT_LATENCY.default);
  });

  it('read out of a request log: answers only, by kind, robust to a stray one, nothing from junk', () => {
    const log = {
      format: 'glmsync-guard-log/1',
      accounts: [
        {
          account: 'g1_x',
          requests: [
            ...[900, 1000, 1100, 1000, 30_000].map((ms) => ({ at: '2026-11-20T10:00:00Z', kind: 'session', status: 200, ms })),
            { at: '2026-11-20T10:00:00Z', kind: 'session', status: 429, ms: 50 },
            ...[800, 800].map((ms) => ({ at: '2026-11-20T10:00:00Z', kind: 'list', status: 200, ms })),
            { kind: 'other', status: 200, ms: 5 },
            null,
          ],
        },
      ],
    };
    const p = latencyFromLog(log);
    expect(p.queries).toEqual({ Session: { median_s: 1, spread_s: 0.15 } }); // two lists are too few on their own
    expect(p.default?.median_s).toBe(1);
    for (const junk of [null, 'log', { accounts: 'x' }, { accounts: [{ requests: 3 }] }]) expect(latencyFromLog(junk)).toEqual({ queries: {} });
  });
});
