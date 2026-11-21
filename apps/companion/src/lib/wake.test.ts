// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The wake, offline: the address reaches each paired target (and not again until it is due), a target
 * without a wake is left be, a push is read strictly, and a wake does what the timer does - the plans
 * first - at most once in five minutes.
 */
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { FakeTarget, VirtualClock, type FakeTargetOptions } from '@glmsync/core/testing';
import { MemoryStorage, type FetchLike, type Storage } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import { MemorySecrets } from './secrets.ts';
import { makeServices } from './services.ts';
import { isWakePush, runWake, WAKE_FAIL_RETRY_MS, WAKE_NONE_RETRY_MS, WAKE_REFRESH_MS, WAKE_RUN_GAP_MS, WakeGate } from './wake.ts';

const SUB = '7c1d2e3f-0000-4000-8000-0000000000c1';
const DAY = 86_400_000;
const ADDRESS = 'ExponentPushToken[a1B2c3D4e5F6g7H8i9J0kL]';
const OTHER = 'ExponentPushToken[zzzzzzzzzzzzzzzzzzzzzz]';
const WAKE = { data: { body: { kind: 'lm_plan' } } };

function setup(opts: FakeTargetOptions = {}, storage: Storage = new MemoryStorage()) {
  const clock = new VirtualClock(Date.parse('2026-11-21T08:00:00Z'));
  const target = new FakeTarget(opts);
  const tm = new FakeTrackman(clock.now);
  const token = fakeToken(SUB, { exp: Math.floor((clock.t + 7 * DAY) / 1000) });
  tm.tokens.add(token);
  tm.activities = [{ id: 'A1', time: new Date(clock.t - DAY).toISOString(), kind: 'RANGE_PRACTICE' }];
  tm.nodes.set('A1', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const fetch: FetchLike = (url, init) => (url === GRAPHQL_URL ? tm.fetch(url, init) : target.fetch(url, init));
  const services = makeServices({ secrets: new MemorySecrets(), storage, fetch, now: clock.now, sleep: clock.sleep });
  return { clock, target, tm, token, services, storage };
}

async function paired(s: ReturnType<typeof setup>) {
  await s.services.load();
  await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
  await s.services.signIns.set('trackman', s.token);
  return s.services.pairings.list()[0]!;
}

const wakeCalls = (t: FakeTarget) => t.received.filter((r) => r.url.endsWith('/wake'));

describe('registering the address', () => {
  it('tells each paired target once, and again only when it changes or after a week', async () => {
    const s = setup();
    const p = await paired(s);
    await s.services.wakes.keep(ADDRESS);
    expect([...s.target.wakes.values()]).toEqual([{ service: 'expo', address: ADDRESS }]);
    expect(s.services.wakes.entry(p.key)).toMatchObject({ status: 'kept', address: ADDRESS });
    await s.services.wakes.keep(ADDRESS);
    expect(wakeCalls(s.target)).toHaveLength(1);
    await s.services.wakes.keep(OTHER);
    expect([...s.target.wakes.values()]).toEqual([{ service: 'expo', address: OTHER }]);
    s.clock.advance(WAKE_REFRESH_MS);
    await s.services.wakes.keep(OTHER);
    expect(wakeCalls(s.target)).toHaveLength(3);
  });

  it('sends nothing without an address, or with one that is none', async () => {
    const s = setup();
    await paired(s);
    await s.services.wakes.keep(null);
    await s.services.wakes.keep('https://push.example.org/me');
    expect(wakeCalls(s.target)).toHaveLength(0);
  });

  it('leaves a target without a wake be for a week', async () => {
    const s = setup({ wake: false });
    const p = await paired(s);
    await s.services.wakes.keep(ADDRESS);
    expect(s.services.wakes.entry(p.key)).toMatchObject({ status: 'none' });
    s.clock.advance(WAKE_NONE_RETRY_MS - 1);
    await s.services.wakes.keep(ADDRESS);
    expect(wakeCalls(s.target)).toHaveLength(1);
    s.clock.advance(1);
    await s.services.wakes.keep(ADDRESS);
    expect(wakeCalls(s.target)).toHaveLength(2);
  });

  it('keeps a failure, never throws, and tries again a quarter hour later', async () => {
    const s = setup({ fail: { '/wake': { status: 503 } } });
    const p = await paired(s);
    await expect(s.services.wakes.keep(ADDRESS)).resolves.toBeUndefined();
    expect(s.services.wakes.entry(p.key)).toMatchObject({ status: 'failed', error: 'unavailable' });
    await s.services.wakes.keep(ADDRESS);
    expect(wakeCalls(s.target)).toHaveLength(1);
    s.clock.advance(WAKE_FAIL_RETRY_MS);
    await s.services.wakes.keep(ADDRESS);
    expect(wakeCalls(s.target)).toHaveLength(2);
  });

  it('survives a store that refuses, and forgets what it kept for a pairing that is gone', async () => {
    // The wake's own slot unreadable and full; everything else of the app as usual.
    const mem = new MemoryStorage();
    const SLOT = 'glmsync/companion/wake';
    const broken: Storage = {
      get: async (k) => (k === SLOT ? '{not json' : mem.get(k)),
      set: async (k, v) => {
        if (k === SLOT) throw new Error('full');
        await mem.set(k, v);
      },
      remove: (k) => mem.remove(k),
    };
    const s = setup({}, broken);
    const p = await paired(s);
    await expect(s.services.wakes.keep(ADDRESS)).resolves.toBeUndefined();
    expect(s.services.wakes.entry(p.key)).toMatchObject({ status: 'kept' });
    const ok = setup();
    const q = await paired(ok);
    await ok.services.wakes.keep(ADDRESS);
    await ok.services.runner.unpair(q.key);
    await ok.services.wakes.keep(ADDRESS);
    expect(ok.services.wakes.entry(q.key)).toBeNull();
  });
});

describe('reading a push', () => {
  it('finds the wake wherever the platform put the data, and nothing else', () => {
    for (const yes of [
      { kind: 'lm_plan' }, { data: { kind: 'lm_plan' } }, WAKE, { data: { body: '{"kind":"lm_plan"}' } },
      { data: { dataString: '{"kind":"lm_plan"}' } }, { data: '{"kind":"lm_plan"}' },
      { notification: { request: { content: { data: { kind: 'lm_plan' } } } } },
    ]) expect([yes, isWakePush(yes)]).toEqual([yes, true]);
    for (const no of [
      null, 'lm_plan', [], {}, { data: { kind: 'plan' } }, { data: { body: '{"kind":"lm_plan"' } },
      { data: { body: `{"kind":"lm_plan","x":"${'x'.repeat(5000)}"}` } }, { data: { body: { body: { kind: 'lm_plan' } } } },
      { actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { content: { data: {} } } } },
    ]) expect([no, isWakePush(no)]).toEqual([no, false]);
  });
});

describe('a wake', () => {
  it('asks each plan as the timer does, then one history chunk, and fetches only what the plan allows', async () => {
    const s = setup();
    await paired(s);
    const gate = new WakeGate(s.storage);
    const out = await runWake(WAKE, { services: async () => s.services, gate, now: s.clock.now });
    expect(out).toEqual({ status: 'ran' });
    expect(s.target.asked.map((a) => a.reason)).toEqual(['timer', 'backfill']);
    expect(s.target.sessions.has('A1')).toBe(true);
  });

  it('fetches nothing when the plan says no', async () => {
    const s = setup({ plan: () => ({ due: false }) });
    await paired(s);
    const before = s.tm.requests.length;
    await runWake(WAKE, { services: async () => s.services, gate: new WakeGate(s.storage), now: s.clock.now });
    expect(s.target.asked.map((a) => a.reason)).toEqual(['timer', 'backfill']);
    expect(s.target.sessions.size).toBe(0);
    expect(s.tm.requests.length).toBe(before);
  });

  it('runs once in five minutes, also across starts, and not beside itself', async () => {
    const s = setup();
    await paired(s);
    const deps = { services: async () => s.services, gate: new WakeGate(s.storage), now: s.clock.now };
    const started = s.clock.t;
    const [a, b] = await Promise.all([runWake(WAKE, deps), runWake(WAKE, deps)]);
    expect([a.status, b.status].sort()).toEqual(['ignored', 'ran']);
    // Counted from when the wake was let in (the run itself took a few seconds of pauses).
    s.clock.advance(started + WAKE_RUN_GAP_MS - 1 - s.clock.t);
    // A new start of the app (the system started it for the push): the gate's mark is in storage.
    expect(await runWake(WAKE, { ...deps, gate: new WakeGate(s.storage) })).toEqual({ status: 'ignored', why: 'busy' });
    s.clock.advance(1);
    expect(await runWake(WAKE, { ...deps, gate: new WakeGate(s.storage) })).toEqual({ status: 'ran' });
  });

  it('ignores any other push, and says what broke instead of throwing', async () => {
    const s = setup();
    await paired(s);
    const gate = new WakeGate(s.storage);
    expect(await runWake({ data: { kind: 'other' } }, { services: async () => s.services, gate })).toEqual({ status: 'ignored', why: 'not_a_wake' });
    expect(s.target.asked).toHaveLength(0);
    const broken = { services: async () => { throw new TypeError('no store'); }, gate: new WakeGate(new MemoryStorage()) };
    expect(await runWake(WAKE, broken)).toEqual({ status: 'failed', why: 'TypeError' });
    // The gate lets the next wake in after the gap, not stuck on the failed one.
    expect(await runWake(WAKE, { ...broken, now: () => Date.now() + WAKE_RUN_GAP_MS + 1 })).toEqual({ status: 'failed', why: 'TypeError' });
  });
});
