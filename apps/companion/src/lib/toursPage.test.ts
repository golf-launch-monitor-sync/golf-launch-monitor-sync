// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { europeantour, progolftour } from '@glmsync/provider-tours';
import { ET_TITLE, etResults, pgtLine, pgtProfile, pgtResult } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import {
  callFits,
  isEt,
  keptTourPage,
  onEtPage,
  onProfile,
  openInTourWindow,
  readPickMessage,
  readScript,
  readTourMessage,
  sameWindow,
  TOUR_MESSAGE,
  tourSiteOf,
  tourWindowRules,
  WINDOW_TOURS,
} from './toursPage.ts';

const PROFILE = 'https://www.progolftour.de/player-profile/99001?year=2026';
const RESULT = 'https://www.progolftour.de/tournament-details/sample-desert-open-2026';
const ASK = '0a1b2c3d4e5f60718293';
const profile = progolftour.readProfile(pgtProfile()) as progolftour.Profile;
const line = progolftour.ownLine(pgtResult(), 'Lena Beispiel') as progolftour.OwnLine;
const msg = (what: Record<string, unknown>, ask = ASK) => JSON.stringify({ glmsync: TOUR_MESSAGE, ask, ...what });
const ET_RESULTS = 'https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour';
const ET_OVERVIEW = 'https://www.europeantour.com/players/jonas-beispiel-99002/';
const etRead = europeantour.readPage(etResults(), ET_TITLE, '2026-11-25') as europeantour.EtRead;

describe('the tour window', () => {
  const top = (url: string) => tourWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: true });
  const frame = (url: string) => tourWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: false });

  it('shows the tours’ own pages, nothing else', () => {
    expect(WINDOW_TOURS).toEqual(['tour:pro_golf_tour', 'tour:dp_world', 'tour:hotelplanner']);
    expect(tourWindowRules.originWhitelist).toEqual(['*']); // every load decided here, none handed to the system
    for (const url of [PROFILE, RESULT, 'https://progolftour.de/', 'https://www.progolftour.de/order-of-merit-en', 'about:blank', ET_RESULTS, 'https://www.europeantour.com/hotelplanner-tour/players/', 'https://europeantour.com/']) {
      expect(top(url), url).toBe(true);
    }
    // The tours read in the extension only, so far (the LET's, the season pages): not the window's.
    for (const url of ['http://www.progolftour.de/', 'https://www.progolftour.de.evil.test/', 'https://www.owgr.com/', 'http://www.europeantour.com/players/x-1/', 'https://www.europeantour.com.evil.test/', 'https://letaccess.com/', 'https://www.pgatour.com/', 'intent://x', 'javascript:alert(1)']) {
      expect(top(url), url).toBe(false);
    }
    // A frame of the page (a consent banner, a video) over https loads in the page, never in the system's browser.
    expect([frame('https://consent.example/'), frame('about:srcdoc'), frame('http://consent.example/')]).toEqual([true, true, false]);
    expect([openInTourWindow(RESULT), openInTourWindow('https://sponsor.example/'), openInTourWindow('about:blank'), openInTourWindow(7)]).toEqual([RESULT, null, null, null]);
  });

  it('knows the tour of a page and his profile among its pages', () => {
    expect([tourSiteOf(PROFILE), tourSiteOf('https://www.owgr.com/'), tourSiteOf(null), tourSiteOf('x'.repeat(5000))]).toEqual(['tour:pro_golf_tour', null, null, null]);
    // The LET's sites the extension reads; the window doesn't (yet): no page of theirs is the window's.
    expect([tourSiteOf('https://letaccess.com/player-profiles/911221/'), tourSiteOf('https://ladieseuropeantour.com/')]).toEqual([null, null]);
    expect([onProfile(PROFILE), onProfile(RESULT), onProfile('https://evil.test/player-profile/1')]).toEqual([true, false, false]);
    expect([keptTourPage(PROFILE), keptTourPage(RESULT), keptTourPage(`${PROFILE}&x=${'a'.repeat(3000)}`), keptTourPage(42)]).toEqual([PROFILE, null, null, null]);
  });

  it('on europeantour.com: the tour the address names, his page of either tour, one window for both', () => {
    // One host for two tours: the address's tour, else the site's own default (not whichever tour was listed last).
    expect([tourSiteOf(ET_RESULTS), tourSiteOf(ET_OVERVIEW), tourSiteOf(`${ET_OVERVIEW}stats?tour=dpworld-tour`), tourSiteOf('https://www.europeantour.com/hotelplanner-tour/players/')]).toEqual([
      'tour:hotelplanner', 'tour:dp_world', 'tour:dp_world', 'tour:dp_world',
    ]);
    expect([isEt('tour:dp_world'), isEt('tour:hotelplanner'), isEt('tour:pro_golf_tour'), isEt(null)]).toEqual([true, true, false, false]);
    expect([onEtPage(ET_RESULTS), onEtPage(ET_OVERVIEW), onEtPage('https://www.europeantour.com/dpworld-tour/players/'), onEtPage('https://www.europeantour.com.evil.test/players/x-1/'), onEtPage(PROFILE)]).toEqual([true, true, false, false, false]);
    // His page opens the window of either tour (both are on it); his tour profile elsewhere doesn't.
    expect([sameWindow(ET_RESULTS, 'tour:dp_world'), sameWindow(ET_RESULTS, 'tour:hotelplanner'), sameWindow(PROFILE, 'tour:dp_world'), sameWindow(ET_RESULTS, 'tour:pro_golf_tour'), sameWindow(PROFILE, 'tour:pro_golf_tour')]).toEqual([
      true, true, false, false, true,
    ]);
    expect([keptTourPage(ET_RESULTS), keptTourPage('https://www.europeantour.com/hotelplanner-tour/players/'), onProfile(ET_RESULTS)]).toEqual([ET_RESULTS, null, false]);
  });
});

describe('asking the page script to read', () => {
  it('calls only the page script’s function, with an ask and his name the app made', () => {
    const s = readScript(ASK, 'Lena Beispiel') as string;
    expect(s).toContain('"__glmsyncReadTour"');
    expect(s).toContain('"Lena Beispiel"');
    expect(readScript(ASK, null)).toContain(',null)');
    // Nothing that could break out of the call.
    for (const [a, w] of [['x', null], [ASK, 'a'], [ASK, '"x\n'], [ASK, 'x'.repeat(121)]] as const) expect(readScript(a, w), String(w)).toBeNull();
    expect(readScript(ASK, 'O’Neill "the" Example')).toContain(JSON.stringify('O’Neill "the" Example'));
    expect([callFits(ASK, null), callFits(ASK, 'Lena'), callFits(ASK, 7), callFits('nope', null)]).toEqual([true, true, false, false]);
  });

  it('hands in the player’s day, and only a day', () => {
    expect(readScript(ASK, null, '2026-11-25')).toContain(',null,"2026-11-25")');
    expect(readScript(ASK, null)).toContain(',null,null)');
    for (const bad of ['25.11.2026', '2026-11-25"', 'x']) expect(readScript(ASK, null, bad), bad).toBeNull();
    expect([callFits(ASK, null, '2026-11-25'), callFits(ASK, null, undefined), callFits(ASK, null, null), callFits(ASK, null, '1.1.2026'), callFits(ASK, null, 7)]).toEqual([true, true, true, false, false]);
  });
});

describe('what the window takes from a page', () => {
  it('his profile, only from the profile the window shows', () => {
    expect(readTourMessage(PROFILE, msg({ profile }), ASK)).toEqual({ ok: true, profile });
    // Someone else's profile posted meanwhile, or a profile on a tournament page: not taken.
    expect(readTourMessage('https://www.progolftour.de/player-profile/12345', msg({ profile }), ASK)).toBeNull();
    expect(readTourMessage(RESULT, msg({ profile }), ASK)).toBeNull();
    expect(readTourMessage(PROFILE, msg({ profile: { ...profile, player_id: 'X Y' } }), ASK)).toBeNull();
  });

  it('his line, only of the tournament the window shows', () => {
    expect(readTourMessage(RESULT, msg({ key: line.key, line }), ASK)).toEqual({ ok: true, key: line.key, line });
    expect(readTourMessage('https://www.progolftour.de/tournament-details/other', msg({ key: line.key, line }), ASK)).toBeNull();
    expect(readTourMessage(RESULT, msg({ key: line.key, line: { ...line, key: 'other' } }), ASK)).toBeNull();
    expect(readTourMessage(RESULT, msg({ key: line.key, line: { ...line, rounds: [] } }), ASK)).toBeNull();
    expect(readTourMessage(RESULT, msg({ key: line.key, unread: 'not_him' }), ASK)).toEqual({ ok: true, key: line.key, unread: 'not_him' });
    expect(readTourMessage(RESULT, msg({ key: line.key, unread: 'boom' }), ASK)).toBeNull();
  });

  it('only an answer to the open ask, from the tour’s site, in its shape', () => {
    expect(readTourMessage(PROFILE, msg({ why: 'changed_page' }), ASK)).toEqual({ ok: false, why: 'changed_page' });
    expect(readTourMessage(PROFILE, msg({ why: 'not_player_page' }), ASK)).toEqual({ ok: false, why: 'not_player_page' });
    expect(readTourMessage(PROFILE, msg({ profile }, 'ffffffffffffffffffff'), ASK)).toBeNull();
    expect(readTourMessage(PROFILE, msg({ profile }), null)).toBeNull();
    expect(readTourMessage('https://evil.test/player-profile/99001', msg({ profile }), ASK)).toBeNull();
    expect(readTourMessage(PROFILE, JSON.stringify({ glmsync: 'ranking-page', ask: ASK, profile }), ASK)).toBeNull();
    for (const bad of ['{', 'null', '7', 'x'.repeat(1_000_001), { profile }]) expect(readTourMessage(PROFILE, bad, ASK)).toBeNull();
  });

  it('on europeantour.com, what his page showed, only of the player whose page the window shows', () => {
    expect(readTourMessage(ET_RESULTS, msg({ read: etRead }), ASK)).toEqual({ ok: true, et: europeantour.checkRead(etRead) });
    // His other parts are the same player's page.
    expect(readTourMessage(ET_OVERVIEW, msg({ read: etRead }), ASK)).toMatchObject({ ok: true });
    // Another player's page shown meanwhile, a read that doesn't hold, a read from a page that isn't his: not taken.
    expect(readTourMessage('https://www.europeantour.com/players/otto-erfunden-12345/results', msg({ read: etRead }), ASK)).toBeNull();
    expect(readTourMessage(ET_RESULTS, msg({ read: { ...etRead, player_id: 'x' } }), ASK)).toBeNull();
    expect(readTourMessage(ET_RESULTS, msg({ read: 'everything' }), ASK)).toBeNull();
    expect(readTourMessage('https://www.europeantour.com/dpworld-tour/players/', msg({ read: etRead }), ASK)).toBeNull();
    expect(readTourMessage(PROFILE, msg({ read: etRead }), ASK)).toBeNull();
    // The Pro Golf Tour's shapes mean nothing there.
    expect(readTourMessage(ET_RESULTS, msg({ profile }), ASK)).toBeNull();
    expect(readTourMessage(ET_RESULTS, msg({ why: 'changed_page' }), ASK)).toEqual({ ok: false, why: 'changed_page' });
  });

  it('that he picked in the page’s select: only from his page there, only in exactly that shape', () => {
    const picked = JSON.stringify({ glmsync: TOUR_MESSAGE, picked: true });
    expect(readPickMessage(ET_RESULTS, picked)).toBe(true);
    expect(readPickMessage(PROFILE, picked)).toBe(false);
    expect(readPickMessage('https://www.europeantour.com/dpworld-tour/players/', picked)).toBe(false);
    for (const bad of [
      JSON.stringify({ glmsync: TOUR_MESSAGE, picked: 'yes' }),
      JSON.stringify({ glmsync: 'ranking-page', picked: true }),
      JSON.stringify({ glmsync: TOUR_MESSAGE, picked: true, read: etRead }),
      JSON.stringify([TOUR_MESSAGE]),
      '{',
      'x'.repeat(201),
      { glmsync: TOUR_MESSAGE, picked: true },
    ]) {
      expect(readPickMessage(ET_RESULTS, bad), String(bad).slice(0, 60)).toBe(false);
    }
  });

  it('a line of another player is never what the page script hands on', () => {
    // The page script runs ownLine itself; this checks what the module gives it for a page without his line.
    expect(progolftour.ownLine(pgtResult('x', [pgtLine('1', 'Otto Erfunden', 66, 67, 68)]), 'Lena Beispiel')).toEqual({ kind: 'unread', why: 'not_him' });
  });
});
