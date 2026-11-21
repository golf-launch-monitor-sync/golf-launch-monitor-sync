// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import hcpSchema from '../../../spec/hcp/dgvhcp-1.schema.json' with { type: 'json' };
import { makeAjv } from '../../spec/src/check.ts';
import { batchOf, parts } from './batch.ts';
import { resultOf } from './mapping.ts';
import { reduce, type Seen } from './observe.ts';
import { entry, historyAnswer, scoringAnswer } from './testing.ts';

const check = makeAjv().compile(hcpSchema);
const REF = 'Xq3c0mB1v4Lr2kq9WzT8yA5nE6pH7sJ0dF1gK2lM3oN';

describe('a batch of what was seen', () => {
  it('is valid dgvhcp/1, whatever golf.de’s entries held', () => {
    const odd = [
      entry(), entry({ tournamentType: 8, tournamentName: 'RPR: Someone' }), entry({ resultStatus: 'NA', ratedGrossResult: 0 }),
      entry({ holesPerRound: 9, par: 36, courseRating: 35.9 }), entry({ ratedGrossResult: null, ratedStablefordPoints: 34 }),
      entry({ tournamentType: 3, tournamentName: 'x'.repeat(300), startTeeColor: '' }), entry({ hcpi: -2.1 }),
    ];
    const history = reduce({ kind: 'graphql', op: 'GetHandicapHistorySheet' }, 200, historyAnswer(odd)) as Extract<Seen, { kind: 'history' }>;
    const scoring = reduce({ kind: 'graphql', op: 'GetScoringRecords' }, 200, scoringAnswer(odd)) as Extract<Seen, { kind: 'scoring' }>;
    for (const [sheet, results] of [['history', history.results], ['scoring', scoring.results]] as const) {
      const b = batchOf({ account_ref: REF, sheet, results, now: Date.parse('2026-11-21T19:30:00Z'), generator: { name: 'Golf Stats Sync for Chrome and Edge', version: '0.9.0' }, plan: { plan_id: 'hp_1', reason: 'manual' }, index: { value: 8.1, as_of: '2026-11-21', low: 7.4 } });
      expect(check(b), JSON.stringify(check.errors)).toBe(true);
      expect(b.results).toHaveLength(odd.length);
    }
  });

  it('with a notice and nothing else is valid too', () => {
    expect(check(batchOf({ account_ref: REF, sheet: 'history', results: [], now: 0, generator: { name: 'x' }, notice: { code: 'signed_out' } }))).toBe(true);
  });
});

describe('parts', () => {
  const r = resultOf(entry(), 'history')!;
  it('keeps to the number of results and the bytes', () => {
    expect(parts(new Array(7).fill(r), { max_results: 3, max_bytes: 1_000_000 }).map((p) => p.length)).toEqual([3, 3, 1]);
    const one = new TextEncoder().encode(JSON.stringify(r)).length + 1;
    expect(parts(new Array(4).fill(r), { max_results: 500, max_bytes: 2048 + one * 2 }).map((p) => p.length)).toEqual([2, 2]);
    expect(parts([], { max_results: 3, max_bytes: 10_000 })).toEqual([]);
    expect(parts([r], { max_results: 3, max_bytes: 100 })).toEqual([]);
  });
});
