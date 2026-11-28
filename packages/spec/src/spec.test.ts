// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import schema from '../../../spec/olmd/olmd-1.schema.json' with { type: 'json' };
import hcpSchema from '../../../spec/hcp/dgvhcp-1.schema.json' with { type: 'json' };
import hcpRules from '../../../spec/hcp/rules.json' with { type: 'json' };
import eventSchema from '../../../spec/hcp/dgvevent-1.schema.json' with { type: 'json' };
import proSchema from '../../../spec/prores/prores-1.schema.json' with { type: 'json' };
import proTours from '../../../spec/prores/tours.json' with { type: 'json' };
import { makeAjv } from './check.ts';
import { ASK_CAUSES, ENV_MAX, GUARD_LIMITS, isoWeek, placeOf, PLAN_RULES, PRORES_MAX, REASONS, SIGN_IN_STATES, TOUR_CODES, tourOf, validateBatch, weekOf } from './index.ts';
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

  it('is OpenAPI 3.1 with the six endpoints, the optional one for test scenarios (1.8.0) and the wake (1.9.0)', () => {
    expect(api.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(api.paths).sort()).toEqual(['/import', '/known', '/pair', '/plan', '/status', '/test-scenario', '/token', '/wake']);
  });

  it('takes the wake address the vectors take (1.9.0)', () => {
    const schemas = (api as { components: { schemas: Record<string, { properties: Record<string, { pattern?: string; enum?: string[] }> }> } }).components.schemas;
    const wake = schemas.WakeRegistration!;
    const pattern = new RegExp(wake.properties.address!.pattern!);
    const cases = readVectors<{ rule: string; input: unknown; expected: unknown }>('wake.json').cases.filter((c) => c.rule === 'read_wake');
    for (const c of cases) {
      const body = c.input as { service?: unknown; address?: unknown } | null;
      const fits = !!body && typeof body === 'object' && !Array.isArray(body) && typeof body.address === 'string'
        && body.address.length <= 256 && pattern.test(body.address)
        && typeof body.service === 'string' && (wake.properties.service!.enum ?? []).includes(body.service);
      expect([c.input, fits]).toEqual([c.input, c.expected !== null]);
    }
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

  it('asks and answers as the vectors read it (1.22.0)', () => {
    type Param = { name?: string; schema?: { $ref?: string; maxLength?: number; pattern?: string } };
    const params = (api.paths['/plan'].get.parameters as Param[]).filter((p) => p.name);
    const byName = Object.fromEntries(params.map((p) => [p.name, p]));
    expect(byName.cause?.schema).toEqual({ $ref: '#/components/schemas/Cause' });
    expect(api.components.schemas.Cause.enum).toEqual([...ASK_CAUSES]);
    // 1.29.0: one parameter `env` for the plan and the status.
    const env = api.components.parameters.Env as Param;
    expect([env.name, env.schema?.maxLength]).toEqual(['env', ENV_MAX]);
    const takesEnv = (op: { parameters?: { $ref?: string }[] }) => (op.parameters ?? []).some((p) => p.$ref === '#/components/parameters/Env');
    expect([takesEnv(api.paths['/plan'].get), takesEnv(api.paths['/status'].get)]).toEqual([true, true]);
    const version = new RegExp(byName.version?.schema?.pattern ?? '^$');
    for (const c of readVectors<{ rule: string; input: unknown; expected: unknown }>('ask.json').cases.filter((x) => x.rule === 'read_version')) {
      const v = Array.isArray(c.input) && c.input.length === 1 ? c.input[0] : null;
      expect([c.input, typeof v === 'string' && version.test(v)]).toEqual([c.input, c.expected !== null]);
    }
    const plan = api.components.schemas.Plan.properties;
    for (const key of ['next_at', 'due_at']) expect([key, plan[key]?.allOf]).toEqual([key, [{ $ref: '#/components/schemas/Time' }]]);
    expect(plan.outdated).toMatchObject({ type: 'boolean' });
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

describe('the handicap record (1.6.0)', () => {
  type Example = { name: string; valid: boolean; batch: unknown };
  const hcp = parse(readFileSync(`${SPEC_DIR}api/hcp-api.yaml`, 'utf8'));
  // Compiled here only: the browser bundles carry no runtime schema compiler (check.ts).
  const checkHcp = makeAjv().compile(hcpSchema);

  it.each(readVectors<Example>('dgvhcp-examples.json').cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect([c.name, checkHcp(c.batch)]).toEqual([c.name, c.valid]);
  });

  it('were written with the rules that are in force', () => {
    expect(readVectors('hcp-plan.json').rules).toEqual(hcpRules);
  });

  it('has a target API of six endpoints (one tournament since 1.19.0), apart from the launch monitor one', () => {
    expect(hcp.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(hcp.paths).sort()).toEqual(['/import', '/pair', '/plan', '/status', '/token', '/tournament']);
    expect(hcp.paths['/tournament'].post.requestBody.content['application/json'].schema.$ref).toBe('../hcp/dgvevent-1.schema.json');
    expect(hcp.security).toEqual([{ importToken: [] }]);
    expect(hcp.paths['/pair'].post.security).toEqual([]);
    expect(hcp.paths['/import'].post.requestBody.content['application/json'].schema.oneOf.map((x: { $ref: string }) => x.$ref))
      .toEqual(['../hcp/dgvhcp-1.schema.json', '../prores/prores-1.schema.json']);
    expect(hcp.components.schemas.Reason.enum).toEqual(hcpSchema.properties.sync.properties.reason.enum);
    expect(hcp.components.schemas.Limits.properties.max_results.maximum).toBe(hcpSchema.properties.results.maxItems);
    expect(hcpRules.max_results).toBe(hcpSchema.properties.results.maxItems);
  });

  it('has every reference resolve', () => {
    const refs: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === '$ref' && typeof x === 'string' ? refs.push(x) : walk(x));
    };
    walk(hcp);
    for (const ref of refs) {
      if (ref.startsWith('#/')) {
        let at: unknown = hcp;
        for (const part of ref.slice(2).split('/')) at = (at as Record<string, unknown> | undefined)?.[part];
        expect([ref, at !== undefined]).toEqual([ref, true]);
      } else expect([ref, existsSync(new URL(ref, `file://${SPEC_DIR}api/`))]).toEqual([ref, true]);
    }
  });

  it('keeps the error codes of the launch monitor API, one of its own for a pro’s page (1.15.0) and those of a tournament (1.19.0)', () => {
    const lm = parse(readFileSync(`${SPEC_DIR}api/target-api.yaml`, 'utf8'));
    expect(hcp.components.schemas.Error.properties.error.properties.code.enum).toEqual([
      ...lm.components.schemas.Error.properties.error.properties.code.enum,
      'other_player',
      'account_inactive',
      'wrong_token',
      'calendar_full',
      'invalid_event',
      'too_old',
      'too_far_ahead',
    ]);
  });
});

describe('one tournament from golf.de’s page, dgvevent/1 (1.19.0)', () => {
  type Example = { name: string; valid: boolean; body: unknown; target: { refused?: true; dropped?: string[] } };
  const checkEvent = makeAjv().compile(eventSchema);
  const examples = readVectors<Example>('dgvevent-examples.json').cases;

  it.each(examples.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect([c.name, checkEvent(c.body)]).toEqual([c.name, c.valid]);
    // What the schema takes, a target takes whole - but for what no schema can say (the page's number twice).
    if (c.valid && !c.target.refused) expect(c.target).toEqual({ dropped: [] });
  });

  it('takes every tournament the page rule writes', () => {
    type Page = { name: string; expected: { event?: unknown } };
    for (const c of readVectors<Page>('dgvevent-page.json').cases) {
      if (!c.expected.event) continue;
      const body = { format: 'dgvevent/1', provider: 'golfde', event: c.expected.event };
      expect([c.name, checkEvent(body), checkEvent.errors ?? null]).toEqual([c.name, true, null]);
    }
  });
});

describe('a professional’s pages (1.15.0)', () => {
  type Example = { name: string; valid: boolean; batch: unknown };
  type Rule = { rule: string; input: unknown; expected: unknown };
  const vectors = readVectors<Example>('prores-examples.json') as unknown as { cases: Example[]; rules: Rule[]; tour_codes: unknown };
  const checkPro = makeAjv().compile(proSchema);

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    expect([c.name, checkPro(c.batch)]).toEqual([c.name, c.valid]);
  });

  it.each(vectors.rules.map((r, i) => [`${r.rule} #${i}`, r] as const))('%s', (_, r) => {
    const i = r.input as { site: unknown; code: unknown };
    const got = r.rule === 'place_of' ? placeOf(r.input) : r.rule === 'tour_of' ? tourOf(i.site, i.code) : isoWeek(r.input);
    expect([r.input, got]).toEqual([r.input, r.expected]);
  });

  it('reads the tours of the spec, and wrote the vectors with them', () => {
    const { $comment: _, ...codes } = proTours;
    expect(TOUR_CODES).toEqual(codes);
    expect(vectors.tour_codes).toEqual(codes);
  });

  it('caps a batch as the schema does', () => {
    expect(proSchema.properties.tournaments.maxItems).toBe(PRORES_MAX.tournaments);
    expect(proSchema.properties.rankings.maxItems).toBe(PRORES_MAX.rankings);
    expect(proSchema.properties.stats.maxItems).toBe(PRORES_MAX.stats);
  });

  it('knows the ISO week of a day', () => {
    expect(weekOf('2026-11-22')).toBe('2026-W47');
    expect(weekOf('2026-11-23')).toBe('2026-W48');
    expect(weekOf('2027-01-01')).toBe('2026-W53');
    expect(weekOf('2021-01-03')).toBe('2020-W53');
    expect(weekOf('2024-12-30')).toBe('2025-W01');
    expect(weekOf('2026-02-30')).toBeNull();
    expect(weekOf('22.11.2026')).toBeNull();
  });
});
