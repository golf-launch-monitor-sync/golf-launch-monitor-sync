// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { ProView } from '@glmsync/browser/pro';
import type { TourView } from '@glmsync/browser/tours';
import { describe, expect, it } from 'vitest';
import { alpsBar, etBar, ocsBar, seasonBar, toursBar, type AppText } from './toursText.ts';

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

const LETAS = 'tour:let_access' as const;
const LETAS_PROFILE = 'https://letaccess.com/player-profiles/990001/';
const LETAS_OOM = 'https://letaccess.com/letas-order-of-merits?id=2026&oom=LO';
const her = { who: { id: '990001', name: 'Erika Erfunden', season: 2026 }, rank: null, read: 3 };

describe('the tour window’s bar on the LET and the LET Access Series', () => {
  it('offers Send on her profile, and on the Order of Merit once a profile was read; elsewhere where her profile is', () => {
    const send = { text: 'Golf Stats Sync: send this page to Example App', warn: false, send: true, fetchAll: false, stop: false, ask: false };
    expect(ocsBar(view(), null, LETAS, LETAS_PROFILE, 'ready', null, 'en', app)).toEqual(send);
    expect(ocsBar(view(), her, LETAS, LETAS_OOM, 'ready', null, 'en', app)).toEqual(send);
    const find = { text: '[tours.findOcs]', warn: false, send: false, fetchAll: false, stop: false, ask: false };
    expect(ocsBar(view(), null, LETAS, LETAS_OOM, 'ready', null, 'en', app)).toEqual(find);
    expect(ocsBar(view(), her, LETAS, 'https://letaccess.com/players', 'ready', null, 'en', app)).toEqual(find);
    expect(ocsBar(view(), her, LETAS, null, 'ready', null, 'en', app)).toEqual(find);
  });

  it('says what a read found in the extension’s words, and nothing while reading', () => {
    expect(ocsBar(view(), her, LETAS, LETAS_OOM, 'ready', { kind: 'oomRead', rank: 3 }, 'de', app)).toMatchObject({ text: 'Platz 3 der Order of Merit gelesen: er geht mit, wenn du dein Profil schickst.', warn: false, send: true });
    expect(ocsBar(view(), her, LETAS, LETAS_OOM, 'ready', { kind: 'oomMissing' }, 'en', app)).toMatchObject({ text: 'You aren’t on this Order of Merit (or not in this season’s): nothing of it was read.', warn: true, send: true });
    expect(ocsBar(view(), her, LETAS, LETAS_PROFILE, 'ready', { kind: 'noResults' }, 'en', app)).toMatchObject({ text: 'This page shows no results of the season: nothing to send. Pick a season with tournaments.' });
    expect(ocsBar(view(), her, LETAS, LETAS_PROFILE, 'reading', { kind: 'noResults' }, 'en', app)).toMatchObject({ text: 'Reading the page …', send: false });
  });

  it('asks whose page it is, wants a connection first, and says a page changed', () => {
    expect(ocsBar(null, null, LETAS, LETAS_PROFILE, 'ready', null, 'en', app)).toMatchObject({ text: '', send: false });
    expect(ocsBar(view({ pairings: [] }), null, LETAS, LETAS_PROFILE, 'ready', null, 'en', app)).toMatchObject({ text: '[pro.pairFirst]', warn: true, send: false });
    const question = { site: LETAS, siteName: 'LET Access Series', name: 'Erika Erfunden', targets: ['Example App'] };
    expect(ocsBar(view({ question } as Partial<ProView>), her, LETAS, LETAS_PROFILE, 'ready', null, 'en', app)).toMatchObject({ ask: true, send: false, warn: true });
    expect(ocsBar(view(), her, LETAS, LETAS_PROFILE, 'changed_page', null, 'en', app)).toEqual({ text: '[rankings.changed]', warn: true, send: false, fetchAll: false, stop: false, ask: false });
  });
});

const PGA = 'https://www.pgatour.com/player/99002/max-erfunden/results';
const KF = 'https://www.pgatour.com/korn-ferry-tour/player/99002/max-erfunden/results';
const LPGA = 'https://www.lpga.com/athletes/lena-ausgedacht/99003/results';

describe('the tour window’s bar on the season pages', () => {
  it('offers Send on his Results page, no Fetch all; elsewhere where that page is', () => {
    const send = { text: 'Golf Stats Sync: send this page to Example App', warn: false, send: true, fetchAll: false, stop: false, ask: false };
    expect(seasonBar(view(), 'tour:pga_tour', PGA, 'ready', null, 'en', app)).toEqual(send);
    expect(seasonBar(view(), 'tour:pga_tour', KF, 'ready', null, 'en', app)).toEqual(send);
    expect(seasonBar(view(), 'tour:lpga', LPGA, 'ready', null, 'en', app)).toEqual(send);
    const find = { text: '[tours.findSeason]', warn: false, send: false, fetchAll: false, stop: false, ask: false };
    for (const url of ['https://www.pgatour.com/player/99002/max-erfunden', 'https://www.pgatour.com/players', 'https://www.pgatour.com/americas/player/99002/max-erfunden/results', null]) {
      expect(seasonBar(view(), 'tour:pga_tour', url, 'ready', null, 'en', app), String(url)).toEqual(find);
    }
  });

  it('speaks of the tour his page’s address names: a send to the Korn Ferry Tour from the PGA Tour’s window', () => {
    const last = { at: '2026-11-25T10:00:00Z', site: 'tour:korn_ferry' as const, status: 'sent' as const, tournaments: 3 };
    const v = view({ pairings: [pairing(last)] });
    expect(seasonBar(v, 'tour:pga_tour', KF, 'done', null, 'en', app)).toMatchObject({ text: 'Sent to Example App.', send: false });
  });

  it('says what a read found in the extension’s words and keeps Send for another pick; nothing while reading', () => {
    expect(seasonBar(view(), 'tour:pga_tour', PGA, 'ready', 'otherTour', 'en', app)).toMatchObject({ text: 'Golf Stats Sync doesn’t read this tour: nothing of it was read.', warn: true, send: true });
    expect(seasonBar(view(), 'tour:lpga', LPGA, 'ready', 'nothing', 'de', app)).toMatchObject({ text: 'Auf dieser Seite gibt es noch nichts zu schicken: kein beendetes Turnier und kein Stand.', warn: true, send: true });
    expect(seasonBar(view(), 'tour:lpga', LPGA, 'reading', 'nothing', 'en', app)).toMatchObject({ text: 'Reading the page …', send: false });
    expect(seasonBar(view(), 'tour:lpga', LPGA, 'error', null, 'en', app)).toMatchObject({ warn: true, send: true });
  });

  it('asks whose page it is, wants a connection first, and says a page changed', () => {
    expect(seasonBar(null, 'tour:pga_tour', PGA, 'ready', null, 'en', app)).toMatchObject({ text: '', send: false });
    expect(seasonBar(view({ pairings: [] }), 'tour:pga_tour', PGA, 'ready', null, 'en', app)).toMatchObject({ text: '[pro.pairFirst]', warn: true, send: false });
    const question = { site: 'tour:pga_tour', siteName: 'PGA Tour', name: 'Max Erfunden', targets: ['Example App'] };
    expect(seasonBar(view({ question } as Partial<ProView>), 'tour:pga_tour', PGA, 'ready', null, 'en', app)).toMatchObject({ ask: true, send: false, warn: true });
    expect(seasonBar(view(), 'tour:pga_tour', PGA, 'changed_page', null, 'en', app)).toEqual({ text: '[rankings.changed]', warn: true, send: false, fetchAll: false, stop: false, ask: false });
  });
});

const ALPS_PROFILE = 'https://www.alpstourgolf.com/playerprofile/TST001';

describe('the tour window’s bar on the Alps Tour', () => {
  const none = { who: 'Paul Platzhalter', read: null, totals: false, rank: null };
  const all = { who: 'Paul Platzhalter', read: 3, totals: true, rank: 4 };

  it('on his profile says which report to pick until his rounds were read, then what was read, with Send', () => {
    expect(alpsBar(view(), none, ALPS_PROFILE, 'ready', 'en', app)).toEqual({
      text: 'Pick “This Season record” under Select Report: your rounds are there. “Results” adds the par, “Order of Merit” your rank.',
      warn: false, send: true, fetchAll: false, stop: false, ask: false,
    });
    expect(alpsBar(view(), all, ALPS_PROFILE, 'ready', 'de', app)).toMatchObject({ text: '3 Turniere mit Runden gelesen, mit Par, Rang 4. Schick sie, oder wähle vorher noch einen Bericht.', send: true });
    // Nothing kept yet: the extension's line words.
    expect(alpsBar(view(), null, ALPS_PROFILE, 'ready', 'en', app)).toMatchObject({ text: 'Golf Stats Sync: send this page to Example App', send: true });
  });

  it('elsewhere on the site says where his profile is; while reading and after a send, the extension’s words', () => {
    for (const url of ['https://www.alpstourgolf.com/stats', null]) {
      expect(alpsBar(view(), all, url, 'ready', 'en', app), String(url)).toEqual({ text: '[tours.findAlps]', warn: false, send: false, fetchAll: false, stop: false, ask: false });
    }
    expect(alpsBar(view(), all, ALPS_PROFILE, 'reading', 'en', app)).toMatchObject({ text: 'Reading the page …', send: false });
    const sent = view({ pairings: [pairing({ at: '2026-11-26T10:00:00Z', site: 'tour:alps', status: 'sent', tournaments: 3 })] });
    expect(alpsBar(sent, all, ALPS_PROFILE, 'done', 'en', app)).toMatchObject({ text: 'Sent to Example App.', send: false });
    expect(alpsBar(view(), all, ALPS_PROFILE, 'error', 'en', app)).toMatchObject({ warn: true, send: true });
  });

  it('a page the module doesn’t know, a question, no connection', () => {
    expect(alpsBar(view(), all, ALPS_PROFILE, 'changed_page', 'en', app)).toMatchObject({ text: '[rankings.changed]', warn: true, send: false });
    const q = view({ question: { site: 'tour:alps', siteName: 'Alps Tour', name: 'Paul Platzhalter', targets: ['Example App'], at: '2026-11-26T10:00:00Z' } });
    expect(alpsBar(q, all, ALPS_PROFILE, 'done', 'en', app)).toMatchObject({ ask: true, send: false, warn: true });
    expect(alpsBar(view({ pairings: [] }), all, ALPS_PROFILE, 'ready', 'en', app)).toMatchObject({ text: '[pro.pairFirst]', send: false });
    expect(alpsBar(null, all, ALPS_PROFILE, 'ready', 'en', app).text).toBe('');
  });
});

describe('Fetch all on the bars of the tours whose pages show a part at a time (decision 57)', () => {
  const ALPS = 'https://www.alpstourgolf.com/playerprofile/TST001';
  const ET = 'https://www.europeantour.com/players/jonas-beispiel-99002/results/?tour=dpworld-tour';
  const LET = 'https://letaccess.com/player-profiles/990001/';
  const LET_OOM = 'https://letaccess.com/letas-order-of-merits?id=2026&oom=LO';
  const PGA_STATS = 'https://www.pgatour.com/player/99002/max-erfunden/stats';
  const idle = { view: { running: null, ended: null }, limit: false };
  const running = (family: 'alps' | 'europeantour' | 'tour:let_access' | 'pgatour') => ({ view: { running: { family, done: 2, total: 9, tab: 1 }, ended: null }, limit: false });
  const read = { who: 'Paul Platzhalter', read: null, totals: false, rank: null };

  it('offers Fetch all where the extension\'s line does (his Alps profile, any page of his on europeantour.com, her profile, Results and Stats); not without it', () => {
    expect(alpsBar(view(), read, ALPS, 'ready', 'en', app, idle)).toMatchObject({ fetchAll: true, send: true });
    // Before anything was read, the bar points to Fetch all first, as the extension's line does.
    expect(alpsBar(view(), read, ALPS, 'ready', 'en', app, idle).text).toContain('Fetch all');
    expect(etBar(view(), ET, 'ready', null, 'en', app, idle)).toMatchObject({ fetchAll: true });
    expect(ocsBar(view(), null, 'tour:let_access', LET, 'ready', null, 'en', app, idle)).toMatchObject({ fetchAll: true });
    expect(ocsBar(view(), { who: { id: '990001', name: 'Mia Muster' } } as never, 'tour:let_access', LET_OOM, 'ready', null, 'en', app, idle)).toMatchObject({ fetchAll: false, send: true });
    expect(seasonBar(view(), 'tour:pga_tour', PGA_STATS, 'ready', null, 'en', app, idle)).toMatchObject({ fetchAll: true });
    // Without Fetch all handed in (an older window), and while a read goes on: not offered.
    expect(alpsBar(view(), read, ALPS, 'ready', 'en', app)).toMatchObject({ fetchAll: false });
    expect(etBar(view(), ET, 'reading', null, 'en', app, idle)).toMatchObject({ fetchAll: false });
    // Elsewhere on the site: where his page is.
    expect(alpsBar(view(), read, 'https://www.alpstourgolf.com/stats', 'ready', 'en', app, idle)).toEqual({ text: '[tours.findAlps]', warn: false, send: false, fetchAll: false, stop: false, ask: false });
  });

  it('while a run goes on, only how far it got and Stop, in the extension\'s words', () => {
    const want = { text: 'Hole alles für dich: Schritt 2 von 9 …', warn: false, send: false, fetchAll: false, stop: true, ask: false };
    expect(alpsBar(view(), read, ALPS, 'ready', 'de', app, running('alps'))).toEqual(want);
    expect(etBar(view(), ET, 'ready', null, 'de', app, running('europeantour'))).toEqual(want);
    expect(ocsBar(view(), null, 'tour:let_access', LET_OOM, 'ready', null, 'de', app, running('tour:let_access'))).toEqual(want);
    expect(seasonBar(view(), 'tour:pga_tour', PGA_STATS, 'ready', null, 'de', app, running('pgatour'))).toEqual(want);
    // A question still comes first: it waits for his answer.
    const question = { site: 'tour:alps', siteName: 'Alps Tour', name: 'Paul Platzhalter', targets: [], at: '2026-11-26T10:00:00Z' };
    expect(alpsBar(view({ question } as unknown as Partial<ProView>), read, ALPS, 'ready', 'en', app, running('alps'))).toMatchObject({ ask: true, stop: false });
  });

  it('refused today, or stopped by a page that didn\'t answer or another player\'s: said so; a run he stopped or that ran through: the send says it', () => {
    expect(etBar(view(), ET, 'ready', null, 'en', app, { ...idle, limit: true }).text).toBe('Fetch all has run often enough today; tomorrow again.');
    const other = { view: { running: null, ended: { family: 'alps' as const, how: 'other_player' as const } }, limit: false };
    expect(alpsBar(view(), read, ALPS, 'ready', 'en', app, other)).toMatchObject({ text: 'Fetch all stopped: another player’s page opened. Nothing was sent.', warn: true, fetchAll: true });
    const sent = view({ pairings: [pairing({ at: '2026-11-26T10:00:00Z', site: 'tour:pga_tour', status: 'sent', tournaments: 3 })] });
    const missed = { view: { running: null, ended: { family: 'pgatour' as const, how: 'no_answer' as const } }, limit: false };
    expect(seasonBar(sent, 'tour:pga_tour', PGA_STATS, 'done', null, 'en', app, missed).text).toBe('Fetch all stopped: the page didn’t answer. What was read so far went out.');
    const done = { view: { running: null, ended: { family: 'pgatour' as const, how: 'done' as const } }, limit: false };
    expect(seasonBar(sent, 'tour:pga_tour', PGA_STATS, 'done', null, 'en', app, done, 'tour:pga_tour').text).toBe('Sent to Example App.');
    // Another tour's run says nothing here.
    expect(etBar(view(), ET, 'ready', null, 'en', app, other).text).not.toContain('stopped');
  });
});
