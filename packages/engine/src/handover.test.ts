// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A sign-in handed over to the engine in a target's own app (spec 1.27.0, *Signing in for a target*; spec 1.28.0 for a
 * test mode's), offline: a real one is kept with its User-Agent and goes only to the provider; a test one makes the
 * engine fetch the scenario with its own import token and play it back - the made-up Trackman refusing the sign-in
 * from `expires_at` on as Trackman refuses an expired key - renewed by the next handover without a second download.
 * Another account's, another provider's or a broken one is never kept, and a real key never reaches the target as a
 * code. All of it synthetic.
 */
import { accountRefOf, guardAccount, MemoryStorage, type FetchLike } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import type { HandedOver } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { makeEngine } from './engine.ts';
import { SignInRefused } from './runner.ts';
import { MemorySecrets } from './secrets.ts';
import { MemoryBlobs } from './tests.ts';

const DAY = 86_400_000;
const MIN = 60_000;
const START = Date.parse('2026-11-28T09:00:00Z');
const CODE = 'K7MP-Q2RX';
const SUBJECT = 'test-T21-0001-leon';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

function answer(over: Record<string, unknown> = {}) {
  const activities = Array.from({ length: 20 }, (_, i) => ({
    __typename: 'SimulatorSessionActivity',
    id: `L${i}`,
    time: new Date(START - DAY - i * 2 * DAY).toISOString(),
    kind: 'SIMULATOR',
  }));
  return {
    name: 'Leon (test T21)',
    provider: 'trackman',
    subject: SUBJECT,
    profile: { fullName: 'Leon Made-Up' },
    data: { activities, nodes: Object.fromEntries(activities.map((a) => [a.id, { strokes: [{ club: 'Driver', measurement: { carry: 230, ballSpeed: 70 } }] }])), scorecards: [], shotHoles: {} },
    latency: { default: { median_s: 1, spread_s: 0 } },
    valid_until: new Date(START + 7 * DAY).toISOString(),
    signin_valid_s: 600,
    ...over,
  };
}

function setup() {
  const clock = new VirtualClock(START);
  const target = new FakeTarget({
    plan: (ask) => ({ due: true, plan_id: `pl_${clock.t}_${ask.reason}`, known_ids: target.known(), since: '2025-01-01T00:00:00Z', max_sessions: 40, rounds: false, round_shots: false }),
  });
  target.testAccount = true;
  target.scenarios.set(CODE, answer());
  const tm = new FakeTrackman(clock.now);
  const realToken = fakeToken('real-sub-0001', { exp: Math.floor((START + 7 * DAY) / 1000) });
  tm.tokens.add(realToken);
  tm.activities = [{ id: 'REAL1', time: new Date(START - DAY).toISOString(), kind: 'RANGE_PRACTICE' }];
  tm.nodes.set('REAL1', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const fetch: FetchLike = (url, init) => (url === GRAPHQL_URL ? tm.fetch(url, init) : target.fetch(url, init));
  const secrets = new MemorySecrets();
  const blobs = new MemoryBlobs();
  const storage = new MemoryStorage();
  // The engine as a target's own app embeds it (spec 1.27.0: kind `embedded`).
  const make = () => makeEngine({ secrets, storage, blobs, fetch, now: clock.now, sleep: clock.sleep, version: '0.4.0-test', client: { kind: 'embedded', name: 'Example App' } });
  return { clock, target, tm, realToken, secrets, blobs, make, engine: make() };
}

async function paired(s: ReturnType<typeof setup>) {
  await s.engine.load();
  return s.engine.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
}

/** The test sign-in as the companion app hands it over (spec 1.28.0). */
function testSignIn(s: ReturnType<typeof setup>, over: Partial<HandedOver> = {}): HandedOver {
  return {
    provider: 'trackman',
    token: CODE,
    account_ref: accountRefOf(s.target.salt, 'trackman', SUBJECT),
    expires_at: new Date(s.clock.t + 10 * MIN).toISOString(),
    user_agent: UA,
    test: true,
    ...over,
  };
}

const testScenarioAsks = (t: FakeTarget) => t.received.filter((r) => r.url.includes('/test-scenario')).length;

describe('a test sign-in handed over (spec 1.28.0)', () => {
  it('fetches the scenario with the engine’s own import token and the code, and plays it back: test on every batch, Trackman never asked', async () => {
    const s = setup();
    const p = await paired(s);
    expect(await s.engine.runner.takeSignIn(p.key, testSignIn(s))).toBe('test');
    const ask = s.target.received.find((r) => r.url.includes('/test-scenario'));
    expect(ask?.headers['X-Test-Code']).toBe(CODE);
    expect(ask?.headers.Authorization).toBe(`Bearer ${p.token}`);
    const [run] = await s.engine.runner.syncAll('open');
    expect(run?.run).toMatchObject({ status: 'synced', result: { sessions: 20 } });
    expect(s.target.imports.length).toBeGreaterThan(0);
    expect(s.target.imports.every((b) => b.test === true && b.account_ref === accountRefOf(s.target.salt, 'trackman', SUBJECT))).toBe(true);
    expect(s.tm.count()).toBe(0);
    // Nothing of it in the secure store: the code is no provider key.
    expect(s.engine.signIns.get('trackman')).toBeNull();
    expect(s.engine.runner.signInOf(p.key)).toEqual({ test: true, expiresAt: START + 10 * MIN, valid: true });
    expect((await s.engine.guard.counts(guardAccount('trackman', SUBJECT))).day).toBeGreaterThan(0);
  });

  it('runs out at expires_at: the engine says signed out, as for a real key that ran out, and asks the made-up Trackman nothing', async () => {
    const s = setup();
    const p = await paired(s);
    await s.engine.runner.takeSignIn(p.key, testSignIn(s));
    s.clock.advance(10 * MIN);
    expect(s.engine.runner.signInOf(p.key)).toMatchObject({ test: true, valid: false });
    const [run] = await s.engine.runner.syncAll('open');
    expect(run?.run).toMatchObject({ status: 'signed_out', notice: 'auth_expired' });
    // The target hears where the sign-in stands, and an empty batch of the test account says why.
    expect(s.target.signins.at(-1)).toMatchObject({ signin: 'expired' });
    const last = s.target.imports.at(-1);
    expect(last).toMatchObject({ test: true, sessions: [], notice: { code: 'auth_expired' } });
    const replay = await s.engine.tests.provider(p.key);
    expect(replay?.fake.count()).toBe(0);
  });

  it('the made-up Trackman refuses the sign-in from expires_at on with 401, as Trackman does; a run under way ends with auth_expired', async () => {
    const s = setup();
    s.target.scenarios.set(CODE, answer({ latency: { default: { median_s: 10, spread_s: 0 } } }));
    const p = await paired(s);
    // Good at the start (more than the minute's slack left), gone after a few of the scenario's ten seconds an answer.
    await s.engine.runner.takeSignIn(p.key, testSignIn(s, { expires_at: new Date(START + MIN + 5_000).toISOString() }));
    const [run] = await s.engine.runner.syncAll('open');
    expect(run?.run).toMatchObject({ status: 'synced', notice: 'auth_expired' });
    const replay = await s.engine.tests.provider(p.key);
    expect(replay?.fake.requests.length).toBeGreaterThan(0);
    expect(s.engine.runner.signInOf(p.key)).toMatchObject({ test: true, valid: false });
    expect(s.target.sessions.size).toBeLessThan(20);
  });

  it('a later handover of the same test renews it: no second download, and it fetches on', async () => {
    const s = setup();
    const p = await paired(s);
    await s.engine.runner.takeSignIn(p.key, testSignIn(s));
    s.clock.advance(11 * MIN);
    expect(await s.engine.runner.takeSignIn(p.key, testSignIn(s))).toBe('test');
    expect(testScenarioAsks(s.target)).toBe(1);
    expect(s.engine.runner.signInOf(p.key)).toEqual({ test: true, expiresAt: s.clock.t + 10 * MIN, valid: true });
    const [run] = await s.engine.runner.syncAll('open');
    expect(run?.run.status).toBe('synced');
    expect(s.target.sessions.size).toBe(20);
  });

  it('outlives a restart with its expiry (the background task’s runtime finds it)', async () => {
    const s = setup();
    const p = await paired(s);
    await s.engine.runner.takeSignIn(p.key, testSignIn(s));
    const again = s.make();
    await again.load();
    expect(again.runner.signInOf(p.key)).toEqual({ test: true, expiresAt: START + 10 * MIN, valid: true });
    s.clock.advance(10 * MIN);
    const [run] = await again.runner.syncAll('timer');
    expect(run?.run.status).toBe('signed_out');
  });

  it('refuses another account’s, a broken one, one already run out, and a pairing it doesn’t have - keeping nothing', async () => {
    const s = setup();
    const p = await paired(s);
    const refused = async (h: HandedOver, key = p.key) => {
      const e = await s.engine.runner.takeSignIn(key, h).then(() => null, (x: unknown) => x);
      expect(e).toBeInstanceOf(SignInRefused);
      return (e as SignInRefused).code;
    };
    expect(await refused(testSignIn(s, { account_ref: accountRefOf(s.target.salt, 'trackman', 'someone-else') }))).toBe('other_account');
    expect(await refused(testSignIn(s, { provider: 'demo' }))).toBe('provider');
    expect(await refused(testSignIn(s, { expires_at: new Date(START + 30_000).toISOString() }))).toBe('expired');
    expect(await refused(testSignIn(s), 'nope')).toBe('unpaired');
    // A real key marked as a test one is refused before anything goes out: it never reaches the target as a code.
    expect(await refused(testSignIn(s, { token: s.realToken }))).toBe('invalid');
    expect(await refused({ ...testSignIn(s), test: 'yes' } as unknown as HandedOver)).toBe('invalid');
    expect(s.target.received.filter((r) => r.headers['X-Test-Code'] === s.realToken)).toEqual([]);
    expect(s.engine.tests.list()).toEqual([]);
    expect(s.blobs.data.size).toBe(0);
  });

  it('a code the target doesn’t take answers with the target’s own error, and nothing is kept', async () => {
    const s = setup();
    const p = await paired(s);
    await expect(s.engine.runner.takeSignIn(p.key, testSignIn(s, { token: 'WRONG-123' }))).rejects.toMatchObject({ code: 'code_invalid' });
    s.target.expiredCodes.add(CODE);
    await expect(s.engine.runner.takeSignIn(p.key, testSignIn(s))).rejects.toMatchObject({ code: 'code_expired' });
    expect(s.engine.tests.list()).toEqual([]);
    expect(s.engine.runner.signInOf(p.key)).toBeNull();
  });
});

describe('a real sign-in handed over (spec 1.27.0)', () => {
  const real = (s: ReturnType<typeof setup>, over: Partial<HandedOver> = {}): HandedOver => ({
    provider: 'trackman',
    token: s.realToken,
    account_ref: accountRefOf(s.target.salt, 'trackman', 'real-sub-0001'),
    expires_at: new Date(START + 7 * DAY).toISOString(),
    user_agent: UA,
    ...over,
  });

  it('is kept in the secure store with the browser’s User-Agent, and every call to Trackman carries it', async () => {
    const s = setup();
    const p = await paired(s);
    expect(await s.engine.runner.takeSignIn(p.key, real(s))).toBe('kept');
    expect(s.engine.signIns.get('trackman')).toMatchObject({ token: s.realToken, subject: 'real-sub-0001', userAgent: UA });
    expect(s.engine.runner.signInOf(p.key)).toEqual({ test: false, expiresAt: START + 7 * DAY, valid: true });
    await s.engine.runner.syncAll('open');
    expect([...s.target.sessions.keys()]).toEqual(['REAL1']);
    expect(s.tm.requests.length).toBeGreaterThan(0);
    expect(s.tm.requests.every((r) => r.headers['User-Agent'] === UA)).toBe(true);
    expect(testScenarioAsks(s.target)).toBe(0);
  });

  it('replaces a test that ran on the pairing; and is refused for another account than the one the key opens', async () => {
    const s = setup();
    const p = await paired(s);
    await s.engine.runner.takeSignIn(p.key, testSignIn(s));
    expect(await s.engine.runner.takeSignIn(p.key, real(s))).toBe('kept');
    expect(s.engine.tests.list()).toEqual([]);
    expect(s.engine.runner.signInOf(p.key)?.test).toBe(false);
    await expect(s.engine.runner.takeSignIn(p.key, real(s, { account_ref: accountRefOf(s.target.salt, 'trackman', 'someone-else') }))).rejects.toMatchObject({ code: 'other_account' });
    await expect(s.engine.runner.takeSignIn(p.key, real(s, { token: fakeToken('other-sub') }))).rejects.toMatchObject({ code: 'other_account' });
    expect(s.engine.signIns.get('trackman')?.subject).toBe('real-sub-0001');
  });
});
