// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The headers of a request to a provider: what the provider module set, and - on a phone - the User-Agent of the
 * browser the player signed in with (kept beside the sign-in). Nothing else: no cookies, no Origin, no Referer.
 */
import { describe, expect, it } from 'vitest';
import { Guard, guardAccount } from './guard.ts';
import type { FetchLike, RequestInitLike } from './http.ts';
import { cleanUserAgent, providerContext } from './provider.ts';
import { MemoryStorage } from './storage.ts';
import { VirtualClock } from './testing/index.ts';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const GIVEN = { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: 'Bearer a.b.c' };

function setup(userAgent?: unknown) {
  const clock = new VirtualClock();
  const seen: RequestInitLike[] = [];
  const fetch: FetchLike = async (_url, init) => {
    seen.push(init);
    return { status: 200, headers: { get: () => null }, text: async () => '{}' };
  };
  const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep, random: () => 0 });
  const ctx = providerContext({
    guard,
    account: guardAccount('demo', 'p1'),
    fetch,
    now: clock.now,
    ...(userAgent !== undefined ? { userAgent: userAgent as string } : {}),
  });
  return { ctx, seen, guard };
}

describe("a provider request's headers", () => {
  it('carries the sign-in browser’s User-Agent beside the module’s own headers, and nothing else', async () => {
    const s = setup(UA);
    await s.guard.beginRun(guardAccount('demo', 'p1'));
    await s.ctx.http('list', 'https://provider.example/api', { method: 'POST', headers: { ...GIVEN }, body: '{}' });
    expect(s.seen[0]?.headers).toEqual({ ...GIVEN, 'User-Agent': UA });
    expect(s.seen[0]?.credentials).toBe('omit');
  });

  it('carries no User-Agent when none was kept with the sign-in (a browser sends its own)', async () => {
    const s = setup();
    await s.guard.beginRun(guardAccount('demo', 'p1'));
    await s.ctx.http('list', 'https://provider.example/api', { method: 'POST', headers: { ...GIVEN } });
    expect(Object.keys(s.seen[0]?.headers ?? {}).sort()).toEqual(['Accept', 'Authorization', 'Content-Type']);
  });

  it('replaces a User-Agent a module set itself, whatever its spelling', async () => {
    const s = setup(UA);
    await s.guard.beginRun(guardAccount('demo', 'p1'));
    await s.ctx.http('list', 'https://provider.example/api', { method: 'GET', headers: { 'user-agent': 'x' } });
    expect(s.seen[0]?.headers).toEqual({ 'User-Agent': UA });
  });

  it('drops a User-Agent that is no header value (line breaks, other characters, too long, empty)', async () => {
    for (const bad of ['a\r\nCookie: x', 'tab\there', 'Ünïcode', 'x'.repeat(513), '', '   ', 42, null]) {
      const s = setup(bad);
      await s.guard.beginRun(guardAccount('demo', 'p1'));
      await s.ctx.http('list', 'https://provider.example/api', { method: 'GET', headers: { ...GIVEN } });
      expect(s.seen[0]?.headers, String(bad)).toEqual(GIVEN);
    }
  });
});

describe('cleanUserAgent', () => {
  it('keeps a printable value up to 512 characters, trimmed, and nothing else', () => {
    expect(cleanUserAgent(UA)).toBe(UA);
    expect(cleanUserAgent(`  ${UA}  `)).toBe(UA);
    expect(cleanUserAgent('x'.repeat(512))).toBe('x'.repeat(512));
    expect(cleanUserAgent('x'.repeat(513))).toBeNull();
    expect(cleanUserAgent('a\nb')).toBeNull();
    expect(cleanUserAgent(undefined)).toBeNull();
    expect(cleanUserAgent({})).toBeNull();
  });
});
