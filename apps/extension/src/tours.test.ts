// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { progolftour } from '@glmsync/provider-tours';
import { pgtLine, pgtProfile, pgtResult } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { TourKeeper } from './tours.ts';

const TODAY = '2026-11-25';
let clock = Date.UTC(2026, 10, 25, 12);
const keeper = () => new TourKeeper(new MemoryStorage(), () => clock);
const profile = (over = {}) => progolftour.readProfile(pgtProfile(over));
const lineOf = (slug: string, ...r: number[]) => progolftour.ownLine(pgtResult(slug, [pgtLine('T6', 'Lena Beispiel', ...r)]), 'Lena Beispiel');

describe('what the extension keeps of his Pro Golf Tour pages', () => {
  it('a line is taken only with his profile, and the page to send has its rounds', async () => {
    const k = keeper();
    await k.seen({ key: 'sample-desert-open-2026', line: lineOf('sample-desert-open-2026', 69, 70, 70) });
    expect((await k.view()).read).toBe(0);
    await k.seen({ profile: profile() });
    await k.seen({ key: 'sample-desert-open-2026', line: lineOf('sample-desert-open-2026', 69, 70, 70) });
    const v = await k.view();
    expect([v.who, v.read]).toEqual(['Lena Beispiel', 1]);
    const page = await k.page(TODAY);
    expect(page?.tournaments.map((t) => t.rounds?.length)).toEqual([3]);
  });

  it('a line under another key, or one that doesn\'t hold, is not kept', async () => {
    const k = keeper();
    await k.seen({ profile: profile() });
    await k.seen({ key: 'made-up-final-2026', line: lineOf('sample-desert-open-2026', 69, 70, 70) });
    await k.seen({ key: 'sample-desert-open-2026', line: { kind: 'result', key: 'sample-desert-open-2026', rounds: [] } });
    expect((await k.view()).read).toBe(0);
  });

  it('another player\'s profile replaces his, with everything read for it', async () => {
    const k = keeper();
    await k.seen({ profile: profile() });
    await k.seen({ key: 'sample-desert-open-2026', line: lineOf('sample-desert-open-2026', 69, 70, 70) });
    await k.seen({ profile: profile({ url: 'https://www.progolftour.de/player-profile/99002?year=2026', title: 'Otto Erfunden' }) });
    expect(await k.view()).toMatchObject({ who: 'Otto Erfunden', read: 0 });
  });

  it('Fetch all opens his pages in the tab it started in, reads along, and ends', async () => {
    const k = keeper();
    await k.seen({ profile: profile() });
    expect(await k.fetchAll(7, TODAY)).toBe('started');
    expect(await k.step(8)).toBeNull();
    const first = await k.step(7);
    expect(first).toEqual({ do: 'open', url: progolftour.resultUrl('made-up-final-2026') });
    await k.seen({ key: 'made-up-final-2026', line: lineOf('made-up-final-2026', 68, 67, 66) });
    expect((await k.view()).run).toEqual({ done: 1, total: 3, tab: 7 });
    for (const key of ['beispiel-köln-classic-2026', 'sample-desert-open-2026']) {
      clock += 20_000;
      expect(await k.step(7)).toEqual({ do: 'open', url: progolftour.resultUrl(key) });
      await k.seen({ key, unread: 'not_him' });
    }
    clock += 20_000;
    expect(await k.step(7)).toEqual({ do: 'end' });
    expect(await k.view()).toMatchObject({ run: null, ended: 'done', read: 1 });
  });

  it('three runs a day; Stop ends one; nothing without a profile', async () => {
    const k = keeper();
    expect(await k.fetchAll(1, TODAY)).toBe('nothing');
    await k.seen({ profile: profile() });
    for (let i = 0; i < 3; i += 1) {
      expect(await k.fetchAll(1, TODAY)).toBe('started');
      expect((await k.stop()).ended).toBe('cancelled');
    }
    expect(await k.fetchAll(1, TODAY)).toBe('limit');
  });

  it('what another version wrote, unreadable, starts afresh', async () => {
    const s = new MemoryStorage();
    await s.set('tours:pro_golf_tour', '{not json');
    expect(await new TourKeeper(s).view()).toEqual({ who: null, read: 0, run: null, ended: null });
  });
});
