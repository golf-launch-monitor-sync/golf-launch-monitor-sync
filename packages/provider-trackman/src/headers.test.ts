// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What every call of a whole sync carries, against a made-up Trackman and a made-up target: to Trackman only
 * `Content-Type`, `Accept`, `Authorization` and - when one was kept with the sign-in, as on a phone - the User-Agent
 * of the browser the player signed in with; never a cookie, an `Origin`, a `Referer`, nor anything of the target. To
 * the target never the User-Agent nor the sign-in.
 */
import { Guard, HttpTarget, MemoryStorage, pair, sync, type FetchLike, type RequestInitLike } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { describe, expect, it } from 'vitest';
import { GRAPHQL_URL } from './client.ts';
import { trackman } from './index.ts';
import { FakeTrackman, fakeToken } from './testing.ts';

const SUB = '7c1d2e3f-0000-4000-8000-0000000000d1';
const DAY = 86_400_000;
const UA = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.0.0 Mobile Safari/537.36';

async function run(userAgent?: string) {
  const clock = new VirtualClock(Date.parse('2026-11-28T08:00:00Z'));
  const tm = new FakeTrackman(clock.now);
  const token = fakeToken(SUB, { exp: Math.floor((clock.t + 7 * DAY) / 1000) });
  tm.tokens.add(token);
  tm.activities = [{ id: 'A1', time: new Date(clock.t - DAY).toISOString(), kind: 'RANGE_PRACTICE' }];
  tm.nodes.set('A1', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const target = new FakeTarget();
  const toTarget: { url: string; init: RequestInitLike }[] = [];
  const fetch: FetchLike = (url, init) => {
    if (url === GRAPHQL_URL) return tm.fetch(url, init);
    toTarget.push({ url, init });
    return target.fetch(url, init);
  };
  const pairing = await pair({ target: target.base, code: 'K7M2PQ9X', provider: 'trackman', client: { kind: 'companion', name: 'Test' }, fetch });
  const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep, random: () => 0 });
  const outcome = await sync({
    target: new HttpTarget(pairing, { fetch, now: clock.now }),
    provider: trackman(),
    credential: token,
    reason: 'manual',
    client: 'companion',
    guard,
    fetch,
    now: clock.now,
    sleep: clock.sleep,
    ...(userAgent ? { userAgent } : {}),
  });
  return { outcome, tm, toTarget, token, pairing };
}

const lower = (h: Record<string, string> | undefined) => Object.keys(h ?? {}).map((k) => k.toLowerCase());

describe("every call of a sync on a phone", () => {
  it('to Trackman: the module’s three headers and the sign-in browser’s User-Agent, nothing else', async () => {
    const { outcome, tm } = await run(UA);
    expect(outcome.status).toBe('synced');
    expect(tm.requests.length).toBeGreaterThan(1);
    for (const r of tm.requests) {
      expect(Object.keys(r.headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type', 'User-Agent']);
      expect(r.headers['User-Agent']).toBe(UA);
      expect(r.credentials).toBe('omit');
    }
  });

  it('to the target: never the User-Agent, the sign-in or a cookie', async () => {
    const { toTarget, token, pairing } = await run(UA);
    expect(toTarget.length).toBeGreaterThan(1);
    for (const r of toTarget) {
      const keys = lower(r.init.headers);
      expect(keys).not.toContain('user-agent');
      expect(keys).not.toContain('cookie');
      expect(JSON.stringify(r.init.headers)).not.toContain(token);
      expect(r.init.body ?? '').not.toContain(token);
      expect(r.init.body ?? '').not.toContain(UA);
    }
    // And nothing of the target goes to Trackman: not its address, not its import token.
    expect(pairing.token.length).toBeGreaterThan(0);
  });

  it('nothing of the target reaches Trackman, and no cookie, Origin or Referer ever', async () => {
    const { tm, pairing } = await run(UA);
    for (const r of tm.requests) {
      const keys = lower(r.headers);
      for (const k of ['cookie', 'origin', 'referer']) expect(keys).not.toContain(k);
      const all = JSON.stringify({ h: r.headers, q: r.query, v: r.variables });
      expect(all).not.toContain(pairing.token);
      expect(all).not.toContain(new URL(pairing.base).host);
    }
  });

  it('without a User-Agent kept (a browser, which sends its own): only the three headers', async () => {
    const { tm } = await run();
    for (const r of tm.requests) expect(Object.keys(r.headers).sort()).toEqual(['Accept', 'Authorization', 'Content-Type']);
  });
});
