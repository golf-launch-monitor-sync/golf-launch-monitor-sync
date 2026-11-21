// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { FileTarget, Guard, guardAccount, HttpTarget, MemoryStorage, pair, providerContext, sync, type FileOut } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { validateBatch } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { demo, roundOn, sessionOn } from './index.ts';

const NOW = Date.parse('2026-11-16T12:00:00Z');
const DAY = 86_400_000;

async function setup(plan?: ConstructorParameters<typeof FakeTarget>[0]) {
  const clock = new VirtualClock(NOW);
  const fake = new FakeTarget(plan);
  const pairing = await pair({ target: fake.base, code: 'K7M2PQ9X', provider: 'demo', client: { kind: 'companion', name: 'Test' }, fetch: fake.fetch });
  const target = new HttpTarget(pairing, { fetch: fake.fetch, now: clock.now });
  const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep });
  const go = (reason: 'connect' | 'timer' | 'manual' | 'backfill' = 'connect', credential = 'reviewer') =>
    sync({ target, provider: demo(), credential, reason, client: 'companion', guard, now: clock.now, sleep: clock.sleep });
  return { clock, fake, guard, go };
}

describe('the demo provider', () => {
  it('brings sessions and a round with each shot, as valid olmd/1, through a whole sync', async () => {
    const { fake, go } = await setup();
    expect(await go()).toMatchObject({ status: 'synced', result: { sessions: 30, rounds: 7, round_shots: 7 } });
    const batch = fake.imports[0];
    expect(validateBatch(batch).ok).toBe(true);
    const round = batch?.rounds[0];
    expect(round).toMatchObject({ kind: 'simulator', course: { name: 'Demo Links' }, holes_played: 18, par: 72 });
    expect(round?.shots?.length).toBeGreaterThan(54);
    expect(round?.shots?.filter((s) => s.lie_after === 'Hole')).toHaveLength(18);
    expect(new Set(batch?.sessions.flatMap((s) => s.shots.map((x) => x.club)))).toContain('7i');
  });

  it('is the same data under the same ids however often it syncs, so nothing is stored twice', async () => {
    const { fake, go, clock } = await setup();
    await go();
    clock.advance(DAY);
    expect(await go('manual')).toMatchObject({ status: 'synced', result: { sessions: 0 } });
    expect(sessionOn(NOW - 3 * DAY)).toEqual(sessionOn(NOW - 3 * DAY));
    expect(roundOn(NOW - 5 * DAY, true)).toEqual(roundOn(NOW - 5 * DAY, true));
    expect(fake.sessions.size).toBe(30);
  });

  it('counts its requests through the guard, as a real provider would', async () => {
    const { guard, go } = await setup();
    await go();
    const counts = await guard.counts(guardAccount('demo', 'demo:reviewer'));
    expect(counts.run).toBe(1 + 30 + 1 + 1); // the list, each session, the rounds, their shots
    expect(counts.run).toBeLessThanOrEqual(40);
  });

  it('keeps to the plan: what the target has, the window, the history a chunk at a time', async () => {
    const { fake, go, clock } = await setup({
      plan: (ask, t) => ask.reason === 'backfill'
        ? { due: true, plan_id: 'b', since: '2024-11-01T00:00:00Z', max_sessions: 10, known_ids: t.known() }
        : { due: true, plan_id: 'r', since: new Date(clock.t - 10 * DAY).toISOString(), known_ids: t.known() },
    });
    expect(await go('timer')).toMatchObject({ result: { sessions: 4, rounds: 0 }, more: false });
    expect(await go('backfill')).toMatchObject({ result: { sessions: 10 }, more: true });
    expect(fake.imports.at(-1)?.progress).toMatchObject({ more_available: true, skipped_known: 4 });
    // Spec 1.7.0: what is left of the history and how far back it reaches (a session every few days back to the window).
    const p = fake.imports.at(-1)?.progress;
    expect(p?.sessions_left).toBeGreaterThan(0);
    expect(Date.parse(p?.oldest_listed ?? '')).toBeGreaterThanOrEqual(Date.parse('2024-11-01T00:00:00Z'));
    expect(await go('backfill')).toMatchObject({ result: { sessions: 10 } });
    expect(fake.imports.at(-1)?.progress?.sessions_left).toBe((p?.sessions_left ?? 0) - 10);
  });

  it('is another account for another sign-in, and none for none', () => {
    const p = demo();
    expect(p.subject('a')).not.toBe(p.subject('b'));
    expect(p.subject('')).toBeNull();
  });

  it('says whose account it is', async () => {
    const clock = new VirtualClock(NOW);
    const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep });
    const ctx = providerContext({ guard, account: guardAccount('demo', 'demo:x'), now: clock.now });
    expect(await demo().who(ctx)).toMatchObject({ player: 'Demo Player', activities: { count: 243, place: 'Demo Golf Hall' } });
  });

  it('writes a file a reviewer can open', async () => {
    const clock = new VirtualClock(NOW);
    const files: FileOut[] = [];
    const storage = new MemoryStorage();
    const target = await FileTarget.open({ storage, provider: 'demo', write: async (f) => void files.push(f), now: clock.now });
    const guard = new Guard({ storage, now: clock.now, sleep: clock.sleep });
    expect(await sync({ target, provider: demo(), credential: 'reviewer', reason: 'manual', client: 'web', guard, now: clock.now })).toMatchObject({ status: 'synced' });
    expect(validateBatch(JSON.parse(files[0]?.text ?? '')).ok).toBe(true);
  });
});
