// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { ProView } from '@glmsync/browser/pro';
import { describe, expect, it } from 'vitest';
import { rankingsBar, type AppText } from './rankingsText.ts';

const OWGR = 'https://www.owgr.com/playerprofile/matt-example-17646';
const ROLEX = 'https://www.rolexrankings.com/players/4711';
const app: AppText = (k) => `[${k}]`;
const pairing = (last?: NonNullable<ProView['pairings'][number]['last']>) => ({
  id: 'p1',
  base: 'https://app.example.org/hcp/v1',
  name: 'Example App',
  paired_at: '2026-11-25T09:00:00Z',
  host: 'app.example.org',
  ...(last ? { last } : {}),
});
const view = (over: Partial<ProView> = {}): ProView => ({ pairings: [pairing()], ended: [], question: null, ...over });

describe('the world ranking window’s bar', () => {
  it('offers Send only on a player’s own page; elsewhere on the sites it says to find that page', () => {
    expect(rankingsBar(view(), OWGR, 'ready', 'en', app)).toEqual({ text: 'Golf Stats Sync: send this page to Example App', warn: false, send: true, ask: false });
    expect(rankingsBar(view(), ROLEX, 'ready', 'en', app).send).toBe(true);
    for (const url of ['https://www.owgr.com/current-world-ranking', 'https://www.rolexrankings.com/rankings', 'https://www.owgr.com/events/x-1', null])
      expect(rankingsBar(view(), url, 'ready', 'en', app), String(url)).toEqual({ text: '[rankings.find]', warn: false, send: false, ask: false });
  });

  it('says what a send did, in the extension’s words', () => {
    expect(rankingsBar(view(), OWGR, 'reading', 'de', app)).toMatchObject({ text: 'Lese die Seite …', send: false });
    const sent = view({ pairings: [pairing({ at: '2026-11-25T10:00:00Z', site: 'owgr', status: 'sent', tournaments: 12 })] });
    expect(rankingsBar(sent, OWGR, 'done', 'en', app)).toMatchObject({ text: 'Sent to Example App.', send: false, warn: false });
    const failed = view({ pairings: [pairing({ at: '2026-11-25T10:00:00Z', site: 'owgr', status: 'failed', error: 'unreachable' })] });
    expect(rankingsBar(failed, OWGR, 'done', 'en', app)).toMatchObject({ send: true, warn: true });
    expect(rankingsBar(view(), OWGR, 'error', 'en', app)).toMatchObject({ send: true, warn: true });
  });

  it('a page the module doesn’t know says to update the app, not the extension', () => {
    expect(rankingsBar(view(), OWGR, 'changed_page', 'en', app)).toEqual({ text: '[rankings.changed]', warn: true, send: false, ask: false });
  });

  it('asks whether the page is the player’s right in the bar, wherever the window stands', () => {
    const q = view({ question: { site: 'owgr', siteName: 'Official World Golf Ranking', name: 'Matt Example', targets: ['Example App'], at: '2026-11-25T10:00:00Z' } });
    for (const url of [OWGR, ROLEX, 'https://www.owgr.com/current-world-ranking']) {
      const bar = rankingsBar(q, url, 'done', 'en', app);
      expect(bar).toMatchObject({ ask: true, send: false, warn: true });
      expect(bar.text).toContain('Matt Example');
    }
  });

  it('without a connection it sends nothing and says to connect first', () => {
    expect(rankingsBar(view({ pairings: [] }), OWGR, 'ready', 'en', app)).toEqual({ text: '[pro.pairFirst]', warn: true, send: false, ask: false });
    expect(rankingsBar(null, OWGR, 'ready', 'en', app)).toEqual({ text: '', warn: false, send: false, ask: false }); // not read yet
  });
});
