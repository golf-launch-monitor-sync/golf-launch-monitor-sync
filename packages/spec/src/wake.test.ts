// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { isWake, readWake, WAKE_ADDRESS_MAX, WAKE_BACK_GAP_S, WAKE_GAP_S, WAKE_PAYLOAD, WAKE_SERVICES } from './wake.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: unknown; expected: unknown };
const file = readVectors<Case>('wake.json');

describe('the wake answers the vectors', () => {
  // should_wake is the target's rule (a client never decides it): its cases are for targets.
  const mine = file.cases.filter((c) => c.rule !== 'should_wake');
  it.each(mine.map((c, i) => [`${i} ${c.rule} ${JSON.stringify(c.input)?.slice(0, 80)}`, c] as const))('%s', (_, c) => {
    if (c.rule === 'read_wake') expect(readWake(c.input)).toEqual(c.expected);
    else if (c.rule === 'is_wake') expect(isWake(c.input)).toBe(c.expected);
    else throw new Error(`unknown rule ${c.rule}`);
  });

  it('has the spec’s constants', () => {
    expect(file.wake).toEqual({ services: [...WAKE_SERVICES], gap_s: WAKE_GAP_S, back_gap_s: WAKE_BACK_GAP_S, payload: WAKE_PAYLOAD, address_max: WAKE_ADDRESS_MAX });
  });
});
