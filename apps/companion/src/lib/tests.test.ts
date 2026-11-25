// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode in the companion app (spec/test-mode.md), offline: a made-up target hands out a made-up scenario for a
 * test code, the app asks "Is this your account?" through the guard, and after the yes the pairing syncs from the
 * scenario - Trackman never asked, `test` on every batch, other pairings untouched, gone with the tester's sign-out,
 * the pairing or the scenario's end. All of it synthetic.
 */
import { guardAccount, MemoryStorage, type FetchLike } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { readTestScenario } from '@glmsync/spec';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { describe, expect, it } from 'vitest';
import { MemorySecrets } from './secrets.ts';
import { makeServices } from './services.ts';
import { blobName, MemoryBlobs, TestModeError } from './tests.ts';

const DAY = 86_400_000;
const START = Date.parse('2026-11-21T09:00:00Z');
const CODE = 'T17K2M9Q';
const SUBJECT = 'test-T17-0001';

function answer(over: Record<string, unknown> = {}) {
  const activities = Array.from({ length: 25 }, (_, i) => ({
    __typename: 'SimulatorSessionActivity',
    id: `L${i}`,
    time: new Date(START - DAY - i * 2 * DAY).toISOString(),
    kind: 'SIMULATOR',
  }));
  return {
    name: 'Leon (test T17)',
    provider: 'trackman',
    subject: SUBJECT,
    profile: { fullName: 'Leon Made-Up' },
    data: { activities, nodes: Object.fromEntries(activities.map((a) => [a.id, { strokes: [{ club: 'Driver', measurement: { carry: 230, ballSpeed: 70 } }] }])), scorecards: [], shotHoles: {} },
    latency: { default: { median_s: 1, spread_s: 0.2 } },
    valid_until: new Date(START + 7 * DAY).toISOString(),
    ...over,
  };
}

function setup() {
  const clock = new VirtualClock(START);
  // Plans like the reference: a regular sync of the last 30 days, the history in chunks of 10.
  const historyDone = (t: FakeTarget) => t.imports.some((b) => b.sync?.reason === 'backfill' && b.progress?.more_available === false);
  const plan = (ask: { reason: string }, t: FakeTarget) =>
    ask.reason === 'backfill'
      ? historyDone(t)
        ? { due: false, history: { done: true } }
        : { due: true, plan_id: `pl_${clock.t}`, known_ids: t.known(), since: '2011-01-01T00:00:00Z', max_sessions: 10, rounds: false, round_shots: false }
      : { due: true, plan_id: `pl_${clock.t}`, known_ids: t.known(), since: new Date(clock.t - 30 * DAY).toISOString(), max_sessions: 40, rounds: false, round_shots: false };
  const target = new FakeTarget({ plan });
  const other = new FakeTarget({ base: 'https://other.example.net/lm/v1', name: 'Other App' });
  target.testAccount = true;
  target.scenarios.set(CODE, answer());
  const tm = new FakeTrackman(clock.now);
  const token = fakeToken('real-sub-0001', { exp: Math.floor((START + 7 * DAY) / 1000) });
  tm.tokens.add(token);
  tm.activities = [{ id: 'REAL1', time: new Date(START - DAY).toISOString(), kind: 'RANGE_PRACTICE' }];
  tm.nodes.set('REAL1', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const fetch: FetchLike = (url, init) =>
    url === GRAPHQL_URL ? tm.fetch(url, init) : url.startsWith(other.base) ? other.fetch(url, init) : target.fetch(url, init);
  const secrets = new MemorySecrets();
  const storage = new MemoryStorage();
  const blobs = new MemoryBlobs();
  const make = () => makeServices({ secrets, storage, blobs, fetch, now: clock.now, sleep: clock.sleep, version: '0.1.0-test' });
  return { clock, target, other, tm, token, secrets, storage, blobs, make, services: make() };
}

async function inTest(s: ReturnType<typeof setup>) {
  await s.services.load();
  const p = await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
  const scenario = await s.services.runner.testScenario(p.key, CODE);
  const who = await s.services.runner.testWho(scenario);
  await s.services.runner.startTest(p.key, scenario, who.player);
  return { p, scenario, who };
}

describe('test mode', () => {
  it('asks "Is this your account?" about the scenario, through the guard, keeping nothing before the yes', async () => {
    const s = setup();
    await s.services.load();
    const p = await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
    const scenario = await s.services.runner.testScenario(p.key, CODE);
    expect(s.target.received.at(-1)?.headers['X-Test-Code']).toBe(CODE);
    expect(await s.services.runner.testWho(scenario)).toEqual({ player: 'Leon Made-Up', activities: { count: 25, last: expect.any(String), place: null } });
    expect(s.services.tests.list()).toEqual([]);
    expect(s.blobs.data.size).toBe(0);
    expect(s.target.imports).toEqual([]);
    expect((await s.services.guard.counts(guardAccount('trackman', SUBJECT))).day).toBe(1);
  });

  it('then syncs the pairing from the scenario: test on every batch, Trackman never asked, the real sign-in untouched', async () => {
    const s = setup();
    const { p } = await inTest(s);
    await s.services.signIns.set('trackman', s.token, 'Real Player'); // a real sign-in beside it stays apart
    const [first] = await s.services.runner.syncAll('connect');
    expect(first?.run).toMatchObject({ status: 'synced', result: { sessions: 15 } });
    while ((await s.services.runner.backfill()) !== null) s.clock.advance(60_000);
    expect(s.target.sessions.size).toBe(25);
    expect([...s.target.sessions.keys()].every((id) => id.startsWith('L'))).toBe(true);
    // The first sync in parts while it fetches (LMS-AS-6: no reason until its last), then the history's chunk.
    const parts = s.target.imports.map((b) => [b.sync?.reason, b.sessions.length] as const);
    expect(parts.at(-1)).toEqual(['backfill', 10]);
    const firstSync = parts.slice(0, -1);
    expect(firstSync.length).toBeGreaterThan(2);
    expect(firstSync.at(-1)?.[0]).toBe('connect');
    expect(firstSync.slice(0, -1).every(([r, n]) => r === undefined && n > 0 && n <= 2)).toBe(true);
    expect(firstSync.reduce((n, [, k]) => n + k, 0)).toBe(15);
    expect(s.target.imports.every((b) => b.test === true)).toBe(true);
    expect(s.tm.count()).toBe(0);
    expect(s.services.signIns.get('trackman')?.player).toBe('Real Player');
    expect(s.clock.t - START).toBeLessThan(DAY);
    expect((await s.services.runner.testCounts(p.key))?.day).toBeGreaterThan(3);
  });

  it('a second pairing syncs the real account as before, without test', async () => {
    const s = setup();
    await inTest(s);
    s.other.codes.add('OTHER777');
    await s.services.runner.pair({ target: s.other.base, code: 'OTHER777' });
    await s.services.signIns.set('trackman', s.token, 'Real Player');
    await s.services.runner.syncAll('manual');
    expect([...s.other.sessions.keys()]).toEqual(['REAL1']);
    expect(s.other.imports.some((b) => 'test' in b)).toBe(false);
    expect([...s.target.sessions.keys()].every((id) => id.startsWith('L'))).toBe(true);
  });

  it('outlives a restart (the background task’s runtime finds it), and asks again for nothing twice', async () => {
    const s = setup();
    await inTest(s);
    await s.services.runner.syncAll('connect');
    const again = s.make();
    await again.load();
    expect(again.tests.list().map((m) => m.name)).toEqual(['Leon (test T17)']);
    const [run] = await again.runner.syncAll('timer');
    expect(run?.run.status).toBe('synced');
    expect(s.target.imports.at(-1)?.test).toBe(true);
    expect(s.target.sessions.size).toBe(15);
  });

  it('ends when the tester signs out of it: the scenario leaves the phone, the pairing stays', async () => {
    const s = setup();
    const { p } = await inTest(s);
    expect(s.blobs.data.has(blobName(p.key))).toBe(true);
    await s.services.runner.endTest(p.key);
    expect(s.services.tests.list()).toEqual([]);
    expect(s.blobs.data.size).toBe(0);
    expect(s.services.pairings.list()).toHaveLength(1);
    const [run] = await s.services.runner.syncAll('manual');
    expect(run?.run.status).toBe('signed_out');
    expect(s.target.imports.every((b) => b.sessions.length === 0)).toBe(true);
  });

  it('ends with its pairing: disconnected here, or ended by the app', async () => {
    const s = setup();
    const { p } = await inTest(s);
    await s.services.runner.unpair(p.key);
    expect(s.services.tests.list()).toEqual([]);
    expect(s.blobs.data.size).toBe(0);

    const t = setup();
    await inTest(t);
    t.target.disconnected = true;
    await t.services.runner.syncAll('timer');
    expect(t.services.pairings.list()).toEqual([]);
    expect(t.services.tests.list()).toEqual([]);
    expect(t.blobs.data.size).toBe(0);
  });

  it('ends when its time is over, and a file that is no scenario any more ends it too', async () => {
    const s = setup();
    const { p } = await inTest(s);
    s.clock.advance(8 * DAY);
    expect(s.services.tests.list()).toEqual([]);
    const [run] = await s.services.runner.syncAll('timer');
    expect(run?.run.status).toBe('signed_out');
    expect(s.blobs.data.size).toBe(0);
    expect(s.target.imports.some((b) => b.test)).toBe(false);

    const t = setup();
    const x = await inTest(t);
    t.blobs.data.set(blobName(x.p.key), '{broken');
    const fresh = t.make();
    await fresh.load();
    expect(await fresh.tests.provider(x.p.key)).toBeNull();
    expect(fresh.tests.list()).toEqual([]);
    expect(p.key).toBe(x.p.key);
  });

  it('a target that says the account is no test account any more stores nothing, and the run says why', async () => {
    const s = setup();
    await inTest(s);
    s.target.testAccount = false;
    const [run] = await s.services.runner.syncAll('manual');
    expect(run?.run).toMatchObject({ status: 'failed', error: 'test_data' });
    expect(s.target.sessions.size).toBe(0);
  });
});

describe('test mode refuses', () => {
  it('a wrong code, an expired one, an account that is no test account, a target without scenarios', async () => {
    const s = setup();
    await s.services.load();
    const p = await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
    await expect(s.services.runner.testScenario(p.key, 'WRONG123')).rejects.toMatchObject({ code: 'code_invalid' });
    s.target.expiredCodes.add('OLDCODE1');
    await expect(s.services.runner.testScenario(p.key, 'OLDCODE1')).rejects.toMatchObject({ code: 'code_expired' });
    s.target.testAccount = false;
    await expect(s.services.runner.testScenario(p.key, CODE)).rejects.toMatchObject({ code: 'not_test_account' });
    expect(s.services.pairings.list()).toHaveLength(1); // the pairing stays good
  });

  it('a target that has no scenarios at all', async () => {
    const target = new FakeTarget({ base: 'https://none.example.com/lm/v1', tests: false });
    const services = makeServices({ secrets: new MemorySecrets(), storage: new MemoryStorage(), fetch: target.fetch });
    await services.load();
    const p = await services.runner.pair({ target: target.base, code: 'K7M2PQ9X' });
    await expect(services.runner.testScenario(p.key, CODE)).rejects.toMatchObject({ code: 'test_unavailable' });
  });

  it('a pairing it doesn’t have, a scenario of another provider, a token the app revoked', async () => {
    const s = setup();
    await s.services.load();
    await expect(s.services.runner.testScenario('nope', CODE)).rejects.toBeInstanceOf(TestModeError);
    const p = await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
    s.target.scenarios.set('DEMOCODE1', answer({ provider: 'demo' }));
    await expect(s.services.runner.testScenario(p.key, 'DEMOCODE1')).rejects.toMatchObject({ code: 'provider' });
    s.target.tokens.clear();
    await expect(s.services.runner.testScenario(p.key, CODE)).rejects.toMatchObject({ code: 'token_invalid' });
    expect(s.services.pairings.list()).toEqual([]);
    // Nor is a test started for a pairing that went.
    const read = readTestScenario(answer(), new Date(START).toISOString());
    if (!read.ok) throw new Error(read.error);
    await expect(s.services.runner.startTest(p.key, read.scenario, null)).rejects.toMatchObject({ code: 'unpaired' });
    expect(s.blobs.data.size).toBe(0);
  });
});
