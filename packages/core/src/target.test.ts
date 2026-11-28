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

  it('names what the client can beyond earlier versions (spec 1.20.0), only the spec’s words, in its order', async () => {
    const { fake, target } = await paired();
    await target.plan('demo', 'backfill', 'companion', 'ready', ['sessions_again', 'older_rounds']);
    expect(fake.received.at(-1)?.url).toBe(`${fake.base}/plan?provider=demo&reason=backfill&client=companion&signin=ready&can=older_rounds%2Csessions_again`);
    await target.plan('demo', 'timer', 'companion', undefined, []);
    expect(fake.received.at(-1)?.url).toBe(`${fake.base}/plan?provider=demo&reason=timer&client=companion`);
  });

  it('names the client’s version with the plan (spec 1.22.0), only one that looks like a version', async () => {
    const { fake, target } = await paired();
    await target.plan('demo', 'timer', 'companion', 'ready', [], '0.16.2');
    expect(fake.received.at(-1)?.url).toBe(`${fake.base}/plan?provider=demo&reason=timer&client=companion&signin=ready&version=0.16.2`);
    expect(fake.asked.at(-1)?.version).toBe('0.16.2');
    for (const junk of ['', 'x'.repeat(51), '1.0 beta', 'eyJ.a/b']) {
      await target.plan('demo', 'timer', 'companion', undefined, undefined, junk);
      expect(fake.received.at(-1)?.url).toBe(`${fake.base}/plan?provider=demo&reason=timer&client=companion`);
    }
  });

  it('imports, lists what it has, says its status and disconnects itself', async () => {
    const { fake, target } = await paired();
    expect(await target.import(BATCH)).toEqual({ sessions: 1, shots: 1, rounds: 0, round_shots: 0, duplicates: 0 });
    expect(await target.import(BATCH)).toEqual({ sessions: 0, shots: 0, rounds: 0, round_shots: 0, duplicates: 1 });
    expect(await target.known('demo', '2026-01-01T00:00:00Z')).toEqual(['S1']);
    expect(await target.status()).toMatchObject({ target: { name: 'Example App' }, connected: true });
    expect(fake.received.at(-1)?.url).toBe(`${fake.base}/status`);
    // 1.5.0: the client's sign-in, without a plan (no lease).
    expect(await target.status('confirm')).toMatchObject({ connected: true });
    expect(fake.received.at(-1)?.url).toBe(`${fake.base}/status?signin=confirm`);
    expect(fake.signins).toEqual([{ via: 'status', signin: 'confirm' }]);
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

describe('the wake (1.9.0)', () => {
  const ADDRESS = 'ExponentPushToken[a1B2c3D4e5F6g7H8i9J0kL]';

  it('registers the address with the token, and forgets it again', async () => {
    const { fake, target, pairing } = await paired();
    expect(await target.wake({ service: 'expo', address: ADDRESS })).toBe(true);
    expect(fake.wakes.get(pairing.token)).toEqual({ service: 'expo', address: ADDRESS });
    await target.unwake();
    expect(fake.wakes.size).toBe(0);
    await target.unwake(); // nothing left: fine
  });

  it('sends nothing that is no wake address', async () => {
    const { fake, target } = await paired();
    const before = fake.received.length;
    for (const bad of [{ service: 'expo', address: 'https://push.example.org/x' }, { service: 'fcm', address: ADDRESS }]) {
      await expect(target.wake(bad as never)).rejects.toMatchObject({ code: 'bad_request' });
    }
    expect(fake.received.length).toBe(before);
  });

  it('hears a target without a wake as one, and says any other trouble', async () => {
    const { target } = await paired(new FakeTarget({ wake: false }));
    expect(await target.wake({ service: 'expo', address: ADDRESS })).toBe(false);
    await target.unwake();
    const gone = await paired(new FakeTarget());
    gone.fake.disconnected = true;
    await expect(gone.target.wake({ service: 'expo', address: ADDRESS })).rejects.toMatchObject({ code: 'disconnected' });
    const busy = await paired(new FakeTarget({ fail: { '/wake': { status: 503 } } }));
    await expect(busy.target.wake({ service: 'expo', address: ADDRESS })).rejects.toMatchObject({ code: 'unavailable' });
    await expect(busy.target.unwake()).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('forgets the address with the token', async () => {
    const { fake, target } = await paired();
    await target.wake({ service: 'expo', address: ADDRESS });
    await target.revoke();
    expect(fake.wakes.size).toBe(0);
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
      rounds_wanted: [{ external_id: 'R1', newer: 3 }], sessions_wanted: [], pace: 0.5,
    });
    expect(readPlan({ due: true, disconnected: true }).due).toBe(false);
    expect(readPlan({ due: true, pace: Number.POSITIVE_INFINITY }).pace).toBe(1);
  });

  it('reads only signing in (spec 1.27.0): never due then, and nothing else read as it', () => {
    expect(readPlan({ due: true, mode: 'signin_only' })).toMatchObject({ due: false, mode: 'signin_only' });
    expect(readPlan({ due: true, mode: 'fetch' })).toMatchObject({ due: true, mode: 'fetch' });
    for (const junk of ['SIGNIN_ONLY', 'signin', true, 1, null, ['signin_only']]) {
      const p = readPlan({ due: true, mode: junk });
      expect(p.due).toBe(true);
      expect(p.mode).toBeUndefined();
    }
    expect(readPlan({ due: true, busy: true, holder: { kind: 'embedded', since: '2026-11-28T09:00:00Z' } }).holder).toEqual({ kind: 'embedded', since: '2026-11-28T09:00:00Z' });
  });

  it('reads where the older scorecards start and the sessions wanted again (spec 1.20.0), nothing it can’t read', () => {
    const p = readPlan({
      due: true, rounds: true, rounds_skip: 2,
      sessions_wanted: [{ external_id: 'T1', started_at: '2026-02-05T10:00:00Z' }, { external_id: 'C1', started_at: 'soon' }, { external_id: 7 }, 'T2', null],
    });
    expect(p.rounds_skip).toBe(2);
    expect(p.sessions_wanted).toEqual([{ external_id: 'T1', started_at: '2026-02-05T10:00:00Z' }, { external_id: 'C1' }]);
    for (const junk of [-1, 1.5, '2', null]) expect(readPlan({ due: true, rounds_skip: junk }).rounds_skip).toBeUndefined();
    expect(readPlan({ due: true, sessions_wanted: 'all' }).sessions_wanted).toEqual([]);
  });

  it('reads whether anything older than what the target has still comes (spec 1.21.0), only as a boolean', () => {
    expect(readPlan({ due: true, history: { done: false, older: false } }).history).toEqual({ done: false, older: false });
    for (const junk of ['no', 0, null, {}]) expect(readPlan({ due: true, history: { done: false, older: junk } }).history).toEqual({ done: false });
  });

  it('hears that the target needs a newer client (spec 1.22.0): never due then, only as a boolean', () => {
    expect(readPlan({ due: true, outdated: true })).toMatchObject({ due: false, outdated: true });
    for (const junk of ['yes', 1, null, {}]) expect(readPlan({ due: true, outdated: junk })).not.toHaveProperty('outdated');
  });

  it("names who holds the lease when it is busy (spec 1.13.0), and nothing it can't read", () => {
    expect(readPlan({ due: false, busy: true, holder: { kind: 'extension', since: '2026-11-25T10:17:00Z' } }).holder).toEqual({
      kind: 'extension',
      since: '2026-11-25T10:17:00Z',
    });
    expect(readPlan({ busy: true, holder: { kind: 'companion' } }).holder).toEqual({ kind: 'companion' });
    // A kind the spec doesn't know is "other"; a holder without busy, or one that is no object, is none.
    expect(readPlan({ busy: true, holder: { kind: '<b>me</b>', since: 'later' } }).holder).toEqual({ kind: 'other' });
    expect(readPlan({ due: true, holder: { kind: 'web' } }).holder).toBeUndefined();
    expect(readPlan({ busy: true, holder: 'the extension' }).holder).toBeUndefined();
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

describe('a test scenario (1.8.0)', () => {
  const SCENARIO = {
    name: 'Steady (test T1)',
    provider: 'trackman',
    subject: 'test-subject-0001',
    profile: { fullName: 'Made Up' },
    data: { activities: [] },
    latency: { default: { median_s: 1, spread_s: 0.2 } },
    valid_until: '2026-11-28T18:00:00Z',
  };
  const now = () => Date.parse('2026-11-21T18:00:00Z');

  async function testTarget(opts: ConstructorParameters<typeof FakeTarget>[0] = {}) {
    const fake = new FakeTarget(opts);
    const p = await pair({ target: fake.base, code: 'K7M2PQ9X', provider: 'trackman', client: CLIENT, fetch: fake.fetch });
    return { fake, target: new HttpTarget(p, { fetch: fake.fetch, now }) };
  }

  it('comes with the code in its header, never in the address', async () => {
    const { fake, target } = await testTarget();
    fake.testAccount = true;
    fake.scenarios.set('TESTCODE1', SCENARIO);
    const s = await target.testScenario('TESTCODE1');
    expect(s).toMatchObject({ name: SCENARIO.name, subject: SCENARIO.subject, provider: 'trackman', latency: { default: { median_s: 1, spread_s: 0.2 }, queries: {} } });
    const asked = fake.received.at(-1);
    expect(asked?.url).toBe(`${fake.base}/test-scenario`);
    expect(asked?.headers['X-Test-Code']).toBe('TESTCODE1');
    expect(fake.received.some((r) => r.url.includes('TESTCODE1'))).toBe(false);
  });

  it('says what went wrong, by its own codes', async () => {
    const { fake, target } = await testTarget();
    await expect(target.testScenario('TESTCODE1')).rejects.toMatchObject({ code: 'not_test_account', status: 403 });
    fake.testAccount = true;
    await expect(target.testScenario('NOSUCHCODE')).rejects.toMatchObject({ code: 'code_invalid' });
    fake.expiredCodes.add('OLDCODE1');
    await expect(target.testScenario('OLDCODE1')).rejects.toMatchObject({ code: 'code_expired', status: 410 });
    // Not a code: nothing is asked at all.
    const before = fake.received.length;
    await expect(target.testScenario('a b')).rejects.toMatchObject({ code: 'bad_request' });
    expect(fake.received.length).toBe(before);
  });

  it('a target without scenarios: any 404 that is no wrong code, and a path it does not know', async () => {
    const { target } = await testTarget({ tests: false });
    await expect(target.testScenario('TESTCODE1')).rejects.toMatchObject({ code: 'test_unavailable' });
    for (const status of [404, 405, 501]) {
      const f: FetchLike = async (url) => (url.endsWith('/pair') ? response(200, { token: 'x'.repeat(40), account_salt: 's'.repeat(16), target: { name: 'A' }, limits: { max_bytes: 1_000_000, max_sessions: 1, max_shots: 1, max_rounds: 1, max_round_shots: 1 } }) : response(status, 'Not Found'));
      const p = await pair({ target: 'https://app.example.org/lm/v1', code: 'K7M2PQ9X', provider: 'trackman', client: CLIENT, fetch: f });
      await expect(new HttpTarget(p, { fetch: f, now }).testScenario('TESTCODE1')).rejects.toMatchObject({ code: 'test_unavailable', status });
    }
  });

  it('refuses a scenario past its end, or none at all, and passes on a revoked token', async () => {
    const { fake, target } = await testTarget();
    fake.testAccount = true;
    fake.scenarios.set('PASTCODE1', { ...SCENARIO, valid_until: '2026-11-20T18:00:00Z' });
    fake.scenarios.set('JUNKCODE1', { ...SCENARIO, subject: 'with space' });
    await expect(target.testScenario('PASTCODE1')).rejects.toMatchObject({ code: 'code_expired' });
    await expect(target.testScenario('JUNKCODE1')).rejects.toMatchObject({ code: 'bad_answer' });
    fake.tokens.clear();
    await expect(target.testScenario('PASTCODE1')).rejects.toMatchObject({ code: 'token_invalid' });
  });

  it('a batch with test for an account that is no test account: test_data, nothing stored', async () => {
    const { fake, target } = await testTarget();
    await expect(target.import({ ...BATCH, provider: 'trackman', test: true })).rejects.toMatchObject({ code: 'test_data', status: 403 });
    expect(fake.sessions.size).toBe(0);
    fake.testAccount = true;
    await expect(target.import({ ...BATCH, provider: 'trackman', test: true })).resolves.toMatchObject({ sessions: 1 });
  });
});
