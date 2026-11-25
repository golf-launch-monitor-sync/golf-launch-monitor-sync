// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { progolftour } from '@glmsync/provider-tours';
import { pgtLine, pgtProfile, pgtResult } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import {
  callFits,
  keptTourPage,
  onProfile,
  openInTourWindow,
  readScript,
  readTourMessage,
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

describe('the tour window', () => {
  const top = (url: string) => tourWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: true });
  const frame = (url: string) => tourWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: false });

  it('shows the tours’ own pages, nothing else', () => {
    expect(WINDOW_TOURS).toEqual(['tour:pro_golf_tour']);
    expect(tourWindowRules.originWhitelist).toEqual(['*']); // every load decided here, none handed to the system
    for (const url of [PROFILE, RESULT, 'https://progolftour.de/', 'https://www.progolftour.de/order-of-merit-en', 'about:blank']) expect(top(url), url).toBe(true);
    // europeantour.com's tours are read in the extension only, so far: not the window's.
    for (const url of ['http://www.progolftour.de/', 'https://www.progolftour.de.evil.test/', 'https://www.owgr.com/', 'https://www.europeantour.com/players/x-1/', 'intent://x', 'javascript:alert(1)']) {
      expect(top(url), url).toBe(false);
    }
    // A frame of the page (a consent banner, a video) over https loads in the page, never in the system's browser.
    expect([frame('https://consent.example/'), frame('about:srcdoc'), frame('http://consent.example/')]).toEqual([true, true, false]);
    expect([openInTourWindow(RESULT), openInTourWindow('https://sponsor.example/'), openInTourWindow('about:blank'), openInTourWindow(7)]).toEqual([RESULT, null, null, null]);
  });

  it('knows the tour of a page and his profile among its pages', () => {
    expect([tourSiteOf(PROFILE), tourSiteOf('https://www.owgr.com/'), tourSiteOf(null), tourSiteOf('x'.repeat(5000))]).toEqual(['tour:pro_golf_tour', null, null, null]);
    expect([onProfile(PROFILE), onProfile(RESULT), onProfile('https://evil.test/player-profile/1')]).toEqual([true, false, false]);
    expect([keptTourPage(PROFILE), keptTourPage(RESULT), keptTourPage(`${PROFILE}&x=${'a'.repeat(3000)}`), keptTourPage(42)]).toEqual([PROFILE, null, null, null]);
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

  it('a line of another player is never what the page script hands on', () => {
    // The page script runs ownLine itself; this checks what the module gives it for a page without his line.
    expect(progolftour.ownLine(pgtResult('x', [pgtLine('1', 'Otto Erfunden', 66, 67, 68)]), 'Lena Beispiel')).toEqual({ kind: 'unread', why: 'not_him' });
  });
});
