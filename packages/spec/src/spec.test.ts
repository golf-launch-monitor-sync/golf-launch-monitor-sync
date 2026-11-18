// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import schema from '../../../spec/olmd/olmd-1.schema.json' with { type: 'json' };
import { GUARD_LIMITS, PLAN_RULES, REASONS, SIGN_IN_STATES, validateBatch } from './index.ts';
import { SPEC_DIR, readVectors, specVersion } from './vectors.ts';

describe('the vectors', () => {
  it('all belong to this version of the spec', () => {
    const files = readdirSync(`${SPEC_DIR}testvectors`).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) expect([f, readVectors(f).spec_version]).toEqual([f, specVersion()]);
  });

  it('were written with the limits and rules that are in force', () => {
    expect(readVectors('guard.json').limits).toEqual(GUARD_LIMITS);
    expect(readVectors('plan.json').rules).toEqual(PLAN_RULES);
  });
});

describe('the olmd/1 schema', () => {
  type Example = { name: string; valid: boolean; batch: unknown };

  it.each(readVectors<Example>('olmd-examples.json').cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const result = validateBatch(c.batch);
    expect(result.ok).toBe(c.valid);
  });

  it('takes every batch the Trackman reference writes', () => {
    for (const c of readVectors<{ name: string; expected: unknown }>('trackman-olmd.json').cases) {
      const result = validateBatch(c.expected);
      expect([c.name, result.ok ? [] : result.errors]).toEqual([c.name, []]);
    }
  });

  it('says where a batch is wrong', () => {
    const result = validateBatch({ format: 'olmd/1', provider: 'demo', account_ref: 'x'.repeat(43),
      generated_at: '2026-11-16T12:00:00Z', sessions: [{ external_id: 'a', kind: 'range', shots: [{ flight: { carry_yd: 150 } }] }],
      rounds: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContainEqual({ path: '/sessions/0/shots/0/flight', message: 'must NOT have additional properties: carry_yd' });
  });

  it('never throws, whatever it is given', () => {
    for (const junk of [null, undefined, 1, 'olmd/1', [], { format: 'olmd/1' }]) expect(validateBatch(junk).ok).toBe(false);
  });

  it('knows the same reasons as the types and the target API', () => {
    const api = parse(readFileSync(`${SPEC_DIR}api/target-api.yaml`, 'utf8'));
    expect(schema.properties.sync.properties.reason.enum).toEqual([...REASONS]);
    expect(api.components.schemas.Reason.enum).toEqual([...REASONS]);
  });
});

describe('the target API', () => {
  const api = parse(readFileSync(`${SPEC_DIR}api/target-api.yaml`, 'utf8'));

  it('is OpenAPI 3.1 with the six endpoints', () => {
    expect(api.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(api.paths).sort()).toEqual(['/import', '/known', '/pair', '/plan', '/status', '/token']);
  });

  it('has every reference resolve', () => {
    const refs: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === '$ref' && typeof x === 'string') refs.push(x);
          else walk(x);
        }
      }
    };
    walk(api);
    expect(refs.length).toBeGreaterThan(10);
    for (const ref of refs) {
      if (ref.startsWith('#/')) {
        let at: unknown = api;
        for (const part of ref.slice(2).split('/')) at = (at as Record<string, unknown> | undefined)?.[part];
        expect([ref, at !== undefined]).toEqual([ref, true]);
      } else {
        expect([ref, existsSync(new URL(ref, `file://${SPEC_DIR}api/`))]).toEqual([ref, true]);
      }
    }
  });

  it('knows the same sign-in states as the types, on the plan and the status (1.5.0)', () => {
    expect(api.components.schemas.SignIn.enum).toEqual([...SIGN_IN_STATES]);
    const takes = (op: { parameters?: { $ref?: string }[] }) => (op.parameters ?? []).some((p) => p.$ref === '#/components/parameters/SignIn');
    expect(takes(api.paths['/plan'].get)).toBe(true);
    expect(takes(api.paths['/status'].get)).toBe(true);
  });

  it('asks for the import token everywhere but at pairing', () => {
    expect(api.security).toEqual([{ importToken: [] }]);
    expect(api.paths['/pair'].post.security).toEqual([]);
    for (const [path, ops] of Object.entries<Record<string, { security?: unknown }>>(api.paths)) {
      if (path !== '/pair') for (const op of Object.values(ops)) expect(op.security).toBeUndefined();
    }
  });
});

describe('the guard limits', () => {
  it('are the ones the spec describes', () => {
    expect(GUARD_LIMITS).toMatchObject({
      concurrency: 1,
      pause_s: { min: 1, max: 3 },
      per_run: 40,
      per_hour: 60,
      hour_window_s: 3600,
      per_day: 300,
      day_window_s: 86400,
      backoff: { first_s: 60, factor: 2, max_s: 3600 },
    });
  });
});
