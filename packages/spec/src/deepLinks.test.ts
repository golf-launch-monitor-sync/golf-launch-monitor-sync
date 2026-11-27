// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { pairLink, parseLink, parsePairFragment, parseSyncIntent, parseUniversal, providersOf, readLink, readResult, returnAllowed, SYNC_RESULTS, testLink, UNIVERSAL_BASE, universalLink, withResult } from './deepLinks.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: unknown; expected: unknown };
const file = readVectors<Case>('deep-links.json');
const cases = file.cases;

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
    } else if (c.rule === 'providers_of') expect(providersOf(c.input as string | null)).toEqual(c.expected);
    else if (c.rule === 'with_result') {
      const { url, result } = c.input as { url: unknown; result: unknown };
      expect(withResult(url, result)).toEqual(c.expected);
    } else if (c.rule === 'read_result') expect(readResult(c.input)).toEqual(c.expected);
    else if (c.rule === 'parse_universal') expect(parseUniversal(c.input)).toEqual(c.expected);
    else if (c.rule === 'universal_link') expect(universalLink(c.input)).toEqual(c.expected);
    else throw new Error(`unknown rule ${c.rule}`);
  });

  it('covers every rule', () => {
    expect(new Set(cases.map((c) => c.rule))).toEqual(new Set(['parse_link', 'parse_pair_fragment', 'return_allowed', 'parse_sync_intent', 'providers_of', 'with_result', 'read_result', 'parse_universal', 'universal_link']));
  });
});

describe('the way back and the universal links (1.22.0)', () => {
  it('has the spec’s results and address', () => {
    expect(file.results).toEqual([...SYNC_RESULTS]);
    expect(file.universal).toEqual({ base: UNIVERSAL_BASE });
  });

  it('turns a pairing link into its universal form and back', () => {
    const link = pairLink('https://app.example.org/lm/v1', 'K7M2-PQ9X', 'trackman', 'exampleapp://profile');
    const universal = universalLink(link);
    expect(universal?.startsWith(`${UNIVERSAL_BASE}pair#`)).toBe(true);
    expect(parseUniversal(universal)).toEqual(parseLink(link));
  });

  it('hands the result back once, whatever the way back held', () => {
    const back = withResult('exampleapp://synced?result=new', 'nothing');
    expect(back).toBe('exampleapp://synced?result=nothing');
    expect(readResult(back)).toBe('nothing');
  });
});

describe('a test link (1.8.0)', () => {
  it('reads back as what went in, with and without the target', () => {
    expect(parseLink(testLink('T7K2-M9QX'))).toEqual({ ok: true, action: 'test', code: 'T7K2-M9QX' });
    expect(parseLink(readLink())).toEqual({ ok: true, action: 'read', kind: 'hcp' });
    expect(parseLink(readLink('pro'))).toEqual({ ok: true, action: 'read', kind: 'pro' });
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
