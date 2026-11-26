// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { checkTourPage, ocs } from '@glmsync/provider-tours';
import { ocsEntry, ocsOom, ocsProfile } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { OcsKeeper } from './ocs.ts';

const TODAY = '2026-11-25';
const LET = 'https://ladieseuropeantour.com';
const profile = (over = {}) => ocs.readProfile(ocsProfile(over));
const oom = (id = '990001', over = {}) => ocs.readOom(ocsOom(over), id);

describe('what a client keeps of her LET and LET Access pages', () => {
  it('sends her profile with every finished tournament and, once read, her rank of that season', async () => {
    const k = new OcsKeeper(new MemoryStorage());
    expect(await k.page('tour:let_access', TODAY)).toBeNull();
    expect(await k.seen('tour:let_access', { profile: profile() })).toEqual({ who: { id: '990001', name: 'Erika Erfunden', season: 2026 }, rank: null, read: 3 });
    expect((await k.seen('tour:let_access', { oom: oom() })).rank).toBe(3);
    const page = await k.page('tour:let_access', TODAY);
    expect(page?.ranking).toEqual({ source: 'tour:let_access', as_of: TODAY, rank: 3, points: 1807.42, events: 18 });
    expect(page?.tournaments).toHaveLength(3);
    expect(page && checkTourPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it('takes an Order of Merit line only of the profile read last, and only on its own tour', async () => {
    const k = new OcsKeeper(new MemoryStorage());
    await k.seen('tour:let_access', { oom: oom() });
    expect(await k.view('tour:let_access')).toEqual({ who: null, rank: null, read: 0 });
    await k.seen('tour:let_access', { profile: profile() });
    await k.seen('tour:let_access', { oom: { ...oom(), player_id: '990099' } });
    await k.seen('tour:let_access', { oom: { ...oom(), site: 'tour:let' } });
    await k.seen('tour:let_access', { oom: { kind: 'oom', site: 'tour:let_access', player_id: '990001', season: 2026 } });
    expect((await k.view('tour:let_access')).rank).toBeNull();
    // A profile of the other tour isn't this tour's.
    await k.seen('tour:let', { profile: profile() });
    expect((await k.view('tour:let')).who).toBeNull();
  });

  it('keeps the two tours apart', async () => {
    const k = new OcsKeeper(new MemoryStorage());
    await k.seen('tour:let_access', { profile: profile() });
    await k.seen('tour:let', { profile: profile({ url: `${LET}/player-profiles/990001/` }) });
    expect((await k.page('tour:let', TODAY))?.site).toBe('tour:let');
    expect((await k.page('tour:let_access', TODAY))?.site).toBe('tour:let_access');
  });

  it('keeps each season read: the line speaks of the one read last, a send has them all with the newest one\'s rank', async () => {
    const k = new OcsKeeper(new MemoryStorage());
    await k.seen('tour:let_access', { profile: profile() });
    await k.seen('tour:let_access', { oom: oom() });
    const older = ocs.readProfile(ocsProfile({ selected: ['2025 Season'] }, [ocsEntry('8001', 'Earlier Open', '14/06/25', '4', [71, 70, 72], '-3')]));
    await k.seen('tour:let_access', { profile: older });
    expect(await k.view('tour:let_access')).toEqual({ who: { id: '990001', name: 'Erika Erfunden', season: 2025 }, rank: null, read: 1 });
    const page = await k.page('tour:let_access', TODAY);
    expect(page?.ranking.rank).toBe(3);
    expect(page?.tournaments.map((t) => t.start)).toEqual(['2026-04-12', '2026-05-20', '2026-07-08', '2025-06-14']);
    expect(page && checkTourPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it('another player\'s profile replaces hers, every season, and her ranks go with it', async () => {
    const k = new OcsKeeper(new MemoryStorage());
    await k.seen('tour:let_access', { profile: profile() });
    await k.seen('tour:let_access', { oom: oom() });
    await k.seen('tour:let_access', { profile: profile({ selected: ['2025 Season'] }) });
    await k.seen('tour:let_access', { profile: profile({ url: 'https://letaccess.com/player-profiles/990011/' }) });
    expect(await k.view('tour:let_access')).toMatchObject({ who: { id: '990011' }, rank: null });
    expect((await k.page('tour:let_access', TODAY))?.ranking.rank).toBeUndefined();
    await k.seen('tour:let_access', { profile: profile() });
    expect((await k.view('tour:let_access')).rank).toBeNull();
  });

  it('reads what an older version kept (one profile, one line)', async () => {
    const s = new MemoryStorage();
    await s.set('tours:let_access', JSON.stringify({ profile: profile(), oom: oom() }));
    expect(await new OcsKeeper(s).view('tour:let_access')).toEqual({ who: { id: '990001', name: 'Erika Erfunden', season: 2026 }, rank: 3, read: 3 });
  });

  it('what doesn\'t hold isn\'t kept, and unreadable storage starts afresh', async () => {
    const s = new MemoryStorage();
    const k = new OcsKeeper(s);
    await k.seen('tour:let_access', { profile: { kind: 'profile', site: 'tour:let_access', player_id: 'x' } });
    expect((await k.view('tour:let_access')).who).toBeNull();
    await s.set('tours:let_access', '{not json');
    expect(await k.view('tour:let_access')).toEqual({ who: null, rank: null, read: 0 });
  });
});
