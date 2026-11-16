// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { readPairing, readPlan } from './api.ts';
import { TargetError } from './errors.ts';
import { retryAfterS, type FetchLike } from './http.ts';
import { HttpTarget, pair } from './target.ts';
import { FakeTarget, response } from './testing/index.ts';

const CLIENT = { kind: 'extension' as const, name: 'Golf Launch Monitor Sync for Chrome', version: '0.1.0' };
const BATCH = {
  format: 'olmd/1' as const,
  provider: 'demo',
  account_ref: 'Xq3c0mB1v4Lr2kq9WzT8yA5nE6pH7sJ0dF1gK2lM3oN',
  generated_at: '2026-11-16T12:00:00Z',
  sessions: [{ external_id: 'S1', kind: 'range' as const, shots: [{ flight: { carry_m: 140 } }] }],
  rounds: [],
};

async function paired(fake = new FakeTarget()) {
  const p = await pair({ target: fake.base, code: 'K7M2PQ9X', provider: 'demo', client: CLIENT, fetch: fake.fetch });
  return { fake, pairing: p, target: new HttpTarget(p, { fetch: fake.fetch }) };
}

describe('pairing', () => {
  it('trades the code for a token, once', async () => {
    const { fake, pairing } = await paired();
    expect(pairing).toMatchObject({ base: fake.base, provider: 'demo', account_salt: fake.salt, target: { name: 'Example App' } });
    expect(pairing.token).toMatch(/^tok_/);
    const again = await pair({ target: fake.base, code: 'K7M2PQ9X', provider: 'demo', client: CLIENT, fetch: fake.fetch }).catch((e: unknown) => e);
    expect(again).toBeInstanceOf(TargetError);
    expect((again as TargetError).code).toBe('code_invalid');
  });

  it('keeps only return prefixes that cannot be stretched to another host', async () => {
    const { pairing } = await paired();
    expect(pairing.target.return_prefixes).toEqual(['exampleapp://', 'https://app.example.org/']);
  });

  it('talks only to a target address it accepts, and checks what it sends', async () => {
    const fake = new FakeTarget();
    for (const [target, code, provider] of [
      ['http://app.example.org/lm/v1', 'K7M2PQ9X', 'demo'],
      ['javascript:alert(1)', 'K7M2PQ9X', 'demo'],
      [fake.base, 'K7', 'demo'],
      [fake.base, 'K7M2PQ9X', 'Trackman'],
    ] as const) {
      await expect(pair({ target, code, provider, client: CLIENT, fetch: fake.fetch })).rejects.toBeInstanceOf(TargetError);
    }
    expect(fake.received).toEqual([]);
  });

  it('refuses an answer that is no pairing', async () => {
    const f: FetchLike = async () => response(200, { token: 'short', account_salt: 'x', target: {}, limits: {} });
    await expect(pair({ target: 'https://app.example.org/lm/v1', code: 'K7M2PQ9X', provider: 'demo', client: CLIENT, fetch: f }))
      .rejects.toMatchObject({ code: 'bad_answer' });
    const limits = { max_bytes: 1_000_000, max_sessions: 1, max_shots: 1, max_rounds: 1, max_round_shots: 1 };
    const answer = { token: 'x'.repeat(40), account_salt: 's'.repeat(16), target: { name: 'A' } };
    expect(readPairing({ ...answer, limits }, 'b', 'demo', 0)).not.toBeNull();
    expect(readPairing({ ...answer, limits: { ...limits, max_round_shots: 0 } }, 'b', 'demo', 0)).toBeNull();
    // A target that takes less than a session: the client would fetch for nothing.
    expect(readPairing({ ...answer, limits: { ...limits, max_bytes: 1000 } }, 'b', 'demo', 0)).toBeNull();
  });
});

describe('the target API with an import token', () => {
  it('asks the plan with provider, reason and client, carrying the token and no cookies', async () => {
    const { fake, target } = await paired();
    const plan = await target.plan('demo', 'timer', 'extension');
    expect(plan.due).toBe(true);
    const req = fake.received.at(-1);
    expect(req?.url).toBe(`${fake.base}/plan?provider=demo&reason=timer&client=extension`);
    expect(req?.headers.Authorization).toMatch(/^Bearer tok_/);
    expect(Object.keys(req?.headers ?? {})).not.toContain('User-Agent');
  });

  it('imports, lists what it has, says its status and disconnects itself', async () => {
    const { fake, target } = await paired();
    expect(await target.import(BATCH)).toEqual({ sessions: 1, shots: 1, rounds: 0, round_shots: 0, duplicates: 0 });
    expect(await target.import(BATCH)).toEqual({ sessions: 0, shots: 0, rounds: 0, round_shots: 0, duplicates: 1 });
    expect(await target.known('demo', '2026-01-01T00:00:00Z')).toEqual(['S1']);
    expect(await target.status()).toMatchObject({ target: { name: 'Example App' }, connected: true });
    await target.revoke();
    await target.revoke(); // already gone: fine
    await expect(target.plan('demo', 'timer', 'extension')).rejects.toMatchObject({ code: 'token_invalid' });
    expect(fake.tokens.size).toBe(0);
  });

  it.each([
    [401, {}, 'token_invalid'],
    [409, { error: { code: 'other_account' } }, 'other_account'],
    [409, { error: { code: 'disconnected' } }, 'disconnected'],
    [413, {}, 'too_large'],
    [422, { error: { code: 'invalid_batch', message: 'no' } }, 'invalid_batch'],
    [503, '<html>maintenance</html>', 'unavailable'],
    [418, { error: { code: 'made_up' } }, 'bad_request'],
  ] as const)('reads HTTP %i as %s', async (status, body, code) => {
    const fake = new FakeTarget({ fail: { '/import': { status, body } } });
    const { target } = await paired(fake);
    await expect(target.import(BATCH)).rejects.toMatchObject({ code, status });
  });

  it('passes on how long a target asks to wait', async () => {
    const fake = new FakeTarget({ fail: { '/plan': { status: 429, body: { error: { code: 'rate_limited' } }, headers: { 'Retry-After': '12' } } } });
    const { target } = await paired(fake);
    await expect(target.plan('demo', 'timer', 'web')).rejects.toMatchObject({ code: 'rate_limited', retryAfterS: 12 });
  });

  it('says so when the target cannot be reached, or does not answer in time', async () => {
    const { pairing } = await paired();
    const offline = new HttpTarget(pairing, { fetch: async () => { throw new TypeError('Failed to fetch'); } });
    await expect(offline.plan('demo', 'timer', 'web')).rejects.toMatchObject({ code: 'unreachable' });
    const garbage = new HttpTarget(pairing, { fetch: async () => response(200, 'not json') });
    await expect(garbage.plan('demo', 'timer', 'web')).rejects.toMatchObject({ code: 'bad_answer' });
  });
});

describe('a plan, read from an untrusted target', () => {
  it('is not due when it is no plan', () => {
    for (const junk of [null, 'due', [], { due: 'yes' }, { due: 1 }]) expect(readPlan(junk).due).toBe(false);
  });

  it('can only make a client do less', () => {
    const p = readPlan({
      due: true, busy: true, pace: 0.01, max_sessions: -3, known_ids: ['A', 7, '', 'x'.repeat(500)], give_up: 'all',
      rounds: 'yes', round_shots: 1, since: '2026-02-30T00:00:00Z', plan_id: '', account_ref: 'short',
      rounds_wanted: [{ external_id: 'R1', newer: 3, played_at: 'soon' }, { external_id: 5 }, null],
    });
    expect(p).toEqual({
      due: false, busy: true, known_ids: ['A', 'x'.repeat(400)], give_up: [], rounds: false, round_shots: false,
      rounds_wanted: [{ external_id: 'R1', newer: 3 }], pace: 0.5,
    });
    expect(readPlan({ due: true, disconnected: true }).due).toBe(false);
    expect(readPlan({ due: true, pace: Number.POSITIVE_INFINITY }).pace).toBe(1);
  });
});

describe('Retry-After', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    expect(retryAfterS('120', now)).toBe(120);
    expect(retryAfterS('Mon, 16 Nov 2026 12:01:00 GMT', now)).toBe(60);
    expect(retryAfterS('soon', now)).toBeNull();
    expect(retryAfterS(null, now)).toBeNull();
  });
});
