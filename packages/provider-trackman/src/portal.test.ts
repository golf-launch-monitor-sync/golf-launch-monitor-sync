// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { bearer, best, cookieValues, liveUntil, rank, strings } from './portal.ts';
import { fakeToken } from './testing.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const inHours = (h: number) => Math.round(NOW / 1000 + h * 3600);

describe('finding the key in the portal', () => {
  const ours = fakeToken('player-1', { exp: inHours(24), iss: 'https://login.trackmangolf.com' });
  const longerOther = fakeToken('x', { exp: inHours(500), iss: 'https://analytics.example' });
  const expired = fakeToken('player-1', { exp: inHours(-1), iss: 'https://login.trackmangolf.com' });

  it('takes only tokens that have not run out', () => {
    expect(liveUntil(ours, NOW)).toBe(inHours(24) * 1000);
    expect(liveUntil(expired, NOW)).toBeNull();
    expect(liveUntil(fakeToken('a'), NOW)).toBeNull(); // no exp
    expect(liveUntil('not a token', NOW)).toBeNull();
    expect(liveUntil(42, NOW)).toBeNull();
  });

  it("prefers Trackman's own sign-in over a longer-lasting stranger, then the longer-lasting", () => {
    expect(best([longerOther, ours, expired, 'junk'], NOW)).toBe(ours);
    const later = fakeToken('player-1', { exp: inHours(48), iss: 'https://login.trackmangolf.com' });
    expect(best([ours, later], NOW)).toBe(later);
    expect(best([expired, 'junk'], NOW)).toBeNull();
    expect(rank(fakeToken('a', { exp: inHours(1), iss: 'https://trackmangolf.com.evil.example' }), NOW)).toBeLessThan(1e14);
  });

  it('reads nested JSON in storage, a few levels deep only', () => {
    const stored = JSON.stringify({ auth: { user: { access_token: ours } }, other: '[1,2]' });
    expect(strings(stored)).toContain(ours);
    let deep: unknown = ours;
    for (let i = 0; i < 10; i++) deep = { x: deep };
    expect(strings(deep)).not.toContain(ours);
    expect(strings('{broken')).toEqual(['{broken']);
  });

  it('reads a bearer header and cookie values', () => {
    expect(bearer(`Bearer ${ours}`)).toBe(ours);
    expect(bearer(`bearer  ${ours} `)).toBe(ours);
    expect(bearer('Basic abc')).toBeNull();
    expect(bearer(undefined)).toBeNull();
    expect(cookieValues(`a=1; tm=${encodeURIComponent(ours)}; bad=%E0%A4%A`)).toEqual(['1', ours, '%E0%A4%A']);
  });
});
