// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The engine as an app embeds it: made from what the platform brings (secure store, storage, network, clock), its
 * runs against a made-up target and a made-up Trackman, offline. Here what is the engine's own beyond the runner's
 * tests: how it is put together, the client it names to a target, and the sign-in browser's User-Agent on every call
 * to the provider (and on none to the target).
 */
import { MemoryStorage, type FetchLike, type RequestInitLike } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { describe, expect, it } from 'vitest';
import { makeEngine, MemorySecrets, PROVIDERS, type EnginePlatform } from './index.ts';

const SUB = '7c1d2e3f-0000-4000-8000-0000000000e1';
const DAY = 86_400_000;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const UA2 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

function setup(over: Partial<EnginePlatform> = {}) {
  const clock = new VirtualClock(Date.parse('2026-11-28T08:00:00Z'));
  const target = new FakeTarget();
  const tm = new FakeTrackman(clock.now);
  const token = fakeToken(SUB, { exp: Math.floor((clock.t + 7 * DAY) / 1000) });
  tm.tokens.add(token);
  tm.activities = [
    { id: 'A1', time: new Date(clock.t - DAY).toISOString(), kind: 'RANGE_PRACTICE' },
    { id: 'A2', time: new Date(clock.t - 2 * DAY).toISOString(), kind: 'RANGE_PRACTICE' },
  ];
  for (const a of tm.activities) tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const toTarget: { url: string; init: RequestInitLike }[] = [];
  const fetch: FetchLike = (url, init) => {
    if (url === GRAPHQL_URL) return tm.fetch(url, init);
    toTarget.push({ url, init });
    return target.fetch(url, init);
  };
  const secrets = new MemorySecrets();
  const storage = new MemoryStorage();
  const platform: EnginePlatform = { secrets, storage, fetch, now: clock.now, sleep: clock.sleep, version: '0.1.0-test', ...over };
  return { clock, target, tm, token, toTarget, secrets, storage, platform, engine: makeEngine(platform) };
}

async function paired(s: ReturnType<typeof setup>) {
  await s.engine.load();
  return s.engine.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
}

describe('the engine', () => {
  it('offers Trackman and the demo, nothing of golf.de or the tours', () => {
    const s = setup();
    expect(PROVIDERS).toEqual(['trackman', 'demo']);
    expect(Object.keys(s.engine.providers)).toEqual(['trackman', 'demo']);
  });

  it('names the client the app gives it to the target, else the companion as before', async () => {
    const pairedAs = (t: FakeTarget) => (JSON.parse(t.received.find((r) => r.url.endsWith('/pair'))?.body ?? '{}') as { client?: unknown }).client;
    const plain = setup();
    await paired(plain);
    expect(pairedAs(plain.target)).toEqual({ kind: 'companion', name: 'Golf Stats Sync', version: '0.1.0-test' });
    const other = setup({ client: { kind: 'other', name: 'Golf Stats Sync engine' } });
    await paired(other);
    expect(pairedAs(other.target)).toEqual({ kind: 'other', name: 'Golf Stats Sync engine', version: '0.1.0-test' });
    await other.engine.runner.syncAll('timer');
    expect(other.target.asked.at(-1)?.client).toBe('other');
  });

  it('keeps the sign-in browser’s User-Agent beside the sign-in, in the secure store, across a restart', async () => {
    const s = setup();
    await paired(s);
    await s.engine.signIns.set('trackman', s.token, 'Test Player', UA);
    expect(s.engine.signIns.get('trackman')?.userAgent).toBe(UA);
    expect([...s.storage.data.values()].some((v) => v.includes(UA))).toBe(false);
    const again = makeEngine(s.platform);
    await again.load();
    expect(again.signIns.get('trackman')?.userAgent).toBe(UA);
  });

  it('sends it with every call to Trackman, and with none to the target', async () => {
    const s = setup();
    await paired(s);
    await s.engine.signIns.set('trackman', s.token, null, UA);
    const [r] = await s.engine.runner.syncAll('timer');
    expect(r?.run.status).toBe('synced');
    expect(s.tm.requests.length).toBeGreaterThan(1);
    for (const q of s.tm.requests) expect(q.headers).toEqual({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${s.token}`, 'User-Agent': UA });
    for (const q of s.toTarget) expect(Object.keys(q.init.headers).map((k) => k.toLowerCase())).not.toContain('user-agent');
  });

  it('"Is this you?" goes with the User-Agent of the window it was signed in with', async () => {
    const s = setup();
    await s.engine.load();
    await s.engine.runner.who('trackman', s.token, UA);
    expect(s.tm.requests.length).toBeGreaterThan(0);
    for (const q of s.tm.requests) expect(q.headers['User-Agent']).toBe(UA);
  });

  it('a renewal reads it anew; one that could not read it keeps the last of the same account, never another’s', async () => {
    const s = setup();
    await s.engine.load();
    await s.engine.signIns.set('trackman', s.token, null, UA);
    await s.engine.signIns.set('trackman', s.token, null, UA2);
    expect(s.engine.signIns.get('trackman')?.userAgent).toBe(UA2);
    await s.engine.signIns.set('trackman', s.token, null, null);
    expect(s.engine.signIns.get('trackman')?.userAgent).toBe(UA2);
    const other = fakeToken('7c1d2e3f-0000-4000-8000-0000000000e2', { exp: Math.floor((s.clock.t + 7 * DAY) / 1000) });
    await s.engine.signIns.set('trackman', other, null, null);
    expect(s.engine.signIns.get('trackman')?.userAgent).toBeNull();
  });

  it('takes no User-Agent that is no header value', async () => {
    const s = setup();
    await s.engine.load();
    await s.engine.signIns.set('trackman', s.token, null, 'evil\r\nCookie: x');
    expect(s.engine.signIns.get('trackman')?.userAgent).toBeNull();
  });

  it('a sign-in kept before the User-Agent was (an older app) reads as none, and sends none', async () => {
    const s = setup();
    await s.secrets.set('glmsync.signin.trackman', `v:${JSON.stringify({ token: s.token, subject: SUB, player: null, at: s.clock.t })}`);
    await paired(s);
    expect(s.engine.signIns.get('trackman')?.userAgent).toBeNull();
    await s.engine.runner.syncAll('timer');
    for (const q of s.tm.requests) expect(Object.keys(q.headers)).not.toContain('User-Agent');
  });
});
