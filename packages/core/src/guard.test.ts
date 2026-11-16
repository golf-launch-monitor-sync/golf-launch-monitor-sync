// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { GUARD_LIMITS } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { readVectors } from '../../spec/src/vectors.ts';
import { Cancelled, GuardLimitError, GuardStorageError } from './errors.ts';
import {
  beginRunState,
  checkState,
  finishState,
  freshState,
  Guard,
  guardAccount,
  LIMITS,
  startState,
  type GuardState,
} from './guard.ts';
import { MemoryStorage, type Storage } from './storage.ts';
import { VirtualClock } from './testing/index.ts';

type Step = { op: 'run' | 'check' | 'start' | 'finish'; t?: number; account?: string; status?: number; retry_after_s?: number; expected?: unknown };
type Scenario = { name: string; why: string; steps: Step[] };

describe('the rules (guard.json)', () => {
  const file = readVectors<Scenario>('guard.json');

  it('were written with the limits in force', () => {
    expect(file.limits).toEqual(GUARD_LIMITS);
  });

  it.each(file.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const accounts = new Map<string, GuardState>();
    const get = (a: string) => accounts.get(a) ?? freshState();
    c.steps.forEach((s, i) => {
      const a = s.account ?? 'A';
      if (s.op === 'run') accounts.set(a, beginRunState(get(a)));
      else if (s.op === 'start') accounts.set(a, startState(get(a), s.t as number));
      else if (s.op === 'finish') accounts.set(a, finishState(get(a), s.t as number, s.status as number, s.retry_after_s ?? null));
      else expect([i, checkState(get(a), s.t as number)]).toEqual([i, s.expected]);
    });
  });
});

/** A guard on a virtual clock whose pauses take no real time. */
function setup(storage: Storage = new MemoryStorage(), clock = new VirtualClock()) {
  const slept: number[] = [];
  const guard = new Guard({
    storage,
    now: clock.now,
    random: () => 0.5,
    sleep: async (ms) => {
      slept.push(ms);
      clock.advance(ms);
    },
  });
  return { guard, clock, storage, slept };
}

const ok = <T>(value: T, status = 200) => async () => ({ status, value });
const A = guardAccount('trackman', 'subject-1');

describe('the guard a client runs with', () => {
  it('cannot be switched off: the limits are the spec’s, frozen, and no option reaches them', () => {
    expect(LIMITS).toEqual(GUARD_LIMITS);
    expect(Object.isFrozen(LIMITS) && Object.isFrozen(LIMITS.backoff) && Object.isFrozen(LIMITS.pause_s)).toBe(true);
    expect(() => {
      (LIMITS as { per_day: number }).per_day = 10_000;
    }).toThrow();
    const g = new Guard({ storage: new MemoryStorage(), ...({ limits: { per_run: 1e9 } } as object) });
    expect(Object.keys(g)).not.toContain('limits');
  });

  it('pauses 1–3 s × pace before each request but the first of a run, never under a second', async () => {
    const { guard, slept } = setup();
    await guard.beginRun(A);
    await guard.request(A, 'list', ok(1));
    await guard.request(A, 'session', ok(2), { pace: 2 });
    await guard.request(A, 'session', ok(3), { pace: 0.1 }); // floored at 0.5
    expect(slept).toEqual([4000, 1000]);
  });

  it('waits out the minimum pause itself, but not a limit', async () => {
    const clock = new VirtualClock();
    const storage = new MemoryStorage();
    const { guard } = setup(storage, clock);
    await guard.beginRun(A);
    await guard.request(A, 'a', ok(1));
    // Another client of the same storage ended a request just now: the next waits a second.
    const other = new Guard({ storage, now: clock.now, random: () => 0, sleep: async (ms) => clock.advance(ms) });
    const t = clock.t;
    await other.request(A, 'b', ok(2));
    expect(clock.t - t).toBeGreaterThanOrEqual(1000);
  });

  it('counts every request before it is sent, and keeps the counts across a restart', async () => {
    const storage = new MemoryStorage();
    const clock = new VirtualClock();
    const { guard } = setup(storage, clock);
    await guard.beginRun(A);
    let seen = -1;
    await guard.request(A, 'list', async () => {
      seen = JSON.parse((await storage.get(`glmsync/guard/${A}`)) as string).starts.length;
      return { status: 200, value: null };
    });
    expect(seen).toBe(1);
    const restarted = setup(storage, clock).guard;
    expect(await restarted.counts(A)).toMatchObject({ run: 1, hour: 1, day: 1 });
  });

  it('stops at 40 a run and sends nothing past it', async () => {
    const { guard } = setup();
    await guard.beginRun(A);
    let sent = 0;
    for (let i = 0; i < LIMITS.per_run; i++) await guard.request(A, 's', async () => ({ status: 200, value: ++sent }));
    const err = await guard.request(A, 's', async () => ({ status: 200, value: ++sent })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GuardLimitError);
    expect((err as GuardLimitError).reasons).toEqual(['per_run']);
    expect((err as GuardLimitError).until).toBeNull();
    expect(sent).toBe(40);
    await guard.beginRun(A);
    await guard.request(A, 's', async () => ({ status: 200, value: ++sent }));
    expect(sent).toBe(41);
  });

  it('holds the hourly and the daily limit, rolling, and says until when', async () => {
    const { guard, clock } = setup();
    let sent = 0;
    const t0 = clock.t;
    for (let i = 0; i < LIMITS.per_hour; i++) {
      if (i % 30 === 0) await guard.beginRun(A);
      await guard.request(A, 's', async () => ({ status: 200, value: ++sent }));
    }
    await guard.beginRun(A);
    const err = (await guard.request(A, 's', ok(0)).catch((e: unknown) => e)) as GuardLimitError;
    expect(err.reasons).toContain('per_hour');
    expect(err.until).toBe(t0 + 3_600_000);
    expect(sent).toBe(60);
  });

  it('backs off after 429, 5xx or no answer, honours Retry-After, and a good answer starts again', async () => {
    const { guard, clock } = setup();
    await guard.beginRun(A);
    await guard.request(A, 's', async () => ({ status: 429, retryAfterS: 7200, value: null }));
    const ended = clock.t;
    const err = (await guard.request(A, 's', ok(1)).catch((e: unknown) => e)) as GuardLimitError;
    expect(err.reasons).toEqual(['backoff']);
    expect(err.until).toBe(ended + 7_200_000);
    clock.advance(7_200_001);
    await expect(guard.request(A, 's', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    expect((await guard.check(A)).ok).toBe(false); // no answer, the second bad one in a row: 120 s
    clock.advance(120_001);
    await guard.request(A, 's', ok(1));
    expect(await guard.counts(A)).toMatchObject({ blocked_until: null });
  });

  it('holds nothing against the provider when the player stopped', async () => {
    const { guard, clock } = setup();
    await guard.beginRun(A);
    await expect(guard.request(A, 's', async () => { throw new Cancelled(); })).rejects.toBeInstanceOf(Cancelled);
    clock.advance(1000);
    expect(await guard.check(A)).toEqual({ ok: true });
  });

  it('sends nothing it cannot count', async () => {
    const broken: Storage = {
      get: async () => null,
      set: async () => {
        throw new Error('disk full');
      },
      remove: async () => undefined,
    };
    const guard = new Guard({ storage: broken });
    let sent = false;
    await expect(guard.request(A, 's', async () => ({ status: 200, value: (sent = true) }))).rejects.toBeInstanceOf(GuardStorageError);
    expect(sent).toBe(false);
  });

  it('takes counts it cannot read for high ones: a day’s pause', async () => {
    const storage = new MemoryStorage();
    await storage.set(`glmsync/guard/${A}`, '{"v":1,"starts":"lots"}');
    const { guard, clock } = setup(storage);
    const err = (await guard.request(A, 's', ok(1)).catch((e: unknown) => e)) as GuardLimitError;
    expect(err.reasons).toEqual(['backoff']);
    expect(err.until).toBe(clock.t + 86_400_000);
  });

  it('takes a request a crash left in flight as busy for two minutes, not forever', async () => {
    const storage = new MemoryStorage();
    const clock = new VirtualClock();
    await storage.set(`glmsync/guard/${A}`, JSON.stringify({ v: 1, starts: [clock.t], run: 1, in_flight_since: clock.t, last_end: null, streak: 0, blocked_until: null }));
    const { guard } = setup(storage, clock);
    expect(await guard.check(A)).toMatchObject({ ok: false, reasons: ['busy'] });
    clock.advance(120_000);
    expect(await guard.check(A)).toEqual({ ok: true });
  });

  it('asks one request at a time, even when called at once', async () => {
    const { guard } = setup();
    await guard.beginRun(A);
    let inFlight = 0;
    let most = 0;
    const send = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { status: 200, value: null };
    };
    await Promise.all([guard.request(A, 's', send), guard.request(A, 's', send), guard.request(A, 's', send)]);
    expect(most).toBe(1);
  });

  it('counts per provider account, the same for every target, under a key that names nobody', async () => {
    const { guard } = setup();
    const B = guardAccount('trackman', 'subject-2');
    expect(B).not.toBe(A);
    expect(guardAccount('demo', 'subject-1')).not.toBe(A);
    expect(A).toMatch(/^g1_[A-Za-z0-9_-]{22}$/);
    expect(A).not.toContain('subject');
    await guard.beginRun(A);
    for (let i = 0; i < 40; i++) await guard.request(A, 's', ok(i));
    await guard.beginRun(B);
    await expect(guard.request(B, 's', ok(1))).resolves.toBe(1);
  });

  it('logs time, kind, status and duration of 14 days - no content - for the player to export', async () => {
    const { guard, clock } = setup();
    await guard.beginRun(A);
    await guard.request(A, 'list', async () => {
      clock.advance(250);
      return { status: 200, value: { secret: 'a shot' } };
    });
    await guard.request(A, 'Bad Kind!', async () => ({ status: 503, value: null }));
    const out = await guard.exportLog();
    expect(out.format).toBe('glmsync-guard-log/1');
    expect(out.limits).toEqual(GUARD_LIMITS);
    expect(out.accounts).toEqual([
      { account: A, requests: [
        { at: expect.any(String), kind: 'list', status: 200, ms: 250 },
        { at: expect.any(String), kind: 'other', status: 503, ms: 0 },
      ] },
    ]);
    expect(JSON.stringify(out)).not.toContain('a shot');
    clock.advance(15 * 86_400_000);
    await guard.beginRun(A);
    await guard.request(A, 'list', ok(1));
    expect((await guard.exportLog()).accounts[0]?.requests).toHaveLength(1);
  });
});
