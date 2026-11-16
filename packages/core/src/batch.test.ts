// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { validateBatch, type Batch, type Session } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { clean, split } from './batch.ts';
import { InvalidBatchError } from './errors.ts';
import { utf8Length } from './sha256.ts';

const head = {
  format: 'olmd/1' as const,
  provider: 'demo',
  account_ref: 'Xq3c0mB1v4Lr2kq9WzT8yA5nE6pH7sJ0dF1gK2lM3oN',
  generated_at: '2026-11-16T12:00:00Z',
};
const session = (id: string, shots = 2): Session => ({
  external_id: id,
  kind: 'range',
  started_at: '2026-11-10T17:00:00Z',
  shots: Array.from({ length: shots }, (_, i) => ({ club: '7i', flight: { carry_m: 140 + i } })),
});

describe('clean', () => {
  it('leaves a valid batch as it is', () => {
    const b: Batch = { ...head, sessions: [session('S1')], rounds: [] };
    expect(clean(b)).toEqual({ batch: b, dropped: 0 });
  });

  it('lets one bad value cost that value, not the batch', () => {
    const bad = JSON.parse(JSON.stringify({ ...head, sessions: [session('S1'), session('S2')], rounds: [
      { external_id: 'R1', played_at: 'soon', holes: [{ number: 99 }, { number: 1, par: 4 }], stats: { putts: 'x' },
        shots: [{ hole: 1, number: 1, to_pin_before_m: 5000 }, { hole: 1, number: 2 }] },
      { external_id: '', shots: [] },
    ], progress: {}, notice: { code: 'hello' } })) as Batch;
    (bad.sessions[0]?.shots[0]?.flight as Record<string, unknown>).carry_m = 'far';
    (bad.sessions[1] as unknown as Record<string, unknown>).kind = 'SIMULATOR';
    const { batch, dropped } = clean(bad);
    expect(validateBatch(batch).ok).toBe(true);
    expect(batch.sessions).toEqual([{ ...session('S1'), shots: [{ club: '7i' }, { club: '7i', flight: { carry_m: 141 } }] }]);
    expect(batch.failed).toEqual([{ external_id: 'S2' }]); // asked for again
    expect(batch.rounds).toEqual([{ external_id: 'R1', holes: [{ number: 1, par: 4 }], shots: [{ hole: 1, number: 1 }, { hole: 1, number: 2 }] }]);
    expect(batch.progress).toBeUndefined();
    expect(batch.notice).toBeUndefined();
    expect(dropped).toBeGreaterThan(5);
  });

  it('throws only for a head that is wrong, which is a bug', () => {
    expect(() => clean({ ...head, account_ref: 'x', sessions: [], rounds: [] })).toThrow(InvalidBatchError);
  });
});

describe('split', () => {
  const limits = { max_bytes: 1_000_000, max_sessions: 3, max_shots: 10, max_rounds: 2, max_round_shots: 4 };

  it('cuts by sessions, shots, rounds and round shots, and the whole fetch goes with the last part', () => {
    const b: Batch = {
      ...head,
      sync: { plan_id: 'pl_1', reason: 'timer' },
      sessions: [session('S1', 4), session('S2', 4), session('S3', 4), session('S4', 1), session('S5', 1)],
      rounds: [
        { external_id: 'R1', shots: [{ hole: 1, number: 1 }, { hole: 1, number: 2 }, { hole: 1, number: 3 }] },
        { external_id: 'R2', shots: [{ hole: 1, number: 1 }, { hole: 1, number: 2 }] },
        { external_id: 'R3' },
      ],
      failed: [{ external_id: 'S9' }],
      progress: { more_available: true },
      notice: { code: 'partial' },
    };
    const { parts, left_out } = split(b, limits);
    expect(left_out).toBe(0);
    expect(parts.map((p) => [p.sessions.map((s) => s.external_id), p.rounds.map((r) => r.external_id)])).toEqual([
      [['S1', 'S2'], []],
      [['S3', 'S4', 'S5'], ['R1']],
      [[], ['R2', 'R3']],
    ]);
    for (const p of parts.slice(0, -1)) expect([p.sync, p.failed, p.progress, p.notice]).toEqual([undefined, undefined, undefined, undefined]);
    expect(parts.at(-1)).toMatchObject({ sync: { plan_id: 'pl_1' }, failed: [{ external_id: 'S9' }], progress: { more_available: true }, notice: { code: 'partial' } });
    for (const p of parts) expect(validateBatch(p).ok).toBe(true);
  });

  it('keeps bytes under the limit', () => {
    const b: Batch = { ...head, sessions: Array.from({ length: 30 }, (_, i) => session(`S${i}`, 8)), rounds: [] };
    const { parts } = split(b, { ...limits, max_sessions: 100, max_shots: 1000, max_bytes: 6000 });
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(utf8Length(JSON.stringify(p))).toBeLessThanOrEqual(6000);
    expect(parts.flatMap((p) => p.sessions.map((s) => s.external_id))).toHaveLength(30);
  });

  it('sends an empty batch when there is nothing but news (the lease is released all the same)', () => {
    const { parts } = split({ ...head, sessions: [], rounds: [], notice: { code: 'auth_expired' } }, limits);
    expect(parts).toEqual([{ ...head, sessions: [], rounds: [], notice: { code: 'auth_expired' } }]);
  });

  it('keeps the first shots of a session too long for a part, and leaves out what can never fit', () => {
    const b: Batch = { ...head, sessions: [session('BIG', 25), { ...session('HUGE', 1), kind_raw: 'x'.repeat(5000) }], rounds: [
      { external_id: 'R1', shots: Array.from({ length: 6 }, (_, i) => ({ hole: 1, number: i + 1 })) },
    ] };
    const { parts, left_out } = split(b, { ...limits, max_bytes: 4000 });
    const all = parts.flatMap((p) => p.sessions);
    expect(all.map((s) => [s.external_id, s.shots.length])).toEqual([['BIG', 10]]);
    expect(parts.at(-1)?.failed).toEqual([{ external_id: 'HUGE', started_at: '2026-11-10T17:00:00Z' }]);
    expect(parts.flatMap((p) => p.rounds)).toEqual([{ external_id: 'R1' }]); // its shots come again
    expect(left_out).toBe(2);
  });
});
