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
import { fetchForPlan, freshState, MAX_STROKES_PER_SESSION, MEASURED_OFF_MS, who, type TrackmanState } from './fetch.ts';
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
  it('skips played rounds, known and given-up sessions, and brings the rest', async () => {
    tm.activities = [act('A1'), act('G1', '2026-11-09T10:00:00Z', 'COURSE_PLAY'), act('K1'), act('X1'), act('A2', '2026-11-01T10:00:00Z')];
    tm.nodes.set('A1', { strokes: [stroke(140), null, stroke(150)] });
    const out = await run({ known_ids: ['K1'], give_up: ['X1'] });
    expect(out.sessions.map((s) => [s.external_id, s.shots.length])).toEqual([['A1', 2], ['A2', 0]]);
    expect(out.progress).toEqual({ more_available: false, skipped_known: 1, oldest_seen: '2026-11-01T10:00:00Z' });
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
