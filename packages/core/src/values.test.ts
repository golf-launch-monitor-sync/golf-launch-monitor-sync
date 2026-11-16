// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { readVectors } from '../../spec/src/vectors.ts';
import { camelClub, normalizeClub } from './clubs.ts';
import { cut, externalId, integer, num, put, strip, text, when } from './values.ts';

type ValueCase = { rule: 'when' | 'integer' | 'num'; value: unknown; expected: unknown };
type ClubCase = { rule: 'camel' | 'normalize'; raw: unknown; code: string };

describe('reading untrusted values (values.json)', () => {
  const rules = { when, integer, num };
  it.each(readVectors<ValueCase>('values.json').cases.map((c) => [`${c.rule}(${JSON.stringify(c.value)})`, c] as const))('%s', (_, c) => {
    expect(rules[c.rule](c.value)).toEqual(c.expected);
  });
});

describe('club names (clubs.json)', () => {
  it.each(readVectors<ClubCase>('clubs.json').cases.map((c) => [`${c.rule}(${JSON.stringify(c.raw)})`, c] as const))('%s', (_, c) => {
    expect(c.rule === 'camel' ? camelClub(c.raw) : normalizeClub(c.raw as string)).toBe(c.code);
  });
});

describe('the helpers behind them', () => {
  it("trims what Python's strip() trims, and only that", () => {
    expect(strip('\x1c　 x  ')).toBe('x');
    expect(strip('﻿x')).toBe('﻿x');
  });

  it('cuts by code point, so a character outside the BMP is never halved', () => {
    expect(cut('a😀b', 2)).toBe('a😀');
    expect(cut('abc', 5)).toBe('abc');
    expect(text('  😀😀😀 ', 2)).toBe('😀😀');
  });

  it('reads an id as text, a whole number written out, and nothing else', () => {
    expect([externalId(' A-1 '), externalId(9001), externalId(-0), externalId(1.5), externalId(2 ** 60), externalId(true), externalId('  ')])
      .toEqual(['A-1', '9001', '0', null, null, null, null]);
    expect(externalId('x'.repeat(500))).toHaveLength(400);
  });

  it('leaves out what is unknown: no nulls, no empty groups', () => {
    const out: Record<string, unknown> = {};
    put(out, 'a', null);
    put(out, 'b', {});
    put(out, 'c', 0);
    put(out, 'd', []);
    expect(out).toEqual({ c: 0, d: [] });
  });

  it('never gives -0 for a whole number', () => {
    expect(Object.is(integer('-0'), 0)).toBe(true);
    expect(Object.is(integer(-0), 0)).toBe(true);
  });
});
