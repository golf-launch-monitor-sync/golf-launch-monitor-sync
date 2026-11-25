// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { validateBatch, type Session } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import type { Plan } from './api.ts';
import { Cancelled, ProviderAuthError, stopsTheFetch, noticeFor } from './errors.ts';
import { FileTarget, type FileOut } from './file.ts';
import { Guard, guardAccount, LIMITS } from './guard.ts';
import type { Fetched, Provider, ProviderContext } from './provider.ts';
import { accountRefOf } from './sha256.ts';
import { MemoryStorage } from './storage.ts';
import { sync } from './sync.ts';
import { HttpTarget, pair, type Target } from './target.ts';
import { FakeTarget, VirtualClock } from './testing/index.ts';

const session = (id: string): Session => ({ external_id: id, kind: 'range', started_at: '2026-11-15T10:00:00Z', shots: [{ flight: { carry_m: 150 } }] });

/** A provider that asks one guarded request per session it has and doesn't know yet. */
class Fake implements Provider<{ sub: string }> {
  readonly id = 'demo';
  readonly name = 'Fake';
  asked = 0;
  plans: Plan[] = [];
  constructor(
    public have: string[] = ['S1', 'S2', 'S3'],
    public fail: (n: number) => Error | null = () => null,
  ) {}
  subject(c: { sub: string }) {
    return c.sub || null;
  }
  async fetch(plan: Plan, _c: { sub: string }, ctx: ProviderContext): Promise<Fetched> {
    this.plans.push(plan);
    const out: Fetched = { sessions: [], rounds: [], failed: [] };
    try {
      await ctx.guarded('list', async () => ({ status: 200, value: (this.asked += 1) }));
      for (const id of this.have.filter((x) => !plan.known_ids.includes(x)).slice(0, plan.max_sessions ?? 40)) {
        const err = this.fail(this.asked);
        await ctx.guarded('session', async () => {
          this.asked += 1;
          if (err) throw err;
          return { status: 200, value: null };
        });
        out.sessions.push(session(id));
      }
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      if (stopsTheFetch(e)) return { ...out, notice: noticeFor(e, ctx.now()), progress: { more_available: true } };
      throw e;
    }
    return out;
  }
}

async function setup(fakeOpts: ConstructorParameters<typeof FakeTarget>[0] = {}) {
  const fake = new FakeTarget(fakeOpts);
  const clock = new VirtualClock();
  const pairing = await pair({ target: fake.base, code: 'K7M2PQ9X', provider: 'demo', client: { kind: 'web', name: 'Test' }, fetch: fake.fetch });
  const target = new HttpTarget(pairing, { fetch: fake.fetch, now: clock.now });
  const storage = new MemoryStorage();
  const guard = new Guard({ storage, now: clock.now, sleep: clock.sleep, random: () => 0 });
  return { fake, clock, target, guard, storage };
}

const SUB = { sub: 'sub-1' };

describe('a sync', () => {
  it('says how many sessions of the history are still to come, for a history chunk only (the wizard shows it)', async () => {
    class Left extends Fake {
      override async fetch(plan: Plan, c: { sub: string }, ctx: ProviderContext): Promise<Fetched> {
        const out = await super.fetch(plan, c, ctx);
        return { ...out, progress: { more_available: true, sessions_left: 140 } };
      }
    }
    const { target, guard } = await setup();
    const chunk = await sync({ target, provider: new Left(), credential: SUB, reason: 'backfill', client: 'web', guard });
    expect(chunk).toMatchObject({ status: 'synced', more: true, left: 140 });
    // A regular sync's `sessions_left` counts only its window: no promise about the history.
    const regular = await sync({ target, provider: new Left(), credential: SUB, reason: 'manual', client: 'web', guard });
    expect(regular.status).toBe('synced');
    expect('left' in regular).toBe(false);
  });

  it('asks the plan first, and the provider nothing when it is not due', async () => {
    const { fake, target, guard } = await setup({ plan: () => ({ due: false }) });
    const provider = new Fake();
    expect(await sync({ target, provider, credential: SUB, reason: 'timer', client: 'web', guard })).toMatchObject({ status: 'not_due' });
    expect(provider.asked).toBe(0);
    expect(fake.asked).toEqual([{ provider: 'demo', reason: 'timer', client: 'web', signin: null }]);
  });

  it('tells the target the client’s sign-in with the plan (1.5.0)', async () => {
    const { fake, target, guard } = await setup({ plan: () => ({ due: false }) });
    await sync({ target, provider: new Fake(), credential: SUB, reason: 'timer', client: 'web', signin: 'ready', guard });
    expect(fake.asked).toEqual([{ provider: 'demo', reason: 'timer', client: 'web', signin: 'ready' }]);
    expect(fake.received.at(-1)?.url).toBe(`${fake.base}/plan?provider=demo&reason=timer&client=web&signin=ready`);
  });

  it.each([
    [{ due: true, busy: true }, 'busy'],
    [{ due: true, disconnected: true }, 'disconnected'],
  ])('asks the provider nothing when the plan says %j', async (plan, status) => {
    const { target, guard } = await setup({ plan: () => plan });
    const provider = new Fake();
    expect(await sync({ target, provider, credential: SUB, reason: 'manual', client: 'web', guard })).toMatchObject({ status });
    expect(provider.asked).toBe(0);
  });

  it('refuses another provider account before asking the provider anything', async () => {
    const { fake, target, guard } = await setup();
    fake.accountRef = accountRefOf(fake.salt, 'demo', 'someone-else');
    const provider = new Fake();
    expect(await sync({ target, provider, credential: SUB, reason: 'timer', client: 'web', guard })).toEqual({ status: 'other_account' });
    expect(provider.asked).toBe(0);
  });

  it('fetches what the target lacks and hands it over with the plan id, under the account reference', async () => {
    const { fake, target, guard } = await setup();
    const provider = new Fake();
    const first = await sync({ target, provider, credential: SUB, reason: 'connect', client: 'web', guard, generator: { name: 'test', version: '1' } });
    expect(first).toMatchObject({ status: 'synced', result: { sessions: 3, shots: 3 }, parts: 1, more: false, dropped: 0 });
    const batch = fake.imports[0];
    expect(batch).toMatchObject({ provider: 'demo', account_ref: accountRefOf(fake.salt, 'demo', 'sub-1'), sync: { reason: 'connect', plan_id: expect.stringMatching(/^pl_/) }, generator: { name: 'test' } });
    expect(validateBatch(batch).ok).toBe(true);
    expect(provider.asked).toBe(4);
    // The next one knows them: one request, nothing new.
    const second = await sync({ target, provider, credential: SUB, reason: 'timer', client: 'web', guard });
    expect(second).toMatchObject({ status: 'synced', result: { sessions: 0 } });
    expect(provider.asked).toBe(5);
  });

  it('never sends the provider sign-in to the target', async () => {
    const { fake, target, guard } = await setup();
    await sync({ target, provider: new Fake(), credential: { sub: 'sub-SECRET-token' }, reason: 'manual', client: 'web', guard });
    expect(JSON.stringify(fake.received)).not.toContain('SECRET');
  });

  it('tells the target why a fetch stopped, with what it had, and releases the lease', async () => {
    const { fake, target, guard } = await setup();
    const provider = new Fake(['S1', 'S2', 'S3'], (n) => (n === 3 ? new ProviderAuthError('expired') : null));
    const out = await sync({ target, provider, credential: SUB, reason: 'timer', client: 'web', guard });
    expect(out).toMatchObject({ status: 'synced', notice: { code: 'auth_expired' }, more: true, result: { sessions: 2 } });
    expect(fake.imports.at(-1)).toMatchObject({ notice: { code: 'auth_expired' }, sync: { plan_id: expect.any(String) } });
  });

  it('says so when the guard holds, without asking the provider', async () => {
    const { fake, target, guard, clock } = await setup();
    const account = guardAccount('demo', 'sub-1');
    await guard.beginRun(account);
    for (let i = 0; i < LIMITS.per_run; i++) await guard.request(account, 'x', async () => ({ status: 200, value: null }));
    for (let i = 0; i < 20; i++) {
      await guard.beginRun(account);
      await guard.request(account, 'x', async () => ({ status: 200, value: null }));
    }
    clock.advance(1000);
    const provider = new Fake();
    const out = await sync({ target, provider, credential: SUB, reason: 'manual', client: 'web', guard, now: clock.now });
    expect(out).toMatchObject({ status: 'synced', notice: { code: 'guard_limit', until: expect.any(String) }, result: { sessions: 0 } });
    expect(provider.asked).toBe(0);
    expect(fake.imports.at(-1)?.sessions).toEqual([]);
  });

  it('cuts what it fetched to the target’s limits', async () => {
    const { fake, target, guard } = await setup({ limits: { max_bytes: 1_000_000, max_sessions: 2, max_shots: 100, max_rounds: 5, max_round_shots: 100 } });
    const out = await sync({ target, provider: new Fake(['A', 'B', 'C', 'D', 'E']), credential: SUB, reason: 'manual', client: 'web', guard });
    expect(out).toMatchObject({ status: 'synced', parts: 3, result: { sessions: 5 } });
    expect(fake.imports.map((b) => b.sync?.plan_id !== undefined)).toEqual([false, false, true]);
  });

  it('marks every part with test when the provider plays a test scenario back, and only then (1.8.0)', async () => {
    const { fake, target, guard } = await setup({ limits: { max_bytes: 1_000_000, max_sessions: 2, max_shots: 100, max_rounds: 5, max_round_shots: 100 } });
    fake.testAccount = true;
    const playback = Object.assign(new Fake(['A', 'B', 'C', 'D', 'E']), { test: true });
    expect(await sync({ target, provider: playback, credential: SUB, reason: 'manual', client: 'web', guard })).toMatchObject({ status: 'synced', parts: 3 });
    expect(fake.imports.map((b) => b.test)).toEqual([true, true, true]);
    await sync({ target, provider: new Fake(['F']), credential: SUB, reason: 'manual', client: 'web', guard });
    expect(fake.imports.at(-1)).not.toHaveProperty('test');
  });

  it('a test batch for an account that is no test account ends with test_data, stored nowhere', async () => {
    const { fake, target, guard } = await setup();
    const out = await sync({ target, provider: Object.assign(new Fake(), { test: true }), credential: SUB, reason: 'manual', client: 'web', guard });
    expect(out).toMatchObject({ status: 'failed', error: { code: 'test_data' } });
    expect(fake.sessions.size).toBe(0);
  });

  it.each([
    [{ '/plan': { status: 401 } }, 'token_invalid'],
    [{ '/plan': { status: 503 } }, 'unavailable'],
    [{ '/import': { status: 422, body: { error: { code: 'invalid_batch' } } } }, 'invalid_batch'],
  ])('ends with the target’s trouble rather than throwing (%j)', async (fail, code) => {
    const { target, guard } = await setup({ fail });
    const out = await sync({ target, provider: new Fake(), credential: SUB, reason: 'manual', client: 'web', guard });
    expect(out).toMatchObject({ status: 'failed', error: { code } });
  });

  it('reads the target’s other_account and disconnected on import as what they are', async () => {
    for (const code of ['other_account', 'disconnected'] as const) {
      const { target, guard } = await setup({ fail: { '/import': { status: 409, body: { error: { code } } } } });
      expect(await sync({ target, provider: new Fake(), credential: SUB, reason: 'manual', client: 'web', guard })).toEqual({ status: code });
    }
  });

  it('waits a short Retry-After of the target once', async () => {
    const { fake, target, guard, clock } = await setup();
    let n = 0;
    const inner = fake.fetch;
    const flaky = new HttpTarget(target.pairing, {
      fetch: async (url, init) => {
        if (url.endsWith('/import') && n++ === 0) return { status: 429, headers: { get: (h) => (h === 'Retry-After' ? '5' : null) }, text: async () => '{}' };
        return inner(url, init);
      },
    });
    const t = clock.t;
    const out = await sync({ target: flaky, provider: new Fake(), credential: SUB, reason: 'manual', client: 'web', guard, sleep: clock.sleep });
    expect(out).toMatchObject({ status: 'synced', result: { sessions: 3 } });
    expect(clock.t - t).toBeGreaterThanOrEqual(5000);
  });

  it('stops when told to', async () => {
    const { target, guard } = await setup();
    const stop = new AbortController();
    stop.abort();
    expect(await sync({ target, provider: new Fake(), credential: SUB, reason: 'manual', client: 'web', guard, signal: stop.signal })).toEqual({ status: 'cancelled' });
  });
});

describe('the first sync after connecting hands over while it fetches (LMS-AS-6)', () => {
  const ten = Array.from({ length: 10 }, (_, i) => `S${i + 1}`);

  /** A provider that tells the sync each session as it has it (`ctx.got`), and notes how many parts the target had by then. */
  class Telling extends Fake {
    seen: number[] = [];
    constructor(have: string[], public target: FakeTarget, fail?: (n: number) => Error | null) {
      super(have, fail);
    }
    override async fetch(plan: Plan, _c: { sub: string }, ctx: ProviderContext): Promise<Fetched> {
      this.plans.push(plan);
      const out: Fetched = { sessions: [], rounds: [], failed: [] };
      await ctx.guarded('list', async () => ({ status: 200, value: (this.asked += 1) }));
      for (const id of this.have.filter((x) => !plan.known_ids.includes(x))) {
        await ctx.guarded('session', async () => ({ status: 200, value: (this.asked += 1) }));
        const s = session(id);
        out.sessions.push(s);
        this.seen.push(this.target.imports.length);
        ctx.got?.({ sessions: [s] });
      }
      return { ...out, rounds: [{ external_id: 'R1' }], progress: { more_available: false, oldest_seen: '2026-11-01T10:00:00Z' } };
    }
  }

  it('hands its sessions over in parts as they come, only the last with sync, failed, progress and notice', async () => {
    const { fake, target, guard, clock } = await setup();
    const provider = new Telling(ten, fake);
    const out = await sync({ target, provider, credential: SUB, reason: 'connect', client: 'web', guard, now: clock.now, sleep: clock.sleep });
    expect(out).toMatchObject({ status: 'synced', result: { sessions: 10, rounds: 1 }, more: false, dropped: 0 });
    expect(fake.imports.length).toBeGreaterThan(2);
    if (out.status === 'synced') expect(out.parts).toBe(fake.imports.length);
    // Before the provider had its last session, the target already had parts to count.
    expect(provider.seen.at(-1)).toBeGreaterThan(0);
    const last = fake.imports.at(-1);
    expect(last).toMatchObject({ sync: { reason: 'connect', plan_id: expect.stringMatching(/^pl_/) }, progress: { more_available: false }, rounds: [{ external_id: 'R1' }] });
    for (const b of fake.imports.slice(0, -1)) {
      expect(b.sync).toBeUndefined();
      expect(b.progress).toBeUndefined();
      expect(b.failed).toBeUndefined();
      expect(b.notice).toBeUndefined();
      expect(b.rounds).toEqual([]);
      expect(b.sessions.length).toBeGreaterThan(0);
      expect(b.sessions.length).toBeLessThanOrEqual(2);
      expect(validateBatch(b).ok).toBe(true);
    }
    // Every session once, in the order fetched.
    expect(fake.imports.flatMap((b) => b.sessions.map((s) => s.external_id))).toEqual(ten);
  });

  it('only after connecting, and only to a target that takes parts: other reasons and a file as before', async () => {
    for (const reason of ['timer', 'manual', 'open', 'backfill'] as const) {
      const { fake, target, guard, clock } = await setup();
      await sync({ target, provider: new Telling(ten, fake), credential: SUB, reason, client: 'web', guard, now: clock.now, sleep: clock.sleep });
      expect(fake.imports).toHaveLength(1);
    }
    // A target that doesn't take parts while the sync fetches (a file wants one per sync; it isn't due on connect anyway).
    const { fake, target, guard, clock } = await setup();
    const plain: Target = { name: target.name, salt: target.salt, limits: target.limits, plan: (...a) => target.plan(...a), import: (b) => target.import(b) };
    await sync({ target: plain, provider: new Telling(ten, fake), credential: SUB, reason: 'connect', client: 'web', guard, now: clock.now, sleep: clock.sleep });
    expect(fake.imports).toHaveLength(1);
  });

  it('a part the target can’t take now goes with the last one; the rest goes on (one part, the end)', async () => {
    const { fake, target, guard, clock } = await setup();
    let n = 0;
    const flaky = new HttpTarget(target.pairing, {
      now: clock.now,
      fetch: async (url, init) => {
        if (url.endsWith('/import') && n++ === 0) return { status: 503, headers: { get: () => null }, text: async () => '{}' };
        return fake.fetch(url, init);
      },
    });
    const out = await sync({ target: flaky, provider: new Telling(ten, fake), credential: SUB, reason: 'connect', client: 'web', guard, now: clock.now, sleep: clock.sleep });
    expect(out).toMatchObject({ status: 'synced', result: { sessions: 10 } });
    expect(fake.imports).toHaveLength(1);
    expect(fake.imports[0]?.sessions.map((s) => s.external_id)).toEqual(ten);
    expect(fake.imports[0]?.sync).toBeDefined();
  });

  it('a short Retry-After of a part is waited out once, as for any part', async () => {
    const { fake, target, guard, clock } = await setup();
    let n = 0;
    const flaky = new HttpTarget(target.pairing, {
      now: clock.now,
      fetch: async (url, init) => {
        if (url.endsWith('/import') && n++ === 0) return { status: 429, headers: { get: (h) => (h === 'Retry-After' ? '5' : null) }, text: async () => '{}' };
        return fake.fetch(url, init);
      },
    });
    const out = await sync({ target: flaky, provider: new Telling(ten, fake), credential: SUB, reason: 'connect', client: 'web', guard, now: clock.now, sleep: clock.sleep });
    expect(out).toMatchObject({ status: 'synced', result: { sessions: 10 } });
    expect(fake.imports.length).toBeGreaterThan(2);
  });

  it('the player disconnected meanwhile: the fetch stops at once, nothing more is asked of the provider', async () => {
    const { fake, target, guard, clock } = await setup();
    const provider = new Telling(ten, fake);
    const inner = fake.fetch;
    const cut = new HttpTarget(target.pairing, {
      now: clock.now,
      fetch: async (url, init) => {
        if (url.endsWith('/import')) fake.disconnected = true;
        return inner(url, init);
      },
    });
    const out = await sync({ target: cut, provider, credential: SUB, reason: 'connect', client: 'web', guard, now: clock.now, sleep: clock.sleep });
    expect(out).toEqual({ status: 'disconnected' });
    expect(provider.asked).toBeLessThan(1 + ten.length);
  });

  it('stopped by the player midway: what was handed over stays, and the sync says cancelled', async () => {
    const { fake, target, guard, clock } = await setup();
    const stop = new AbortController();
    const provider = new Telling(ten, fake);
    const inner = fake.fetch;
    const watching = new HttpTarget(target.pairing, {
      now: clock.now,
      fetch: async (url, init) => {
        const r = await inner(url, init);
        if (url.endsWith('/import')) stop.abort();
        return r;
      },
    });
    const out = await sync({ target: watching, provider, credential: SUB, reason: 'connect', client: 'web', guard, now: clock.now, sleep: clock.sleep, signal: stop.signal });
    expect(out).toEqual({ status: 'cancelled' });
    expect(fake.imports.length).toBeGreaterThan(0);
    expect(fake.imports.every((b) => b.sync === undefined)).toBe(true);
    expect(fake.sessions.size).toBeGreaterThan(0);
  });
});

describe('a sync into a file', () => {
  async function fileSetup() {
    const storage = new MemoryStorage();
    const clock = new VirtualClock();
    const files: FileOut[] = [];
    const open = () => FileTarget.open({ storage, provider: 'demo', write: async (f) => void files.push(f), now: clock.now, randomBytes: (n) => new Uint8Array(n).fill(7) });
    const guard = new Guard({ storage, now: clock.now, sleep: clock.sleep, random: () => 0 });
    return { storage, clock, files, open, guard };
  }

  it('is written only when the player asks, and the next file brings only what is new', async () => {
    const { files, open, guard, clock } = await fileSetup();
    const target = await open();
    const provider = new Fake(['S1', 'S2']);
    expect(await sync({ target, provider, credential: SUB, reason: 'timer', client: 'web', guard })).toMatchObject({ status: 'not_due' });
    expect(provider.asked).toBe(0);
    expect(await sync({ target, provider, credential: SUB, reason: 'manual', client: 'web', guard })).toMatchObject({ status: 'synced', result: { sessions: 2 } });
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toMatch(/^olmd-demo-20261116-08000[0-9]\.json$/);
    const written = JSON.parse(files[0]?.text ?? '');
    expect(validateBatch(written).ok).toBe(true);
    expect(written.sync).toBeUndefined();
    expect(provider.plans[0]).toMatchObject({ max_sessions: 40, rounds: true, round_shots: true });
    clock.advance(3600_000);
    provider.have.push('S3');
    const again = await open(); // after a restart: the cursor was kept
    await sync({ target: again, provider, credential: SUB, reason: 'manual', client: 'web', guard });
    expect(JSON.parse(files[1]?.text ?? '').sessions.map((s: Session) => s.external_id)).toEqual(['S3']);
    expect(again.salt).toBe(target.salt);
  });

  it('brings the older history a chunk at a time until it is done', async () => {
    const { open, guard } = await fileSetup();
    const target = await open();
    const plan = await target.plan('demo', 'backfill', 'web');
    expect(plan).toMatchObject({ due: true, max_sessions: 10, rounds: true });
    await target.import({ format: 'olmd/1', provider: 'demo', account_ref: 'Xq3c0mB1v4Lr2kq9WzT8yA5nE6pH7sJ0dF1gK2lM3oN', generated_at: '2026-11-16T08:00:00Z', sessions: [], rounds: [], progress: { more_available: false } });
    expect(await target.plan('demo', 'backfill', 'web')).toMatchObject({ due: false, history: { done: true } });
    void guard;
  });

  it('starts afresh, with a new salt, when the player asks', async () => {
    const storage = new MemoryStorage();
    let fill = 1;
    const target = await FileTarget.open({ storage, provider: 'demo', write: async () => undefined, randomBytes: (n) => new Uint8Array(n).fill(fill++) });
    const before = target.salt;
    await target.forget();
    expect(target.salt).not.toBe(before);
  });
});
