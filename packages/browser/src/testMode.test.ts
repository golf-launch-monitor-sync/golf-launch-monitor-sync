// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode in the browser clients (spec/test-mode.md), offline: a made-up target hands out a made-up scenario for
 * a test code; "Is this your account?" through the guard; after the yes the pairing syncs from the scenario - the
 * same chunks as a sync with Trackman answering the same, Trackman never asked, `test` on every batch, the guard
 * under the scenario's account - until the tester ends it, the pairing ends or the scenario is over. All synthetic.
 */

import { guardAccount, MemoryStorage, type FetchLike } from '@glmsync/core';
import { FakeTarget, VirtualClock, type PlanAsked } from '@glmsync/core/testing';
import { GRAPHQL_URL, MemoryBlobs, type Blobs } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken, type Json } from '@glmsync/provider-trackman/testing';
import { testLink } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { BrowserClient, pairingId, readTestInput } from './client.ts';

const DAY = 86_400_000;
const START = Date.parse('2026-11-21T09:00:00Z');
const CODE = 'T17K2M9Q';
const SUBJECT = 'caddie-test-T17-neu-leon';
const ZERO = { median_s: 0, spread_s: 0 };

/** Made up: `n` sessions back from yesterday, two rounds, in Trackman's shapes. */
function data(n: number): Json {
  const activities = Array.from({ length: n }, (_, i) => ({
    __typename: i % 3 ? 'SimulatorSessionActivity' : 'RangePracticeActivity',
    id: `L${i}`,
    time: new Date(START - DAY - i * 2 * DAY).toISOString(),
    kind: i % 3 ? 'SIMULATOR' : 'RANGE_PRACTICE',
  }));
  const nodes = Object.fromEntries(activities.map((a, i) => [a.id, { strokes: [{ club: 'Driver', time: a.time, measurement: { carry: 240 + (i % 7), ballSpeed: 74 } }] }]));
  const card = (id: string, at: number) => ({ id, startedAt: new Date(at).toISOString(), course: { displayName: 'Example Links' }, par: 72, grossScore: 80 });
  const hole = { holeNumber: 1, pinPosition: { x: 10, z: 20 }, shots: [{ shotNumber: 1, club: 'Driver', launchLie: 'Tee', finalLie: 'Fairway', launchPosition: { x: 10, z: 400 }, finalPosition: { x: 12, z: 160 } }] };
  return { activities, nodes, scorecards: [card('R2', START - 3 * DAY), card('R1', START - 30 * DAY)], shotHoles: { R2: [hole], R1: [hole] } };
}

function scenario(over: Record<string, unknown> = {}, n = 25): Record<string, unknown> {
  return {
    name: 'Leon, never switched',
    provider: 'trackman',
    subject: SUBJECT,
    profile: { fullName: 'Leon (Test T17)' },
    data: data(n),
    latency: { default: ZERO, queries: {} },
    valid_until: new Date(START + 7 * DAY).toISOString(),
    ...over,
  };
}

/** A target that plans like the reference: the regular sync over the last three days, the history in chunks of 5. */
function planner(clock: VirtualClock) {
  return (ask: PlanAsked, t: FakeTarget): Json => {
    const done = t.imports.some((b) => b.sync?.reason === 'backfill' && b.progress?.more_available === false);
    const base = { plan_id: `pl_${clock.t}`, known_ids: t.known() };
    if (ask.reason === 'backfill') return done ? { due: false, history: { done: true } } : { ...base, due: true, since: '2011-01-01T00:00:00Z', max_sessions: 5, rounds: true, round_shots: false, history: { done: false } };
    return { ...base, due: true, since: new Date(clock.t - 3 * DAY).toISOString(), max_sessions: 40, rounds: true, round_shots: true, history: { done } };
  };
}

function world(opts: { tests?: boolean; blobs?: Blobs; n?: number } = {}) {
  const clock = new VirtualClock(START);
  const tm = new FakeTrackman(clock.now);
  const target = new FakeTarget({ plan: planner(clock), ...(opts.tests === false ? { tests: false } : {}) });
  target.testAccount = true;
  target.scenarios.set(CODE, scenario({}, opts.n));
  const fetch: FetchLike = (url, init) => (url.startsWith(GRAPHQL_URL) ? tm.fetch(url, init) : target.fetch(url, init));
  const storage = new MemoryStorage();
  const blobs = opts.blobs ?? new MemoryBlobs();
  const client = new BrowserClient({ storage, vault: new MemoryStorage(), kind: 'extension', name: 'GLMS test', version: '0.0.1', fetch, now: clock.now, sleep: clock.sleep, random: () => 0.5, blobs });
  return { clock, tm, target, client, storage, blobs };
}

async function paired(w: ReturnType<typeof world>) {
  const out = await w.client.offerPairing({ target: w.target.base, code: 'K7M2PQ9X' });
  expect(out).toMatchObject({ ok: true });
  return out.ok ? out.id : '';
}

/** The history, chunk by chunk, as the background's alarm asks for it. */
async function history(w: { client: BrowserClient; clock: VirtualClock }) {
  for (let i = 0; i < 50; i++) {
    const next = await w.client.nextBackfill();
    if (next === null) return;
    if (next > w.clock.t) w.clock.t = next;
    await w.client.run('backfill');
  }
  throw new Error('history never done');
}

describe('a test code', () => {
  it('is read as typed, or from the test link the app shows', () => {
    expect(readTestInput(' T17K 2M9Q ')).toEqual({ code: CODE });
    expect(readTestInput('abc-defg-h')).toEqual({ code: 'abc-defg-h' });
    expect(readTestInput(testLink(CODE, 'https://app.example.org/lm/v1'))).toEqual({ code: CODE, target: 'https://app.example.org/lm/v1' });
    expect(readTestInput('glmsync://pair?target=https%3A%2F%2Fa.example&code=K7M2PQ9X')).toBeNull();
    expect(readTestInput('glmsync://test?code=x')).toBeNull();
    expect(readTestInput('abc')).toBeNull();
    expect(readTestInput(42)).toBeNull();
  });

  it('says why it brought no test, instead of throwing', async () => {
    const w = world();
    expect(await w.client.fetchTest(CODE)).toEqual({ ok: false, error: 'unpaired' });
    const id = await paired(w);
    expect(await w.client.fetchTest('no')).toEqual({ ok: false, error: 'code' });
    expect(await w.client.fetchTest('WRONG0001')).toEqual({ ok: false, error: 'code' });
    expect(await w.client.fetchTest(testLink(CODE, 'https://other.example.org/lm/v1'))).toEqual({ ok: false, error: 'unpaired' });
    w.target.expiredCodes.add('OVER00001');
    expect(await w.client.fetchTest('OVER00001')).toEqual({ ok: false, error: 'expired' });
    w.target.testAccount = false;
    expect(await w.client.fetchTest(CODE)).toEqual({ ok: false, error: 'not_test_account' });
    w.target.testAccount = true;
    w.target.scenarios.set('OTHER0001', scenario({ provider: 'garmin' }));
    expect(await w.client.fetchTest('OTHER0001')).toEqual({ ok: false, error: 'provider' });
    w.target.scenarios.set('BROKEN001', { name: 'x' });
    expect(await w.client.fetchTest('BROKEN001')).toEqual({ ok: false, error: 'answer' });
    w.target.scenarios.set('PAST00001', scenario({ valid_until: new Date(START - DAY).toISOString() }));
    expect(await w.client.fetchTest('PAST00001')).toEqual({ ok: false, error: 'expired' });
    // Nothing was kept or asked of Trackman by any of it; the pairing stands.
    expect((await w.client.status()).testAsking).toBeNull();
    expect(w.tm.count()).toBe(0);
    expect((await w.client.status()).pairings.map((p) => p.id)).toEqual([id]);

    const none = world({ tests: false });
    await paired(none);
    expect(await none.client.fetchTest(CODE)).toEqual({ ok: false, error: 'unavailable' });

    const down = world();
    await paired(down);
    (down.target.opts as { fail?: Record<string, { status: number }> }).fail = { '/test-scenario': { status: 503 } };
    expect(await down.client.fetchTest(CODE)).toEqual({ ok: false, error: 'unreachable' });
  });

  it('a pairing the app ended goes, as after a sync', async () => {
    const w = world();
    await paired(w);
    w.target.tokens.clear();
    expect(await w.client.fetchTest(CODE)).toEqual({ ok: false, error: 'revoked' });
    const s = await w.client.status();
    expect(s.pairings).toHaveLength(0);
    expect(s.ended).toMatchObject([{ why: 'revoked' }]);
  });

  it('with several pairings, needs to know for which app (the link says it)', async () => {
    const w = world();
    const id = await paired(w);
    const other = new FakeTarget({ base: 'https://other.example.org/lm/v1', name: 'Other App' });
    const both: FetchLike = (url, init) => (url.startsWith(other.base) ? other.fetch(url, init) : w.target.fetch(url, init));
    const client = new BrowserClient({ storage: new MemoryStorage(), vault: new MemoryStorage(), kind: 'web', name: 'x', version: '1', fetch: both, now: w.clock.now, sleep: w.clock.sleep, blobs: new MemoryBlobs() });
    w.target.codes.add('K7M2PQ9X');
    expect(await client.offerPairing({ target: w.target.base, code: 'K7M2PQ9X' })).toMatchObject({ ok: true });
    expect(await client.offerPairing({ target: other.base, code: 'K7M2PQ9X' })).toMatchObject({ ok: true });
    expect(await client.fetchTest(CODE)).toEqual({ ok: false, error: 'which' });
    expect(await client.fetchTest(CODE, id)).toEqual({ ok: true, id });
    expect(await client.fetchTest(testLink(CODE, `${w.target.base}/`))).toEqual({ ok: true, id });
  });

  it('a browser that can’t keep the test says so, and keeps nothing', async () => {
    const failing: Blobs = { get: async () => null, set: async () => Promise.reject(new Error('full')), remove: async () => undefined };
    const w = world({ blobs: failing });
    await paired(w);
    expect(await w.client.fetchTest(CODE)).toEqual({ ok: false, error: 'not_kept' });
    expect((await w.client.status()).testAsking).toBeNull();
  });
});

describe('a test after the yes', () => {
  it('asks first, then syncs from the scenario: test on every batch, Trackman never asked, no sign-in needed', async () => {
    const w = world();
    const id = await paired(w);
    expect(await w.client.fetchTest(CODE)).toEqual({ ok: true, id });
    let s = await w.client.status();
    expect(s.testAsking).toMatchObject({ id, target: 'Example App', name: 'Leon, never switched', who: { player: 'Leon (Test T17)', activities: { count: 25 } } });
    // The icon asks the question, not for a Trackman sign-in: the code stood in for it.
    expect(s.attention).toBe('confirm');
    expect(w.target.imports).toHaveLength(0);
    // "Is this your account?" was played back through the guard, under the scenario's own account.
    expect((await w.client.guard.counts(guardAccount('trackman', SUBJECT))).day).toBeGreaterThan(0);

    expect(await w.client.confirmTest(true)).toEqual({ ok: true, id });
    s = await w.client.status();
    expect(s.testAsking).toBeNull();
    expect(s.pairings[0]?.test).toMatchObject({ name: 'Leon, never switched', player: 'Leon (Test T17)', valid_until: new Date(START + 7 * DAY).toISOString() });
    expect(s.pairings[0]?.signin).toBe('ready');
    // No Trackman sign-in in this browser, and nothing asks for one: the test pairing needs none.
    expect(s.key.state).toBe('none');
    expect(s.attention).toBeNull();

    const r = await w.client.run('connect');
    expect(r.outcomes[0]?.outcome).toMatchObject({ status: 'synced' });
    await history(w);
    expect(w.target.imports.length).toBeGreaterThan(3);
    for (const b of w.target.imports) expect(b.test).toBe(true);
    expect(w.target.sessions.size).toBe(25);
    expect(w.target.rounds.size).toBe(2);
    expect(w.tm.count()).toBe(0);
    expect(w.target.signins.every((x) => x.signin === 'ready')).toBe(true);
    const counts = (await w.client.status()).pairings[0]?.test?.counts;
    expect(counts?.day).toBeGreaterThan(25);
  });

  it('brings the same chunks as a sync with Trackman answering the same', async () => {
    // The real way: Trackman (made up) holds the scenario's answers, the player signs in and says yes.
    const real = world();
    const scen = scenario();
    real.tm.load(scen.data as Json);
    real.tm.profile = scen.profile as Json;
    const token = fakeToken(SUBJECT, { exp: Math.round(START / 1000 + 30 * 86_400), iss: 'https://login.trackmangolf.com' });
    real.tm.tokens.add(token);
    await paired(real);
    await real.client.setKey(token);
    await real.client.confirm(true);
    await real.client.run('connect');
    await history(real);

    const test = world();
    await paired(test);
    await test.client.fetchTest(CODE);
    await test.client.confirmTest(true);
    await test.client.run('connect');
    await history(test);

    const chunks = (t: FakeTarget) => t.imports.map((b) => [b.sync?.reason, b.sessions.map((x) => x.external_id), b.rounds.map((x) => x.external_id), b.progress?.more_available]);
    expect(chunks(test.target)).toEqual(chunks(real.target));
    expect(test.target.imports[0]?.account_ref).toBe(real.target.imports[0]?.account_ref);
    expect(real.target.imports.every((b) => b.test === undefined)).toBe(true);
  });

  it('"No" keeps nothing', async () => {
    const w = world();
    await paired(w);
    await w.client.fetchTest(CODE);
    expect(await w.client.confirmTest(false)).toMatchObject({ ok: true });
    expect((await w.client.status()).testAsking).toBeNull();
    expect((await w.client.status()).pairings[0]?.test).toBeUndefined();
    expect((w.blobs as MemoryBlobs).data.size).toBe(0);
    expect(await w.client.confirmTest(true)).toEqual({ ok: false, error: 'gone' });
  });

  it('ends when the tester ends it: the scenario leaves, the pairing stays, nothing more comes from it', async () => {
    const w = world();
    const id = await paired(w);
    await w.client.fetchTest(CODE);
    await w.client.confirmTest(true);
    await w.client.run('connect');
    const had = w.target.imports.length;
    await w.client.endTest(id);
    const s = await w.client.status();
    expect(s.pairings).toHaveLength(1);
    expect(s.pairings[0]?.test).toBeUndefined();
    expect((w.blobs as MemoryBlobs).data.size).toBe(0);
    // Without a test and without a sign-in nothing is fetched; the target hears that nobody is signed in.
    expect((await w.client.run('timer')).outcomes[0]?.outcome).toEqual({ status: 'skipped', why: 'none' });
    expect(w.target.imports).toHaveLength(had);
    expect(w.target.signins.at(-1)).toEqual({ via: 'status', signin: 'none' });
  });

  it('ends with its pairing, and when the scenario is over', async () => {
    const w = world();
    const id = await paired(w);
    await w.client.fetchTest(CODE);
    await w.client.confirmTest(true);
    await w.client.removePairing(id);
    expect((w.blobs as MemoryBlobs).data.size).toBe(0);

    const later = world();
    await paired(later);
    await later.client.fetchTest(CODE);
    await later.client.confirmTest(true);
    later.clock.advance(8 * DAY);
    expect((await later.client.status()).pairings[0]?.test).toBeUndefined();
    expect((await later.client.run('timer')).outcomes[0]?.outcome).toEqual({ status: 'skipped', why: 'none' });
    expect(later.target.imports).toHaveLength(0);
  });

  it('a test batch the app refuses (not a test account any more) is a line to show, not an error', async () => {
    const w = world();
    await paired(w);
    await w.client.fetchTest(CODE);
    await w.client.confirmTest(true);
    w.target.testAccount = false;
    expect((await w.client.run('connect')).outcomes[0]?.outcome).toMatchObject({ status: 'failed' });
    expect((await w.client.status()).pairings[0]?.last).toMatchObject({ status: 'failed', error: 'test_data' });
    expect(w.target.sessions.size).toBe(0);
  });

  it('an answer that expired meanwhile is not started', async () => {
    const w = world();
    await paired(w);
    w.target.scenarios.set(CODE, scenario({ valid_until: new Date(START + 60_000).toISOString() }));
    await w.client.fetchTest(CODE);
    w.clock.advance(120_000);
    expect(await w.client.confirmTest(true)).toEqual({ ok: false, error: 'expired' });
    expect((await w.client.status()).pairings[0]?.test).toBeUndefined();
  });

  it('a real sign-in and its pairings go on beside a test', async () => {
    const w = world();
    const id = await paired(w);
    expect(id).toBe(pairingId(w.target.base));
    await w.client.fetchTest(CODE);
    await w.client.confirmTest(true);
    const key = fakeToken('player-0001', { exp: Math.round(START / 1000 + 86_400), iss: 'https://login.trackmangolf.com' });
    w.tm.tokens.add(key);
    // A first key of an account: asked about as always - the test pairing's account says nothing about it.
    expect(await w.client.setKey(key)).toMatchObject({ ok: true, asking: true });
    expect((await w.client.status()).key.state).toBe('confirm');
  });
});
