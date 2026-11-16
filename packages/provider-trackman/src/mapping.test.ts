// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { validateBatch, type Batch } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { readVectors } from '../../spec/src/vectors.ts';
import { batch, clubOf, session } from './mapping.ts';
import * as queries from './queries.ts';

type Case = { name: string; why: string; input: { fetched: never; account_ref: string; generated_at: string }; expected: Batch };

/** Equal as JSON values; numbers within `tol` (rounding to centimetres differs between languages at exact halves). */
function close(a: unknown, b: unknown, tol: number, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol ? [] : [`${path}: ${a} != ${b}`];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: length ${a.length} != ${b.length}`];
    return a.flatMap((x, i) => close(x, b[i], tol, `${path}/${i}`));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], tol, `${path}/${k}`));
  }
  return Object.is(a, b) ? [] : [`${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`];
}

describe("Trackman's answers as olmd/1 (trackman-olmd.json)", () => {
  const file = readVectors<Case>('trackman-olmd.json');
  const tol = (file.compare as { round_shot_tolerance: number }).round_shot_tolerance;

  it.each(file.cases.map((c) => [c.name, c] as const))('%s', (_, c) => {
    const got = batch(structuredClone(c.input.fetched), { account_ref: c.input.account_ref, generated_at: c.input.generated_at });
    // Everything exactly, but the shots of rounds within the tolerance.
    const strip = (b: Batch) => ({ ...b, rounds: b.rounds.map(({ shots: _, ...r }) => r) });
    expect(strip(got)).toEqual(strip(c.expected));
    expect(close(got.rounds.map((r) => r.shots ?? null), c.expected.rounds.map((r) => r.shots ?? null), tol)).toEqual([]);
    expect(validateBatch(got).ok).toBe(true);
  });

  it('writes no -0, no null and no empty group anywhere', () => {
    for (const c of file.cases) {
      const text = JSON.stringify(batch(structuredClone(c.input.fetched), c.input));
      expect(text).not.toMatch(/null|\{\}|-0[,}\]]/);
    }
  });
});

describe('the mapping', () => {
  it('keeps a club it cannot read as Trackman sent it, and no code for none', () => {
    expect(clubOf('Chipper')).toEqual(['Chipper', 'Chipper']);
    expect(clubOf('Unknown')).toEqual([null, 'Unknown']);
    expect(clubOf(null)).toEqual([null, null]);
  });

  it('never fails, whatever comes', () => {
    for (const junk of [null, 1, 'x', [], { id: {} }, { id: 'A', kind: { k: 1 } }]) {
      expect(() => session(junk, junk)).not.toThrow();
      expect(() => batch(junk as never, { account_ref: 'x', generated_at: 'y' })).not.toThrow();
    }
  });
});

describe('what is asked for', () => {
  const fields = (q: string) => new Set(q.match(/[A-Za-z_]+/g));

  it("asks for no shot field the mapping doesn't read", () => {
    const read = ['carry', 'total', 'carrySide', 'totalSide', 'ballSpeed', 'clubSpeed', 'smashFactor', 'launchAngle', 'spinRate', 'ballSpin', 'clubPath', 'faceAngle', 'spinAxis', 'curve'];
    const all = [...queries.SESSION_TYPES, undefined].map((t) => queries.sessionQuery(t)).join('\n');
    const asked = all.match(/measurement \{([^}]*)\}/g)?.flatMap((m) => m.replace(/measurement \{|\}/g, '').trim().split(/\s+/)) ?? [];
    expect(new Set(asked)).toEqual(new Set(read));
  });

  it("asks for no field of a round's shots the mapping doesn't read", () => {
    const shots = /shots \{([\s\S]*?)\n {8}\}/.exec(queries.ROUND_SHOTS_QUERY)?.[1] ?? '';
    expect([...fields(shots)].sort()).toEqual(
      ['carry', 'club', 'distanceFromPinTotal', 'dropPosition', 'finalLie', 'finalPosition', 'launchLie', 'launchPosition', 'measurement', 'shotNumber', 'shotResult', 'shotsToAdd', 'targetDistance', 'total', 'x', 'z'],
    );
  });

  it('asks of the profile for the name and nothing else', () => {
    expect(queries.PROFILE_QUERY).toMatch(/profile \{ fullName playerName \}/);
    expect(queries.WHO_QUERY).not.toMatch(/handicap|email|birth/i);
  });
});
