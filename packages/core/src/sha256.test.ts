// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { accountRef } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { readVectors } from '../../spec/src/vectors.ts';
import { accountRefOf, base64url, sha256, utf8, utf8Length } from './sha256.ts';

type RefCase = { salt: string; provider: string; subject: string; expected: string };

describe('account_ref without Web Crypto (account-ref.json)', () => {
  it.each(readVectors<RefCase>('account-ref.json').cases.map((c) => [`${c.provider}|${c.subject}`, c] as const))('%s', (_, c) => {
    expect(accountRefOf(c.salt, c.provider, c.subject)).toBe(c.expected);
  });

  it('is the value Web Crypto gives, for any input', async () => {
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 60; i++) {
      const s = Array.from({ length: Math.floor(rand() * 90) }, () => String.fromCodePoint(Math.floor(rand() * 0x2fff) + 32)).join('');
      expect(accountRefOf(s, 'trackman', `sub-${s}`)).toBe(await accountRef(s, 'trackman', `sub-${s}`));
    }
  });
});

describe('the parts', () => {
  it('hashes as FIPS 180-4 says', () => {
    const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    expect(hex(sha256(utf8('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex(sha256(utf8('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex(sha256(utf8('a'.repeat(1000))))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3');
  });

  it('writes UTF-8 as TextEncoder does, lone surrogates included', () => {
    for (const s of ['', 'abc', 'ä€😀', '\ud800x', 'x\udc00', '\u{10ffff}']) {
      expect([...utf8(s)]).toEqual([...new TextEncoder().encode(s)]);
      expect(utf8Length(s)).toBe(new TextEncoder().encode(s).length);
    }
  });

  it('writes base64url without padding', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 31, 32]) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 251) & 255);
      expect(base64url(b)).toBe(Buffer.from(b).toString('base64url'));
    }
  });
});
