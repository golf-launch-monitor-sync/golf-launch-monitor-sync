// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  instantMs,
  readTestScenario,
  TEST_CODE,
  TEST_CODE_HEADER,
  TEST_SCENARIO_MAX_BYTES,
  TEST_SCENARIO_MAX_LATENCY_S,
  TEST_SCENARIO_MAX_QUERIES,
  TEST_SIGNIN_MAX_S,
  TEST_SIGNIN_MIN_S,
  testSigninUntil,
} from './testMode.ts';
import { SPEC_DIR, readVectors, type VectorFile } from './vectors.ts';

type Case = { name: string; input: { answer: unknown; now: string }; expected: unknown };
const file = readVectors<Case>('test-scenario.json') as VectorFile<Case> & {
  signin_until: { name: string; input: { scenario: { valid_until: string; signin_valid_s?: number }; now_ms: number }; expected: string | null }[];
};

describe('a test scenario answers the vectors (1.8.0)', () => {
  it.each(file.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(readTestScenario(c.input.answer, c.input.now)).toEqual(c.expected);
  });

  it('with the limits the reference keeps', () => {
    expect(file.limits).toEqual({
      max_bytes: TEST_SCENARIO_MAX_BYTES,
      max_latency_s: TEST_SCENARIO_MAX_LATENCY_S,
      max_queries: TEST_SCENARIO_MAX_QUERIES,
      min_signin_s: TEST_SIGNIN_MIN_S,
      max_signin_s: TEST_SIGNIN_MAX_S,
    });
  });
});

describe('when a test sign-in runs out, as the vectors say (1.28.0)', () => {
  it.each(file.signin_until.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect(testSigninUntil(c.input.scenario, c.input.now_ms)).toBe(c.expected);
  });

  it('never throws on a clock or an end that is none', () => {
    expect(testSigninUntil({ valid_until: 'soon' }, 0)).toBeNull();
    expect(testSigninUntil({ valid_until: '2026-11-28T18:00:00Z' }, Number.NaN)).toBeNull();
  });
});

describe('reading a scenario', () => {
  const answer = { name: 'steady', provider: 'trackman', subject: 'test-1', profile: {}, data: {}, valid_until: '2026-11-28T18:00:00Z' };

  it('never throws, whatever it is given', () => {
    for (const junk of [undefined, 0, true, [], () => 1, { name: {} }, { ...answer, latency: { queries: { a: null } } }]) {
      expect(() => readTestScenario(junk, '2026-11-21T18:00:00Z')).not.toThrow();
    }
  });

  it('counts a name in characters, not UTF-16 units', () => {
    expect(readTestScenario({ ...answer, name: '⛳'.repeat(100) }, '2026-11-21T18:00:00Z').ok).toBe(true);
    expect(readTestScenario({ ...answer, name: '\u{1F3CC}'.repeat(100) }, '2026-11-21T18:00:00Z').ok).toBe(true);
    expect(readTestScenario({ ...answer, name: '\u{1F3CC}'.repeat(101) }, '2026-11-21T18:00:00Z').ok).toBe(false);
  });

  it('reads the years before 100 as such', () => {
    expect(instantMs('0099-01-01T00:00:00Z')).toBe(Date.parse('0099-01-01T00:00:00Z'));
    expect(instantMs('2026-11-21T19:00:00.1239+01:00')).toBe(Date.parse('2026-11-21T18:00:00.123Z'));
    expect(instantMs('0000-01-01T00:00:00Z')).toBeNull();
  });
});

describe('the endpoint in the target API', () => {
  const api = parse(readFileSync(`${SPEC_DIR}api/target-api.yaml`, 'utf8'));
  const op = api.paths['/test-scenario'].get;

  it('takes the code in its header, never in the address', () => {
    const params = op.parameters as { name: string; in: string; required?: boolean; schema: { pattern: string } }[];
    expect(params.map((p) => [p.name, p.in, p.required])).toEqual([[TEST_CODE_HEADER, 'header', true]]);
    expect(params[0]?.schema.pattern).toBe(TEST_CODE.source);
  });

  it('answers with the scenario or the errors the spec names', () => {
    expect(op.responses['200'].content['application/json'].schema.$ref).toBe('#/components/schemas/TestScenario');
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '410', '429']);
    const codes = api.components.schemas.Error.properties.error.properties.code.enum as string[];
    for (const c of ['code_invalid', 'test_unavailable', 'not_test_account', 'code_expired', 'test_data']) expect(codes).toContain(c);
  });

  it('describes the scenario the reader reads', () => {
    const s = api.components.schemas.TestScenario;
    expect([...s.required].sort()).toEqual(['data', 'name', 'profile', 'provider', 'subject', 'valid_until']);
    expect(s.properties.subject.pattern).toBe('^[\\x21-\\x7e]{1,200}$');
    expect(s.properties.latency.properties.queries.maxProperties).toBe(TEST_SCENARIO_MAX_QUERIES);
    expect(api.components.schemas.Latency.properties.median_s.maximum).toBe(TEST_SCENARIO_MAX_LATENCY_S);
  });

  it('refuses a test batch for a real account at the import', () => {
    expect(api.paths['/import'].post.responses['403'].description).toContain('test_data');
  });
});
