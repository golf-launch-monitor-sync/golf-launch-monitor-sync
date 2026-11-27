// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { Reason } from './olmd.ts';
import { firstDays, maxSessions } from './plan.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: Record<string, unknown>; expected: unknown };
const cases = readVectors<Case>('plan.json').cases;

describe('a first sync (1.23.0)', () => {
  it('reaches back as far as the vectors say', () => {
    const got = cases.filter((c) => c.rule === 'first_days');
    expect(got.length).toBeGreaterThan(5);
    for (const c of got) expect([c.input.now, firstDays(Date.parse(c.input.now as string))]).toEqual([c.input.now, c.expected]);
  });

  it('lets as many sessions be fetched as the vectors say', () => {
    const got = cases.filter((c) => c.rule === 'max_sessions');
    expect(got.length).toBeGreaterThan(3);
    for (const c of got) {
      const i = c.input as { last_sync_at: string | null; reason: Reason };
      expect([i, maxSessions(i.last_sync_at, i.reason)]).toEqual([i, c.expected]);
    }
  });
});
