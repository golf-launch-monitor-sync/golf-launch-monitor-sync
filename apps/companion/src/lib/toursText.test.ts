// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { ProView } from '@glmsync/browser/pro';
import type { TourView } from '@glmsync/browser/tours';
import { describe, expect, it } from 'vitest';
import { etBar, toursBar, type AppText } from './toursText.ts';

const SITE = 'tour:pro_golf_tour' as const;
const PROFILE = 'https://www.progolftour.de/player-profile/99001?year=2026';
const RESULT = 'https://www.progolftour.de/tournament-details/sample-desert-open-2026';
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
const tour = (over: Partial<TourView> = {}): TourView => ({ who: 'Lena Beispiel', read: 0, run: null, ended: null, ...over });

describe('the tour window’s bar', () => {
  it('offers Send and Fetch all only on his profile; elsewhere it says where that is', () => {
    expect(toursBar(view(), tour(), SITE, PROFILE, 'ready', false, 'en', app)).toEqual({
      text: 'Golf Stats Sync: send this page to Example App', warn: false, send: true, fetchAll: true, stop: false, ask: false,
    });
    for (const url of [RESULT, 'https://www.progolftour.de/order-of-merit-en', null]) {
      expect(toursBar(view(), tour(), SITE, url, 'ready', false, 'en', app), String(url)).toEqual({ text: '[tours.find]', warn: false, send: false, fetchAll: false, stop: false, ask: false });
    }
  });

  it('while a run goes on, only how far it got and Stop', () => {
    const running = tour({ run: { done: 2, total: 5, tab: 1 } });
    expect(toursBar(view(), running, SITE, RESULT, 'ready', false, 'de', app)).toEqual({ text: 'Hole deine Turniere: 2 von 5 …', warn: false, send: false, fetchAll: false, stop: true, ask: false });
  });

  it('after a run, on the tournament’s page it ended on, says how the send went', () => {
    const sent = view({ pairings: [pairing({ at: '2026-11-25T10:00:00Z', site: SITE, status: 'sent', tournaments: 3 })] });
    expect(toursBar(sent, tour(), SITE, RESULT, 'done', false, 'en', app)).toMatchObject({ text: 'Sent to Example App.', send: false, fetchAll: false });
    expect(toursBar(view(), tour(), SITE, RESULT, 'error', false, 'en', app)).toMatchObject({ warn: true, send: false });
  });

  it('says when Fetch all has run often enough today, and reads nothing twice at once', () => {
    expect(toursBar(view(), tour(), SITE, PROFILE, 'ready', true, 'en', app)).toMatchObject({ text: 'Fetch all has run often enough today; tomorrow again.', fetchAll: true });
    expect(toursBar(view(), tour(), SITE, PROFILE, 'reading', true, 'en', app)).toMatchObject({ text: 'Reading the page …', send: false, fetchAll: false });
  });

  it('a page the module doesn’t know, a question, no connection', () => {
    expect(toursBar(view(), tour(), SITE, PROFILE, 'changed_page', false, 'en', app)).toMatchObject({ text: '[rankings.changed]', warn: true, send: false, fetchAll: false });
    const q = view({ question: { site: SITE, siteName: 'Pro Golf Tour', name: 'Lena Beispiel', targets: ['Example App'], at: '2026-11-25T10:00:00Z' } });
    expect(toursBar(q, tour({ run: { done: 1, total: 2, tab: 1 } }), SITE, RESULT, 'done', false, 'en', app)).toMatchObject({ ask: true, stop: false, warn: true });
    expect(toursBar(view({ pairings: [] }), tour(), SITE, PROFILE, 'ready', false, 'en', app)).toMatchObject({ text: '[pro.pairFirst]', send: false });
    expect(toursBar(null, null, SITE, PROFILE, 'ready', false, 'en', app).text).toBe('');
  });
});

const ET_RESULTS = 'https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour';
const ET_OVERVIEW = 'https://www.europeantour.com/players/jonas-beispiel-99002/';

describe('the tour window’s bar on europeantour.com', () => {
  it('offers Send on any page of his, never Fetch all; elsewhere it says where his page is', () => {
    for (const url of [ET_RESULTS, ET_OVERVIEW]) {
      expect(etBar(view(), url, 'ready', null, 'en', app), url).toEqual({ text: 'Golf Stats Sync: send this page to Example App', warn: false, send: true, fetchAll: false, stop: false, ask: false });
    }
    for (const url of ['https://www.europeantour.com/hotelplanner-tour/players/', null]) {
      expect(etBar(view(), url, 'ready', null, 'en', app), String(url)).toEqual({ text: '[tours.findEt]', warn: false, send: false, fetchAll: false, stop: false, ask: false });
    }
  });

  it('speaks of the tour sent last, else of the address’s', () => {
    const sentHp = view({ pairings: [pairing({ at: '2026-11-25T10:00:00Z', site: 'tour:hotelplanner', status: 'sent', tournaments: 3 })] });
    expect(etBar(sentHp, ET_OVERVIEW, 'done', 'tour:hotelplanner', 'en', app)).toMatchObject({ text: 'Sent to Example App.', send: false });
    // The overview without ?tour= is the DP World Tour's: without the tour sent last, nothing was sent of it.
    expect(etBar(sentHp, ET_OVERVIEW, 'done', null, 'en', app)).toMatchObject({ send: true });
    expect(etBar(sentHp, ET_RESULTS, 'done', null, 'de', app)).toMatchObject({ text: 'An Example App geschickt.', send: false });
    expect(etBar(view(), ET_RESULTS, 'reading', null, 'en', app)).toMatchObject({ text: 'Reading the page …', send: false });
    expect(etBar(view(), ET_RESULTS, 'error', null, 'en', app)).toMatchObject({ warn: true, send: true });
  });

  it('a page the module doesn’t know, a question, no connection', () => {
    expect(etBar(view(), ET_RESULTS, 'changed_page', null, 'en', app)).toMatchObject({ text: '[rankings.changed]', warn: true, send: false });
    const q = view({ question: { site: 'tour:dp_world', siteName: 'DP World Tour', name: 'Jonas Beispiel', targets: ['Example App'], at: '2026-11-25T10:00:00Z' } });
    expect(etBar(q, ET_RESULTS, 'done', 'tour:hotelplanner', 'en', app)).toMatchObject({ ask: true, send: false, warn: true });
    expect(etBar(view({ pairings: [] }), ET_RESULTS, 'ready', null, 'en', app)).toMatchObject({ text: '[pro.pairFirst]', send: false });
    expect(etBar(null, ET_RESULTS, 'ready', null, 'en', app).text).toBe('');
  });
});
