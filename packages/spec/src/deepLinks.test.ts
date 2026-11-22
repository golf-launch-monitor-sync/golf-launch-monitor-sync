// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { pairLink, parseLink, parsePairFragment, parseSyncIntent, readLink, returnAllowed, testLink } from './deepLinks.ts';
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
    } else if (c.rule === 'parse_sync_intent') {
      const { data, reason } = c.input as { data: unknown; reason: unknown };
      expect(parseSyncIntent(data, reason)).toEqual(c.expected);
    } else throw new Error(`unknown rule ${c.rule}`);
  });

  it('covers every rule', () => {
    expect(new Set(cases.map((c) => c.rule))).toEqual(new Set(['parse_link', 'parse_pair_fragment', 'return_allowed', 'parse_sync_intent']));
  });
});

describe('a test link (1.8.0)', () => {
  it('reads back as what went in, with and without the target', () => {
    expect(parseLink(testLink('T7K2-M9QX'))).toEqual({ ok: true, action: 'test', code: 'T7K2-M9QX' });
    expect(parseLink(readLink())).toEqual({ ok: true, action: 'read', kind: 'hcp' });
    expect(parseLink(testLink('T7K2-M9QX', 'https://app.example.org/lm/v1'))).toEqual({ ok: true, action: 'test', target: 'https://app.example.org/lm/v1', code: 'T7K2-M9QX' });
  });

  it('is no sync for the Android service', () => {
    expect(parseSyncIntent(testLink('T7K2-M9QX', 'https://app.example.org/lm/v1'), 'open')).toEqual({ ok: false, error: 'invalid:action' });
  });
});

describe('a pairing link', () => {
  it('reads back as what went in', () => {
    const link = pairLink('https://app.example.org/lm/v1', 'K7M2-PQ9X', 'trackman');
    expect(parseLink(link)).toEqual({ ok: true, action: 'pair', target: 'https://app.example.org/lm/v1', code: 'K7M2-PQ9X', provider: 'trackman' });
  });

  it('carries where to jump back to once paired (1.2.0)', () => {
    const link = pairLink('https://app.example.org/lm/v1', 'K7M2-PQ9X', undefined, 'exampleapp://profile?focus=lm');
    expect(parseLink(link)).toEqual({ ok: true, action: 'pair', target: 'https://app.example.org/lm/v1', code: 'K7M2-PQ9X', return: 'exampleapp://profile?focus=lm' });
  });

  it('names the handicap target API (1.10.0)', () => {
    const link = pairLink('https://app.example.org/hcp/v1', 'K7M2-PQ9X', 'golfde', undefined, 'hcp');
    expect(parseLink(link)).toEqual({ ok: true, action: 'pair', target: 'https://app.example.org/hcp/v1', code: 'K7M2-PQ9X', provider: 'golfde', kind: 'hcp' });
    expect(parsePairFragment('#target=https%3A%2F%2Fapp.example.org%2Fhcp%2Fv1&code=K7M2PQ9X&kind=hcp')).toMatchObject({ ok: true, kind: 'hcp' });
  });

  it('is refused for anything that is no string', () => {
    expect(parseLink(undefined)).toEqual({ ok: false, error: 'invalid:link' });
    expect(parsePairFragment(42)).toEqual({ ok: false, error: 'invalid:link' });
  });
});
