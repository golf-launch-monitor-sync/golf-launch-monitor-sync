// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { claims, expiresAt, subjectOf } from './account.ts';
import { fakeToken } from './testing.ts';

describe('the account a sign-in opens', () => {
  it('is the token’s subject, read without verifying it', () => {
    expect(subjectOf(fakeToken('7c1d2e3f-0000-4000-8000-000000000001'))).toBe('7c1d2e3f-0000-4000-8000-000000000001');
    expect(subjectOf(fakeToken('ünï-cödé'))).toBe('ünï-cödé');
    expect(expiresAt(fakeToken('x', { exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it('is none for a token that has none, or is no token', () => {
    for (const t of ['', 'abc', 'a.b.c', 'a.%%%.c', fakeToken(''), `x.${Buffer.from('[1]').toString('base64url')}.y`, `x.${Buffer.from([0xff, 0xfe]).toString('base64url')}.y`]) {
      expect(subjectOf(t)).toBeNull();
    }
    expect(claims(`x.${Buffer.from('{"sub": 7}').toString('base64url')}.y`)).toEqual({ sub: 7 });
    expect(subjectOf(`x.${Buffer.from('{"sub": 7}').toString('base64url')}.y`)).toBeNull();
  });

  it('reads base64 with and without padding', () => {
    const payload = Buffer.from('{"sub":"ab"}').toString('base64');
    expect(subjectOf(`x.${payload}.y`)).toBe('ab');
  });
});
