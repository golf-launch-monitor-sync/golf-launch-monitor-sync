// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { europeantour } from '@glmsync/provider-tours';
import { ET_TITLE, etOverview, etResults, etStats } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { EtKeeper } from './europeantour.ts';

const TODAY = '2026-11-25';
const read = (snap = etResults(), title = ET_TITLE) => europeantour.readPage(snap, title, TODAY);

describe('what the extension keeps of his pages on europeantour.com', () => {
  it('merges what his pages showed, and makes a page of each tour', async () => {
    const k = new EtKeeper(new MemoryStorage());
    expect(await k.view()).toEqual({ who: null, tournaments: {} });
    expect(await k.pages(TODAY)).toEqual([]);
    await k.seen(read(etOverview(), 'Jonas BEISPIEL - Players - European Tour'));
    await k.seen(read(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour'));
    const v = await k.seen(read());
    expect(v).toEqual({ who: 'Jonas BEISPIEL', tournaments: { 'tour:hotelplanner': 3, 'tour:dp_world': 1 } });
    const pages = await k.pages(TODAY);
    expect(pages.map((p) => [p.site, p.ranking.rank, p.ranking.points, p.tournaments.length, p.stats.length])).toEqual([
      ['tour:dp_world', undefined, undefined, 1, 0],
      ['tour:hotelplanner', 12, 1044.11, 3, 2],
    ]);
  });

  it('ignores a read that doesn\'t hold, and another player\'s page replaces his', async () => {
    const k = new EtKeeper(new MemoryStorage());
    await k.seen(read());
    expect((await k.seen({ kind: 'page', player_id: '../x', player_name: 'X' })).who).toBe('Jonas BEISPIEL');
    expect((await k.seen({ kind: 'unread', why: 'changed_page' })).who).toBe('Jonas BEISPIEL');
    const other = read(etResults({ url: 'https://www.europeantour.com/players/otto-erfunden-1/results', lines: ['Otto ERFUNDEN'] }), 'Wins & Results - Otto ERFUNDEN - Players - European Tour');
    expect(await k.seen(other)).toMatchObject({ who: 'Otto ERFUNDEN', tournaments: { 'tour:hotelplanner': 3, 'tour:dp_world': 1 } });
    expect((await k.pages(TODAY)).every((p) => p.id === '1')).toBe(true);
  });

  it('starts afresh when what it kept can\'t be read', async () => {
    const s = new MemoryStorage();
    await s.set('tours:europeantour', '{not json');
    expect(await new EtKeeper(s).view()).toEqual({ who: null, tournaments: {} });
  });
});
