// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Fetching a player's own Trackman data against a made-up Trackman (no network, no real token), at
 * the pace of the guard on a clock that runs as fast as the test wants. The answers are invented in
 * Trackman's shapes; nothing here was recorded from an account.
 */
import { Guard, guardAccount, MemoryStorage, providerContext, readPlan, type Plan } from '@glmsync/core';
import { VirtualClock } from '@glmsync/core/testing';
import type { Reason } from '@glmsync/spec';
import { beforeEach, describe, expect, it } from 'vitest';
import { subjectOf } from './account.ts';
import { GRAPHQL_URL } from './client.ts';
import { fetchForPlan, freshState, MAX_REFUSALS, MAX_STROKES_PER_SESSION, MEASURED_OFF_MS, who, type TrackmanState } from './fetch.ts';
import { FakeTrackman, fakeToken, respond, type Json } from './testing.ts';

const TOKEN = fakeToken('7c1d2e3f-0000-4000-8000-000000000001');
const stroke = (carry: number) => ({ time: '2026-11-10T17:06:12Z', club: 'Iron7', measurement: { carry, ballSpeed: 50 } });
const act = (id: string, time = '2026-11-10T17:05:00Z', kind = 'SIMULATOR'): Json => ({ id, time, kind, location: { name: 'Example Hall' } });
const card = (id: string, startedAt: string) => ({ id, startedAt, course: { displayName: 'Example Links' }, par: 72, grossScore: 90 });
const hole = (n: number) => ({ holeNumber: n, pinPosition: { x: 10, z: 20 }, shots: [{ shotNumber: 1, club: 'Iron8', launchLie: 'Tee', finalLie: 'Green', launchPosition: { x: 10, z: 170 }, finalPosition: { x: 12, z: 25 } }] });

let clock: VirtualClock;
let tm: FakeTrackman;
let guard: Guard;
let state: TrackmanState;
const ACCOUNT = guardAccount('trackman', subjectOf(TOKEN));

beforeEach(() => {
  clock = new VirtualClock(Date.parse('2026-11-16T12:00:00Z'));
  tm = new FakeTrackman(clock.now);
  tm.tokens.add(TOKEN);
  guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep, random: () => 0.5 });
  state = freshState();
});

async function run(plan: Json, reason: Reason = 'timer', token = TOKEN) {
  await guard.beginRun(ACCOUNT);
  const ctx = providerContext({ guard, account: ACCOUNT, fetch: tm.fetch, now: clock.now, reason, pace: 1 });
  return fetchForPlan(readPlan({ due: true, since: '2026-08-01T00:00:00Z', max_sessions: 40, ...plan }) as Plan, token, ctx, state);
}

describe('one sync', () => {
  it('tells each session as soon as it has it, so a first sync can hand it over while it fetches (LMS-AS-6)', async () => {
    tm.activities = [act('A1'), act('A2'), act('A3')];
    tm.nodes.set('A1', { strokes: [stroke(140)] });
    tm.nodes.set('A3', { strokes: [stroke(150), stroke(151)] });
    tm.nodes.set('A2', { strokes: 'broken' }); // the shots themselves failed at Trackman
    const told: { ids: string[]; requests: number }[] = [];
    await guard.beginRun(ACCOUNT);
    const ctx = providerContext({
      guard, account: ACCOUNT, fetch: tm.fetch, now: clock.now, reason: 'connect', pace: 1,
      got: ({ sessions }) => void told.push({ ids: sessions.map((s) => s.external_id), requests: tm.requests.length }),
    });
    const out = await fetchForPlan(readPlan({ due: true, since: '2026-08-01T00:00:00Z', max_sessions: 40 }) as Plan, TOKEN, ctx, state);
    // Right after its own request, before the next one; one Trackman didn't send isn't told (it goes as failed).
    expect(told).toEqual([{ ids: ['A1'], requests: 2 }, { ids: ['A3'], requests: 4 }]);
    expect(out.sessions.map((s) => s.external_id)).toEqual(['A1', 'A3']);
    expect(out.failed.map((f) => f.external_id)).toEqual(['A2']);
  });

  it('skips played rounds, known and given-up sessions, and brings the rest', async () => {
    tm.activities = [act('A1'), act('G1', '2026-11-09T10:00:00Z', 'COURSE_PLAY'), act('K1'), act('X1'), act('A2', '2026-11-01T10:00:00Z')];
    tm.nodes.set('A1', { strokes: [stroke(140), null, stroke(150)] });
    const out = await run({ known_ids: ['K1'], give_up: ['X1'] });
    expect(out.sessions.map((s) => [s.external_id, s.shots.length])).toEqual([['A1', 2], ['A2', 0]]);
    expect(out.progress).toEqual({ more_available: false, skipped_known: 1, oldest_seen: '2026-11-01T10:00:00Z', sessions_left: 0, oldest_listed: '2026-11-01T10:00:00Z' });
    expect(tm.requests.map((r) => r.name)).toEqual(['Activities', 'Session', 'Session']);
    expect(out.notice).toBeUndefined();
  });

  it('asks one request at a time with the guard’s pause between, and counts each', async () => {
    tm.activities = [act('A1'), act('A2'), act('A3')];
    await run({});
    const gaps = tm.requests.slice(1).map((r, i) => r.at - (tm.requests[i]?.at ?? 0));
    expect(gaps).toEqual([2000, 2000, 2000]); // 1–3 s at random (here the middle), never on the beat
    expect(await guard.counts(ACCOUNT)).toMatchObject({ run: 4, hour: 4, day: 4 });
  });

  it('asks Trackman with the sign-in it was given, and nothing else of the browser', async () => {
    tm.activities = [act('A1')];
    await run({});
    for (const r of tm.requests) {
      expect(r.token).toBe(TOKEN);
      expect(r.credentials).toBe('omit');
      expect(Object.keys(r.headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type']);
    }
  });

  it('stops at the sessions the plan allows and says more is waiting, back to where it got', async () => {
    tm.activities = Array.from({ length: 6 }, (_, i) => act(`A${i}`, `2026-11-1${i}T10:00:00Z`)).reverse();
    const out = await run({ max_sessions: 2 });
    expect(out.sessions.map((s) => s.external_id)).toEqual(['A5', 'A4']);
    expect(out.progress).toMatchObject({ more_available: true, oldest_seen: '2026-11-14T10:00:00Z' });
  });

  it('says how many sessions of the listed window are still to come, and the oldest activity listed (spec 1.7.0)', async () => {
    tm.activities = [
      act('A1', '2026-11-14T10:00:00Z'),
      act('K1', '2026-11-13T10:00:00Z'),
      act('G1', '2026-11-12T10:00:00Z', 'COURSE_PLAY'),
      act('A2', '2026-11-11T10:00:00Z'),
      act('X1', '2026-11-10T10:00:00Z'),
      act('A3', '2026-11-09T10:00:00Z'),
      act('A4', '2026-11-08T10:00:00Z'),
      act('G2', '2023-03-04T09:00:00Z', 'COURSE_PLAY'),
    ];
    const out = await run({ since: '2011-11-16T12:00:00Z', max_sessions: 2, known_ids: ['K1'], give_up: ['X1'] }, 'backfill');
    expect(out.sessions.map((s) => s.external_id)).toEqual(['A1', 'A2']);
    // A3 and A4 wait; K1 is the target's, X1 given up, G1 and G2 are rounds.
    expect(out.progress).toMatchObject({ more_available: true, sessions_left: 2, oldest_listed: '2023-03-04T09:00:00Z' });
  });

  it('says nothing is left once all came, and leaves both out when it listed nothing', async () => {
    tm.activities = [act('A1', '2026-11-14T10:00:00Z')];
    expect((await run({})).progress).toMatchObject({ more_available: false, sessions_left: 0, oldest_listed: '2026-11-14T10:00:00Z' });
    tm.activities = [];
    const none = await run({});
    expect(none.progress?.sessions_left).toBe(0);
    expect(none.progress?.oldest_listed).toBeUndefined();
    tm.override = (r) => (r.name === 'Activities' ? respond(503, '<html>maintenance</html>', { 'Retry-After': '60' }) : null);
    const failed = await run({}, 'manual');
    expect(failed.progress).not.toHaveProperty('sessions_left');
    expect(failed.progress).not.toHaveProperty('oldest_listed');
  });

  it('counts what a session’s trouble left unasked, when the fetch stopped half way', async () => {
    tm.activities = [act('A1'), act('A2'), act('A3')];
    tm.nodes.set('A1', { strokes: [stroke(140)] });
    tm.override = (r) => (r.name === 'Session' && r.variables.id === 'A2' ? respond(503, '<html>maintenance</html>', { 'Retry-After': '60' }) : null);
    const out = await run({});
    expect(out.notice).toBeDefined();
    expect(out.progress?.sessions_left).toBe(2);
  });

  it('pages the activities in hundreds and stops when it has them all', async () => {
    tm.activities = Array.from({ length: 230 }, (_, i) => act(`A${i}`));
    const out = await run({ max_sessions: 0, known_ids: [] });
    expect(tm.requests.filter((r) => r.name === 'Activities').map((r) => r.variables.skip)).toEqual([0, 100, 200]);
    expect(out.progress?.more_available).toBe(true);
  });

  it('keeps a session of a kind the query does not know, without shots; one whose shots failed waits', async () => {
    tm.activities = [act('NEW'), act('BAD', '2026-11-09T10:00:00Z'), act('GONE')];
    tm.nodes.set('NEW', { __typename: 'FutureActivity', id: 'NEW' });
    tm.nodes.set('BAD', { strokes: 'failed' });
    tm.nodes.set('GONE', null);
    const out = await run({});
    expect(out.sessions.map((s) => [s.external_id, s.shots.length])).toEqual([['NEW', 0]]);
    expect(out.failed).toEqual([{ external_id: 'BAD', started_at: '2026-11-09T10:00:00Z' }, { external_id: 'GONE', started_at: '2026-11-10T17:05:00Z' }]);
  });

  it("asks each session with its own type only, so Trackman's types can't clash", async () => {
    tm.activities = [
      { ...act('SIM'), __typename: 'SimulatorSessionActivity' },
      { ...act('RANGE', '2026-11-10T16:00:00Z', 'RANGE_PRACTICE'), __typename: 'RangePracticeActivity' },
      act('OLD', '2026-11-10T15:00:00Z'), // no type in the list: the interface
    ];
    for (const id of ['SIM', 'RANGE', 'OLD']) tm.nodes.set(id, { strokes: [stroke(140)] });
    const out = await run({});
    expect(out.failed).toEqual([]);
    expect(out.sessions.map((s) => [s.external_id, s.shots.length])).toEqual([['SIM', 1], ['RANGE', 1], ['OLD', 1]]);
    const asked = Object.fromEntries(tm.requests.filter((r) => r.name === 'Session').map((r) => [String(r.variables.id), r.query]));
    expect(asked.SIM).toContain('... on SimulatorSessionActivity');
    expect(asked.SIM).toContain('clubPath');
    expect(asked.RANGE).toContain('... on RangePracticeActivity');
    expect(asked.RANGE).toContain('ballSpin');
    expect(asked.OLD).toContain('... on SessionActivity');
    expect(tm.requests.find((r) => r.name === 'Activities')?.query).toMatch(/items \{\s*__typename id time kind/);
  });

  it('asks once more for a session Trackman answered with errors, and takes what came', async () => {
    tm.activities = [act('A1')];
    tm.nodes.set('A1', { strokes: [stroke(140), stroke(141)] });
    let n = 0;
    tm.override = (r) => (r.name === 'Session' && n++ === 0 ? respond(200, { data: { node: { strokes: [stroke(140)] } }, errors: [{ message: 'one field' }] }) : null);
    const out = await run({});
    expect(out.sessions[0]?.shots).toHaveLength(2); // the second answer, complete
    expect(tm.count('Session')).toBe(2);
  });

  it('keeps one session to what a session ever holds', async () => {
    tm.activities = [act('A1')];
    tm.nodes.set('A1', { strokes: Array.from({ length: MAX_STROKES_PER_SESSION + 50 }, (_, i) => stroke(100 + (i % 50))) });
    expect((await run({})).sessions[0]?.shots).toHaveLength(MAX_STROKES_PER_SESSION);
  });

  it('works out how far back itself when the plan doesn’t say', async () => {
    await run({ since: undefined });
    expect(tm.requests[0]?.variables.timeFrom).toBe('2026-08-18T12:00:00.000Z'); // 90 days
  });
});

describe('trouble with Trackman ends the fetch, and what it has goes on', () => {
  beforeEach(() => {
    tm.activities = [act('A1'), act('A2'), act('A3')];
  });

  it('a refused sign-in: auth_expired, nothing more asked', async () => {
    let n = 0;
    tm.override = (r) => (r.name === 'Session' && ++n === 2 ? respond(401, {}) : null);
    const out = await run({});
    expect(out.sessions.map((s) => s.external_id)).toEqual(['A1']);
    expect(out.notice).toMatchObject({ code: 'auth_expired' });
    expect(out.progress?.more_available).toBe(true);
    expect(tm.count()).toBe(3);
  });

  it('a 503 with Retry-After: provider_unavailable until then, and the guard waits as long', async () => {
    tm.override = (r) => (r.name === 'Session' ? respond(503, '<html>maintenance</html>', { 'Retry-After': '7200' }) : null);
    const out = await run({});
    expect(out.notice).toMatchObject({ code: 'provider_unavailable', until: expect.any(String) });
    expect(tm.count('Session')).toBe(1);
    expect((await guard.counts(ACCOUNT)).blocked_until).not.toBeNull();
    expect((await run({})).notice).toMatchObject({ code: 'guard_limit' });
    expect(tm.count()).toBe(2); // the guard sent nothing more
  });

  it('no network (or a browser that may not ask): provider_blocked', async () => {
    tm.override = () => new TypeError('Failed to fetch');
    expect((await run({})).notice).toMatchObject({ code: 'provider_blocked' });
  });

  it('a page of the list with errors is not the end of it', async () => {
    tm.override = (r) => (r.name === 'Activities' ? respond(200, { data: { me: { activities: { items: [] } } }, errors: [{ message: 'timeout' }] }) : null);
    const out = await run({});
    expect(out.notice).toMatchObject({ code: 'partial' });
    expect(out.progress?.more_available).toBe(true);
    expect(tm.count('Session')).toBe(0);
  });

  it('a sign-in that is no sign-in asks nothing', async () => {
    const out = await run({}, 'timer', '');
    expect(out.notice).toMatchObject({ code: 'auth_expired' });
    expect(tm.count()).toBe(0);
  });
});

describe('rounds', () => {
  it('lists them only when the plan says, pages to the window and skips the known ones', async () => {
    tm.scorecards = [card('R3', '2026-11-12T18:00:00Z'), card('R2', '2026-10-01T18:00:00Z'), card('R1', '2026-07-01T18:00:00Z')];
    expect((await run({})).rounds).toEqual([]);
    expect(tm.count('Rounds')).toBe(0);
    const out = await run({ rounds: true, known_ids: ['R2'] });
    expect(out.rounds.map((r) => r.external_id)).toEqual(['R3']);
    expect(tm.requests.filter((r) => r.name === 'Rounds').map((r) => r.variables.take)).toEqual([50]);
  });

  it('asks for few scorecards on a regular sync, whole pages for a long window', async () => {
    await run({ rounds: true, since: '2026-11-10T00:00:00Z' });
    expect(tm.requests.find((r) => r.name === 'Rounds')?.variables.take).toBe(10);
  });
});

describe('each shot of a round', () => {
  it('comes with the sync that brings a new round, in one request', async () => {
    tm.scorecards = [card('R_NEW', '2026-11-12T18:00:00Z')];
    tm.shotHoles.set('R_NEW', [hole(1)]);
    const out = await run({ rounds: true, round_shots: true });
    expect(out.rounds).toHaveLength(1);
    expect(out.rounds[0]?.shots).toEqual([expect.objectContaining({ hole: 1, number: 1, club: '8i', to_pin_before_m: 150, to_pin_after_m: 5.39 })]);
    expect(tm.requests.filter((r) => r.name === 'RoundShots').map((r) => r.variables)).toEqual([{ skip: 0, take: 5 }]);
  });

  it('pages for the known rounds the target names, and says which Trackman no longer lists', async () => {
    tm.scorecards = Array.from({ length: 12 }, (_, i) => card(`SC${i}`, `2026-10-${String(28 - i).padStart(2, '0')}T18:00:00Z`));
    for (const sc of tm.scorecards) tm.shotHoles.set(String(sc.id), [hole(1)]);
    const out = await run({ round_shots: true, rounds_wanted: [
      { external_id: 'SC1', played_at: '2026-10-27T18:00:00Z' },
      { external_id: 'SC7', played_at: '2026-10-21T18:00:00Z' },
      { external_id: 'GONE', played_at: '2026-10-25T18:00:00Z' },
    ] });
    expect(out.rounds.map((r) => [r.external_id, r.shots?.length])).toEqual([['SC1', 1], ['SC7', 1], ['GONE', 0]]);
    expect(tm.requests.filter((r) => r.name === 'RoundShots').map((r) => r.variables.skip)).toEqual([0, 5]);
  });

  it('costs the shots, not the sync, when they fail - and is not tried again for six hours', async () => {
    tm.activities = [act('A1')];
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.override = (r) => (r.name === 'RoundShots' ? respond(400, { errors: [{ message: 'Cannot query field' }] }) : null);
    const out = await run({ rounds: true, round_shots: true });
    expect(out.sessions).toHaveLength(1);
    expect(out.rounds.map((r) => r.external_id)).toEqual(['R1']);
    expect(out.notice).toMatchObject({ code: 'partial' });
    await run({ rounds: true, round_shots: true });
    expect(tm.count('RoundShots')).toBe(1);
    clock.advance(6 * 3600_000);
    await run({ rounds: true, round_shots: true });
    expect(tm.count('RoundShots')).toBe(2);
  });
});

describe("a round's shots with their ball and club data (spec 1.4.0)", () => {
  const measuredHole = () => ({
    ...hole(1),
    shots: [{ ...hole(1).shots[0], measurement: { carry: 141.5, total: 150.2, ballSpeed: 50.3, launchAngle: 17.4, spinRate: 6650, clubSpeed: 36.1 } }],
  });

  it('asks for them, and the round says it did', async () => {
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.shotHoles.set('R1', [measuredHole()]);
    const out = await run({ rounds: true, round_shots: true });
    const asked = tm.requests.filter((r) => r.name === 'RoundShots');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.query).toContain('ballSpeed');
    expect(out.rounds[0]?.shots_measured).toBe(true);
    expect(out.rounds[0]?.shots?.[0]).toMatchObject({
      carry_m: 141.5, total_m: 150.2,
      ball: { speed_mps: 50.3, launch_angle_deg: 17.4, spin_rpm: 6650 }, club_delivery: { speed_mps: 36.1 },
    });
  });

  it('asks again without them where Trackman refuses them, and not with them for a day', async () => {
    tm.refuseMeasured = true;
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.shotHoles.set('R1', [measuredHole()]);
    const out = await run({ rounds: true, round_shots: true });
    expect(out.notice).toBeUndefined();
    expect(out.rounds[0]?.shots_measured).toBeUndefined();
    expect(out.rounds[0]?.extra).toEqual({ round_shots_refused: 'Trackman: Unexpected Execution Error' });
    expect(out.rounds[0]?.shots?.[0]).toMatchObject({ hole: 1, number: 1, carry_m: 141.5 });
    expect(tm.requests.filter((r) => r.name === 'RoundShots').map((r) => r.query.includes('ballSpeed'))).toEqual([true, false]);

    tm.scorecards = [card('R2', '2026-11-13T18:00:00Z'), ...tm.scorecards];
    tm.shotHoles.set('R2', [measuredHole()]);
    await run({ rounds: true, round_shots: true });
    expect(tm.requests.filter((r) => r.name === 'RoundShots').map((r) => r.query.includes('ballSpeed'))).toEqual([true, false, false]);

    clock.advance(MEASURED_OFF_MS);
    tm.refuseMeasured = false;
    tm.scorecards = [card('R3', '2026-11-14T18:00:00Z'), ...tm.scorecards];
    tm.shotHoles.set('R3', [measuredHole()]);
    const later = await run({ rounds: true, round_shots: true });
    expect(tm.requests.filter((r) => r.name === 'RoundShots').map((r) => r.query.includes('ballSpeed'))).toEqual([true, false, false, true]);
    expect(later.rounds.find((r) => r.external_id === 'R3')?.shots_measured).toBe(true);
  });

  it('asks a round shot\'s spin by its bay name only', async () => {
    // Trackman's round shot has no `ballSpin` (refused on the first real sync, 19 Nov): asking it cost a request.
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.shotHoles.set('R1', [measuredHole()]);
    await run({ rounds: true, round_shots: true });
    const asked = tm.requests.filter((r) => r.name === 'RoundShots');
    expect(asked).toHaveLength(1);
    expect(asked[0]?.query).toMatch(/\bspinRate\b/);
    expect(asked[0]?.query).not.toMatch(/\bballSpin\b/);
  });

  it('leaves out only the fields Trackman refuses by name, keeps them out, and tells the round', async () => {
    tm.refuseFields = ['spinRate', 'curve'];
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.shotHoles.set('R1', [measuredHole()]);
    const out = await run({ rounds: true, round_shots: true });
    const asked = tm.requests.filter((r) => r.name === 'RoundShots');
    expect(asked).toHaveLength(2); // both named in the one refusal
    expect(asked[1]?.query).toContain('ballSpeed');
    expect(asked[1]?.query).not.toMatch(/\bspinRate\b|\bcurve\b/);
    expect(asked[1]?.query).toContain('spinAxis'); // the rest is still asked
    const r = out.rounds[0];
    expect(r?.shots_measured).toBe(true);
    expect(r?.shots?.[0]).toMatchObject({ ball: { speed_mps: 50.3, launch_angle_deg: 17.4 } });
    expect(r?.extra).toMatchObject({ round_shot_fields_refused: ['spinRate', 'curve'] });
    expect(String(r?.extra?.round_shots_refused)).toContain('spinRate');
    expect(state.refused).toEqual(['spinRate', 'curve']);

    // The next fetch leaves them out from the start.
    tm.scorecards = [card('R2', '2026-11-13T18:00:00Z'), ...tm.scorecards];
    tm.shotHoles.set('R2', [measuredHole()]);
    await run({ rounds: true, round_shots: true });
    expect(tm.requests.filter((r) => r.name === 'RoundShots')).toHaveLength(3);
  });

  it('gives up on naming after MAX_REFUSALS and asks without the values, as before', async () => {
    // A fake that refuses one more field each time.
    const order = ['clubSpeed', 'clubPath', 'faceAngle', 'ballSpeed', 'smashFactor', 'carrySide'];
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.shotHoles.set('R1', [measuredHole()]);
    let n = 0;
    tm.override = (r) => {
      if (r.name !== 'RoundShots' || !r.query.includes(order[Math.min(n, order.length - 1)] as string)) return null;
      const f = order[n++] as string;
      return respond(200, { errors: [{ message: `The field \`${f}\` does not exist on the type \`ShotMeasurement\`.` }] });
    };
    const out = await run({ rounds: true, round_shots: true });
    expect(tm.requests.filter((r) => r.name === 'RoundShots')).toHaveLength(MAX_REFUSALS + 2);
    expect(out.rounds[0]?.shots_measured).toBeUndefined();
    expect(out.rounds[0]?.shots?.[0]).toMatchObject({ carry_m: 141.5 });
    expect(state.measuredOffUntil).toBeGreaterThan(0);
  });

  it('keeps asking with them when the round shots fail either way (trouble with Trackman, not with the fields)', async () => {
    tm.scorecards = [card('R1', '2026-11-12T18:00:00Z')];
    tm.override = (r) => (r.name === 'RoundShots' ? respond(200, { errors: [{ message: 'Something went wrong' }] }) : null);
    const out = await run({ rounds: true, round_shots: true });
    expect(out.notice).toMatchObject({ code: 'partial' });
    expect(state.measuredOffUntil).toBe(0);
  });
});

describe('the history, a chunk at a time', () => {
  it('reuses the activity list of the chunk before for 12 hours', async () => {
    tm.activities = Array.from({ length: 30 }, (_, i) => act(`A${i}`));
    const since = '2012-01-01T00:00:00Z';
    await run({ max_sessions: 10, since }, 'backfill');
    await run({ max_sessions: 10, since, known_ids: tm.activities.slice(0, 10).map((a) => String(a.id)) }, 'backfill');
    expect(tm.count('Activities')).toBe(1);
    clock.advance(12 * 3600_000);
    await run({ max_sessions: 10, since }, 'backfill');
    expect(tm.count('Activities')).toBe(2);
  });

  it('once the older sessions are in, lists nothing and asks only for the shots it is named', async () => {
    tm.scorecards = [card('OLD', '2025-01-01T18:00:00Z')];
    tm.shotHoles.set('OLD', [hole(1)]);
    const out = await run({ max_sessions: 0, round_shots: true, rounds_wanted: [{ external_id: 'OLD', played_at: '2025-01-01T18:00:00Z', newer: 0 }] }, 'backfill');
    expect(tm.requests.map((r) => r.name)).toEqual(['RoundShots']);
    expect(out.rounds[0]?.shots).toHaveLength(1);
  });

  it('a chunk that brought nothing else ends with Trackman’s trouble', async () => {
    tm.override = (r) => (r.name === 'RoundShots' ? respond(500, 'oops') : null);
    const out = await run({ max_sessions: 0, round_shots: true, rounds_wanted: [{ external_id: 'OLD' }] }, 'backfill');
    expect(out.notice).toMatchObject({ code: 'provider_unavailable' });
  });
});

describe('the whole history for a new player (spec 1.20.0)', () => {
  // A teaching pro on the simulator: rounds since Oct 2024, the newest twelve brought by the first syncs (Christian's
  // account, 27 Nov 2026 - his numbers, made-up data). Trackman lists scorecards newest first.
  const SINCE = '2011-11-30T00:00:00Z';
  const cards = (n: number) =>
    Array.from({ length: n }, (_, i) => card(`SC-${String(n - i).padStart(3, '0')}`, new Date(Date.parse('2026-11-26T18:00:00Z') - i * 4 * 86_400_000).toISOString()));

  it('a history chunk brings the older scorecards from where the target’s end, two pages at most, and says when the list is through', async () => {
    tm.scorecards = cards(130);
    const known = tm.scorecards.slice(0, 12).map((c) => String(c.id));
    const first = await run({ since: SINCE, max_sessions: 0, rounds: true, rounds_skip: 2, known_ids: known }, 'backfill');
    expect(tm.requests.map((r) => [r.name, r.variables.skip, r.variables.take])).toEqual([['Rounds', 2, 50], ['Rounds', 52, 50]]);
    expect(first.rounds).toHaveLength(90); // places 2-101, less the ten known among them
    expect(first.progress?.rounds_end).toBe(false);
    // The next chunk starts further down: the target has more now.
    tm.requests.length = 0;
    const all = [...known, ...first.rounds.map((r) => r.external_id)];
    const second = await run({ since: SINCE, max_sessions: 0, rounds: true, rounds_skip: all.length - 10, known_ids: all }, 'backfill');
    expect(tm.requests.map((r) => [r.name, r.variables.skip])).toEqual([['Rounds', 92]]);
    expect(second.rounds.map((r) => r.external_id)).toEqual(tm.scorecards.slice(102).map((c) => String(c.id)));
    expect(second.progress?.rounds_end).toBe(true);
    expect(second.rounds.at(-1)?.played_at).toBe(tm.scorecards.at(-1)?.startedAt);
  });

  it('stops at `since` as at the end of the list, and passes over the rounds it has', async () => {
    tm.scorecards = cards(30);
    const out = await run({ since: '2026-08-01T00:00:00Z', max_sessions: 0, rounds: true, rounds_skip: 0, known_ids: ['SC-030'] }, 'backfill');
    expect(out.progress?.rounds_end).toBe(true);
    expect(out.rounds.every((r) => (r.played_at ?? '') >= '2026-08-01')).toBe(true);
    expect(out.rounds.map((r) => r.external_id)).not.toContain('SC-030');
    expect(tm.count('Rounds')).toBe(1);
  });

  it('without `rounds_skip` a history chunk lists the scorecards from the top, as it did (a target before 1.20.0, a file)', async () => {
    tm.scorecards = cards(60);
    const out = await run({ since: SINCE, max_sessions: 10, rounds: true }, 'backfill');
    expect(out.rounds).toHaveLength(60);
    expect(out.progress?.rounds_end).toBeUndefined();
    expect(tm.requests.filter((r) => r.name === 'Rounds').map((r) => r.variables.skip)).toEqual([0, 50]);
  });

  it('a page Trackman refuses ends the chunk without saying the list is through', async () => {
    tm.scorecards = cards(130);
    tm.override = (req) => (req.name === 'Rounds' && req.variables.skip === 52 ? respond(503, 'busy') : null);
    const out = await run({ since: SINCE, max_sessions: 0, rounds: true, rounds_skip: 2 }, 'backfill');
    expect(out.progress?.rounds_end).toBeUndefined();
    expect(out.notice).toBeDefined();
  });

  it('tests and combines come with their shots, asked by their own type; a video’s type goes by the interface after one refusal', async () => {
    tm.activities = [
      { __typename: 'TestActivity', ...act('T1', '2026-02-09T10:00:00Z', 'TEST') },
      { __typename: 'TestActivity', ...act('T2', '2026-02-05T10:00:00Z', 'TEST') },
      { __typename: 'CombineTestActivity', ...act('C1', '2026-11-11T09:00:00Z', 'COMBINE_TEST') },
      { __typename: 'VideoActivity', ...act('V1', '2025-02-28T10:00:00Z', 'VIDEO') },
      { __typename: 'VideoActivity', ...act('V2', '2025-02-27T10:00:00Z', 'VIDEO') },
    ];
    tm.types.set('TestActivity', { own: true });
    // A combine's strokes know no club delivery: Trackman refuses those fields by name, the rest still come.
    tm.types.set('CombineTestActivity', { own: true, fields: ['ballSpeed', 'carry', 'total', 'carrySide', 'totalSide', 'launchAngle', 'spinRate', 'spinAxis', 'curve'] });
    tm.types.set('VideoActivity', { noStrokes: true });
    tm.nodes.set('T1', { __typename: 'TestActivity', strokes: [stroke(120), stroke(121), stroke(119)] });
    tm.nodes.set('T2', { __typename: 'TestActivity', strokes: [stroke(80), stroke(82)] });
    tm.nodes.set('C1', { __typename: 'CombineTestActivity', strokes: [stroke(60), stroke(100), stroke(140), stroke(180)] });
    tm.nodes.set('V1', { __typename: 'VideoActivity' });
    tm.nodes.set('V2', { __typename: 'VideoActivity' });
    const out = await run({ since: SINCE });
    expect(out.sessions.map((s) => [s.external_id, s.kind_raw, s.shots.length])).toEqual([
      ['T1', 'TEST', 3], ['T2', 'TEST', 2], ['C1', 'COMBINE_TEST', 4], ['V1', 'VIDEO', 0], ['V2', 'VIDEO', 0],
    ]);
    expect(out.failed).toEqual([]);
    // T1, T2 one each; C1 refused once, then without the club's fields; V1 refused, then the interface; V2 the interface.
    const on = tm.requests.filter((r) => r.name === 'Session').map((r) => /\.\.\. on (\w+)/.exec(r.query)?.[1]);
    expect(on).toEqual(['TestActivity', 'TestActivity', 'CombineTestActivity', 'CombineTestActivity', 'VideoActivity', 'SessionActivity', 'SessionActivity']);
    expect(state.untyped).toEqual(['VideoActivity']);
    expect(state.typeFields.CombineTestActivity).not.toContain('clubPath');
    // The next sync asks a combine with the fields it takes straight away.
    tm.requests.length = 0;
    tm.activities = [{ __typename: 'CombineTestActivity', ...act('C2', '2026-11-20T09:00:00Z', 'COMBINE_TEST') }];
    tm.nodes.set('C2', { __typename: 'CombineTestActivity', strokes: [stroke(90)] });
    expect((await run({ since: SINCE })).sessions.map((s) => s.shots.length)).toEqual([1]);
    expect(tm.count('Session')).toBe(1);
  });

  it('a type name that is no GraphQL name never goes into a query', async () => {
    tm.activities = [{ __typename: 'Test } } query X { me', ...act('T1', '2026-02-09T10:00:00Z', 'TEST') }];
    await run({ since: SINCE });
    expect(tm.requests.filter((r) => r.name === 'Session').map((r) => /\.\.\. on (\w+)/.exec(r.query)?.[1])).toEqual(['SessionActivity']);
  });

  it('known sessions without shots come again when a history chunk names them; the rest stays as it was', async () => {
    tm.activities = [act('N1', '2026-11-20T10:00:00Z'), act('S1', '2026-11-10T10:00:00Z'),
      { __typename: 'TestActivity', ...act('T1', '2026-02-09T10:00:00Z', 'TEST') }, act('N2', '2025-01-10T10:00:00Z')];
    tm.types.set('TestActivity', { own: true });
    tm.nodes.set('T1', { __typename: 'TestActivity', strokes: [stroke(120), stroke(121)] });
    const plan = { since: SINCE, max_sessions: 0, known_ids: ['S1', 'T1'], sessions_wanted: [{ external_id: 'T1' }, { external_id: 'GONE' }] };
    const out = await run(plan, 'backfill');
    expect(out.sessions.map((s) => [s.external_id, s.shots.length])).toEqual([['T1', 2]]);
    expect(tm.count('Session')).toBe(1); // neither N1 nor N2: the plan allows no new session
    expect(out.progress?.oldest_seen).not.toBe('2026-02-09T10:00:00.000Z');
    // A regular sync never asks for them.
    tm.requests.length = 0;
    expect((await run({ known_ids: ['S1', 'T1', 'N1', 'N2'], sessions_wanted: [{ external_id: 'T1' }] })).sessions).toEqual([]);
    expect(tm.count('Session')).toBe(0);
  });
});

describe('a history chunk that is stopped on the way (spec 1.25.0)', () => {
  // A teaching pro's account as the target's log showed it (27 Nov 2026, made-up data): twelve rounds in, about fifty
  // older scorecards and many sessions still to come; each chunk ran into the guard among its sessions, and neither the
  // older scorecards nor the sessions asked for again further down were ever asked of Trackman.
  const SINCE = '2011-11-30T00:00:00Z';
  const sims = (n: number) => Array.from({ length: n }, (_, i) => act(`S${i}`, new Date(Date.parse('2026-11-20T10:00:00Z') - i * 86_400_000).toISOString()));
  const older = (n: number) => Array.from({ length: n }, (_, i) => card(`SC-${String(i).padStart(3, '0')}`, new Date(Date.parse('2026-11-26T18:00:00Z') - i * 7 * 86_400_000).toISOString()));

  it('lists the older scorecards before its sessions, so the guard stopping among them still leaves those in', async () => {
    tm.activities = sims(60);
    tm.scorecards = older(30);
    const known = tm.scorecards.slice(0, 12).map((c) => String(c.id));
    const out = await run({ since: SINCE, max_sessions: 60, rounds: true, rounds_skip: 2, known_ids: known }, 'backfill');
    expect(out.notice).toMatchObject({ code: 'guard_limit' });
    expect(tm.requests[0]?.name).toBe('Rounds');
    expect(out.rounds.map((r) => r.external_id)).toEqual(tm.scorecards.slice(12).map((c) => String(c.id)));
    expect(out.progress?.rounds_end).toBe(true);
    expect(out.sessions.length).toBeGreaterThan(30); // the rest of the run still went to the sessions
  });

  it('says which sessions asked for again Trackman answered for, so a target counts only real tries', async () => {
    tm.activities = [
      { __typename: 'TestActivity', ...act('T1', '2025-02-09T10:00:00Z', 'TEST') },
      { __typename: 'TestActivity', ...act('T2', '2025-02-07T10:00:00Z', 'TEST') },
      { __typename: 'TestActivity', ...act('T3', '2025-02-05T10:00:00Z', 'TEST') },
    ];
    tm.types.set('TestActivity', { own: true });
    tm.nodes.set('T1', { __typename: 'TestActivity', strokes: [stroke(120)] });
    tm.nodes.set('T2', { __typename: 'TestActivity', strokes: [stroke(121)] });
    // Trackman itself in trouble at T3: the chunk stops, and T3 wasn't tried (its own fault or not, nobody can tell).
    tm.override = (r) => (r.name === 'Session' && r.variables.id === 'T3' ? respond(503, 'busy') : null);
    const wanted = ['T1', 'T2', 'T3', 'GONE'].map((external_id) => ({ external_id }));
    const out = await run({ since: SINCE, max_sessions: 0, known_ids: ['T1', 'T2', 'T3'], sessions_wanted: wanted }, 'backfill');
    expect(out.sessions.map((s) => s.external_id)).toEqual(['T1', 'T2']);
    expect(out.progress?.sessions_asked).toEqual(['T1', 'T2']);
    // A chunk that never got to them says so: none asked, none counted.
    tm.requests.length = 0;
    tm.override = (r) => (r.name === 'Activities' ? respond(503, 'busy') : null);
    state = freshState();
    const none = await run({ since: SINCE, max_sessions: 0, known_ids: ['T1', 'T2', 'T3'], sessions_wanted: wanted }, 'backfill');
    expect(none.progress?.sessions_asked).toEqual([]);
    // A regular sync, which asks none again, says nothing of it.
    delete tm.override;
    expect((await run({ known_ids: ['T1', 'T2', 'T3'] })).progress?.sessions_asked).toBeUndefined();
  });

  it('one session Trackman fails to execute waits for a later chunk; its type keeps going by its own name', async () => {
    tm.activities = [
      { __typename: 'TestActivity', ...act('T1', '2025-02-09T10:00:00Z', 'TEST') },
      { __typename: 'TestActivity', ...act('T2', '2025-02-05T10:00:00Z', 'TEST') },
    ];
    tm.types.set('TestActivity', { own: true });
    tm.nodes.set('T2', { __typename: 'TestActivity', strokes: [stroke(80), stroke(82)] });
    // As a GraphQL server answers an error while executing (the query itself was fine): data, the node null, an error.
    tm.override = (r) =>
      r.name === 'Session' && r.variables.id === 'T1'
        ? respond(200, { data: { node: null }, errors: [{ message: 'Unexpected Execution Error', path: ['node'] }] })
        : null;
    const out = await run({ since: SINCE, max_sessions: 0, known_ids: ['T1', 'T2'], sessions_wanted: [{ external_id: 'T1' }, { external_id: 'T2' }] }, 'backfill');
    // Never handed over empty (the target would take it off its list for good): not at all, and counted as a try.
    expect(out.sessions.map((s) => [s.external_id, s.shots.length])).toEqual([['T2', 2]]);
    expect(out.progress?.sessions_asked).toEqual(['T1', 'T2']);
    expect(state.untyped).toEqual([]);
    expect(tm.requests.filter((r) => r.name === 'Session').map((r) => /\.\.\. on (\w+)/.exec(r.query)?.[1])).toEqual(['TestActivity', 'TestActivity']);
    // A new session failing so goes as failed, for the target's retry, never as a session without shots.
    tm.requests.length = 0;
    const fresh = await run({ since: SINCE, max_sessions: 10, known_ids: ['T2'] }, 'backfill');
    expect(fresh.sessions).toEqual([]);
    expect(fresh.failed.map((f) => f.external_id)).toEqual(['T1']);
  });
});

describe('a combine’s or a test’s target per shot (spec 1.25.0)', () => {
  it('asks the target distance on their own type and hands it over with each shot; refused by name, the shots still come', async () => {
    const at = (carry: number, targetDistance: number) => ({ ...stroke(carry), measurement: { carry, ballSpeed: 40, targetDistance } });
    tm.activities = [
      { __typename: 'CombineTestActivity', ...act('C1', '2026-11-11T09:00:00Z', 'COMBINE_TEST') },
      { __typename: 'LongestDriveActivity', ...act('L1', '2026-11-10T09:00:00Z', 'LONGEST_DRIVE') },
    ];
    tm.types.set('CombineTestActivity', { own: true });
    tm.types.set('LongestDriveActivity', { own: true, fields: ['ballSpeed', 'carry', 'total'] }); // no target there
    tm.nodes.set('C1', { __typename: 'CombineTestActivity', strokes: [at(58, 55), at(101, 100)] });
    tm.nodes.set('L1', { __typename: 'LongestDriveActivity', strokes: [stroke(230)] });
    const out = await run({ since: '2011-11-30T00:00:00Z' });
    expect(out.sessions.map((s) => s.shots.map((x) => x.target?.distance_m ?? null))).toEqual([[55, 100], [null]]);
    expect(tm.requests.filter((r) => r.name === 'Session')[0]?.query).toContain('targetDistance');
  });
});

describe('whose account a sign-in opens', () => {
  const ctx = () => providerContext({ guard, account: ACCOUNT, fetch: tm.fetch, now: clock.now });

  it('names it and says what it holds, in one request through the guard', async () => {
    tm.activities = [act('A1', '2026-11-10T17:05:00Z', 'RANGE_PRACTICE'), act('A2')];
    expect(await who(ctx(), TOKEN)).toEqual({ player: 'Test Player', activities: { count: 2, last: '2026-11-10T17:05:00Z', place: 'Example Hall' } });
    expect(tm.count()).toBe(1);
    expect((await guard.counts(ACCOUNT)).day).toBe(1);
  });

  it('asks for the name alone when Trackman refuses the question as a whole', async () => {
    tm.override = (r) => (r.name === 'Who' ? respond(200, { errors: [{ message: 'Cannot query field "activities"' }] }) : null);
    expect(await who(ctx(), TOKEN)).toEqual({ player: 'Test Player', activities: null });
  });

  it('passes trouble with Trackman itself on instead of asking again', async () => {
    await expect(who(ctx(), fakeToken('someone-else'))).rejects.toThrow('rejected the sign-in');
    expect(tm.count()).toBe(1);
  });
});

it('asks Trackman only at its GraphQL address', () => {
  expect(GRAPHQL_URL).toBe('https://api.trackmangolf.com/graphql');
});
