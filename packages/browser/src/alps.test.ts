// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { alps, checkTourPage } from '@glmsync/provider-tours';
import { alpsOom, alpsRecord, alpsResults } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { alpsNote, AlpsKeeper } from './alps.ts';
import { translator } from './i18n.ts';

const TODAY = '2026-11-26';
const read = (snap: ReturnType<typeof alpsRecord>) => alps.readPage(snap);

describe('what a client keeps of his Alps Tour profile', () => {
  it('merges the reports he picks and sends his rounds with the par and the season\'s rank', async () => {
    const k = new AlpsKeeper(new MemoryStorage());
    expect(await k.view()).toEqual({ who: null, read: null, totals: false, rank: null });
    expect(await k.page(TODAY)).toBeNull();
    expect(await k.seen(read(alpsOom()))).toEqual({ who: 'Paul Platzhalter', read: null, totals: false, rank: 4 });
    await k.seen(read(alpsResults()));
    expect(await k.seen(read(alpsRecord()))).toEqual({ who: 'Paul Platzhalter', read: 3, totals: true, rank: 4 });
    const page = await k.page(TODAY);
    expect(page?.ranking).toEqual({ source: 'tour:alps', as_of: TODAY, rank: 4, points: 26845.35, events: 9 });
    expect(page?.tournaments.map((t) => t.rounds?.[0]?.par)).toEqual([72, 72, 72]);
    expect(page && checkTourPage(JSON.parse(JSON.stringify(page)))).toEqual(page);
  });

  it('ignores what doesn\'t hold, and another player\'s profile replaces his', async () => {
    const storage = new MemoryStorage();
    const k = new AlpsKeeper(storage);
    await k.seen(read(alpsRecord()));
    expect(await k.seen({ kind: 'alps', player_id: '../x', player_name: 'X' })).toMatchObject({ who: 'Paul Platzhalter', read: 3 });
    expect(await k.seen(read(alpsOom({ url: 'https://www.alpstourgolf.com/playerprofile/TST002', pairs: { 'Player name': 'Otto Erfunden' } })))).toEqual({
      who: 'Otto Erfunden', read: null, totals: false, rank: 4,
    });
    // Unreadable storage (another version wrote it): afresh.
    await storage.set('tours:alps', '{not json');
    expect(await k.view()).toEqual({ who: null, read: null, totals: false, rank: null });
  });
});

describe('the line on his Alps Tour profile', () => {
  it('asks for *This Season record* first, then says what was read', () => {
    const en = translator('en');
    const de = translator('de');
    expect(alpsNote({ who: 'Paul Platzhalter', read: null, totals: true, rank: 4 }, en)).toMatch(/^Pick “This Season record”/);
    expect(alpsNote({ who: 'Paul Platzhalter', read: 3, totals: false, rank: null }, en)).toBe('3 tournaments with rounds read. Send them, or pick another report first.');
    expect(alpsNote({ who: 'Paul Platzhalter', read: 3, totals: true, rank: 4 }, de)).toBe('3 Turniere mit Runden gelesen, mit Par, Rang 4. Schick sie, oder wähle vorher noch einen Bericht.');
  });
});
