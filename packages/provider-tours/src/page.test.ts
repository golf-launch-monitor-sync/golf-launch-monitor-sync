// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { checkTourPage, tourBatchOf, tourSubjectOf, type TourPage } from './page.ts';
import { checkOwnLine, checkProfile, ownLine, readProfile, siteRead } from './progolftour.ts';
import { pgtProfile, pgtResult } from './testing.ts';

const page = (): TourPage => {
  const p = readProfile(pgtProfile());
  const l = ownLine(pgtResult(), 'Lena Beispiel');
  if (p?.kind !== 'profile' || l?.kind !== 'result') throw new Error('fixtures');
  return siteRead(p, { [l.key]: l }, '2026-11-25');
};
const OPTS = { account_ref: 'a'.repeat(22), generated_at: '2026-11-25T12:00:00Z', generator: { name: 'Golf Stats Sync', version: '0.14.0' } };

describe('a tour page, read again where it arrives', () => {
  it('keeps a page as read, and drops what doesn\'t fit field by field', () => {
    expect(checkTourPage(JSON.parse(JSON.stringify(page())))).toEqual(page());
    const bad = JSON.parse(JSON.stringify(page()));
    bad.tournaments[0].rounds.push({ round_no: 9, gross: 70 }, { round_no: 4, gross: 'x' });
    bad.tournaments[0].country = 'x'.repeat(61);
    bad.tournaments.push({ ref: 'no rounds', start: '2026-01-01', rounds: [] }, { ref: 'bad ref!', start: '2026-01-01', rounds: [{ round_no: 1, gross: 70 }] });
    bad.ranking.rank = -1;
    bad.evil = '<script>';
    const got = checkTourPage(bad);
    expect(got?.tournaments.length).toBe(1);
    expect(got?.tournaments[0]?.rounds?.length).toBe(3);
    expect(got?.tournaments[0]?.country).toBeUndefined();
    expect(got?.ranking.rank).toBeUndefined();
    expect(JSON.stringify(got)).not.toContain('script');
  });

  it('is none without its site, id, name or a ranking day, or with nothing worth sending', () => {
    for (const change of [{ site: 'tour:nowhere' }, { site: 'owgr' }, { id: '../x' }, { name: '' }, { ranking: { source: 'tour:pro_golf_tour' } }]) {
      expect(checkTourPage({ ...page(), ...change })).toBeNull();
    }
    expect(checkTourPage({ ...page(), tournaments: [], ranking: { source: 'tour:pro_golf_tour', as_of: '2026-11-25' } })).toBeNull();
    expect(checkTourPage(null)).toBeNull();
  });

  it('one prores/1 batch: the frame, the ranking, the tournaments, no statistics where there are none', () => {
    const b = tourBatchOf(page(), { ...OPTS, plan_id: 'p1', reason: 'manual', confirmed: true });
    expect(b).toMatchObject({ format: 'prores/1', provider: 'pro', site: 'tour:pro_golf_tour', player: { name: 'Lena Beispiel', confirmed: true }, sync: { plan_id: 'p1', reason: 'manual' } });
    expect(b.rankings).toEqual([page().ranking]);
    expect(b.tournaments?.length).toBe(1);
    expect(b.stats).toBeUndefined();
    expect(tourSubjectOf(page())).toBe('tour:pro_golf_tour:99001');
  });

  it('cuts at the format\'s most rounds, leaving out the oldest tournaments', () => {
    const t = page().tournaments[0];
    if (!t) throw new Error('fixture');
    const many = Array.from({ length: 200 }, (_, i) => ({ ...t, ref: `pgt-${i}`, start: `20${10 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01` }));
    const b = tourBatchOf({ ...page(), tournaments: many }, OPTS);
    expect(b.tournaments?.length).toBe(166);
    expect(b.tournaments?.[0]?.ref).toBe('pgt-199');
  });
});

describe('what the content script hands the background, read again', () => {
  it('a profile and his line come through as read; anything else of them is dropped', () => {
    const p = readProfile(pgtProfile());
    const l = ownLine(pgtResult(), 'Lena Beispiel');
    expect(checkProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(checkOwnLine(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(checkProfile({ ...p, player_id: 'A B' })).toBeNull();
    expect(checkOwnLine({ ...l, rounds: [{ round_no: 1, gross: 3 }] })).toBeNull();
    expect(checkOwnLine({ ...l, field: 0 })).toBeNull();
    expect(checkOwnLine({ ...l, others: ['Otto Erfunden'] })).toEqual(l);
  });
});
