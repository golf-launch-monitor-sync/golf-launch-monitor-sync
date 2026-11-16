// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { pairLink, parseLink, parsePairFragment, returnAllowed } from './deepLinks.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: unknown; expected: unknown };
const cases = readVectors<Case>('deep-links.json').cases;

describe('deep links answer the vectors', () => {
  it.each(cases.map((c, i) => [`${i} ${c.rule} ${JSON.stringify(c.input)}`, c] as const))('%s', (_, c) => {
    if (c.rule === 'parse_link') expect(parseLink(c.input)).toEqual(c.expected);
    else if (c.rule === 'parse_pair_fragment') expect(parsePairFragment(c.input)).toEqual(c.expected);
    else if (c.rule === 'return_allowed') {
      const { url, prefixes } = c.input as { url: string; prefixes: string[] };
      expect(returnAllowed(url, prefixes)).toEqual(c.expected);
    } else throw new Error(`unknown rule ${c.rule}`);
  });

  it('covers every rule', () => {
    expect(new Set(cases.map((c) => c.rule))).toEqual(new Set(['parse_link', 'parse_pair_fragment', 'return_allowed']));
  });
});

describe('a pairing link', () => {
  it('reads back as what went in', () => {
    const link = pairLink('https://app.example.org/lm/v1', 'K7M2-PQ9X', 'trackman');
    expect(parseLink(link)).toEqual({ ok: true, action: 'pair', target: 'https://app.example.org/lm/v1', code: 'K7M2-PQ9X', provider: 'trackman' });
  });

  it('is refused for anything that is no string', () => {
    expect(parseLink(undefined)).toEqual({ ok: false, error: 'invalid:link' });
    expect(parsePairFragment(42)).toEqual({ ok: false, error: 'invalid:link' });
  });
});
