// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { europeantour, lpga, ocs, pgatour, progolftour, type TourPage } from '@glmsync/provider-tours';
import { ET_TITLE, etResults, lpgaFigures, lpgaResults, ocsOom, ocsProfile, pgaFigures, pgaResults, pgtLine, pgtProfile, pgtResult } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import {
  callFits,
  isEt,
  isOcs,
  isSeason,
  keptTourPage,
  ocsProfileUrl,
  onEtPage,
  onOcsOom,
  onOcsProfile,
  onProfile,
  onSeasonResults,
  openInTourWindow,
  readMovedMessage,
  readPickMessage,
  readScript,
  readTourMessage,
  sameWindow,
  TOUR_MESSAGE,
  tourSiteOf,
  tourWindowRules,
  watchedSite,
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
    expect(WINDOW_TOURS).toEqual(['tour:pro_golf_tour', 'tour:dp_world', 'tour:hotelplanner', 'tour:let', 'tour:let_access', 'tour:pga_tour', 'tour:korn_ferry', 'tour:lpga', 'tour:epson']);
    expect(tourWindowRules.originWhitelist).toEqual(['*']); // every load decided here, none handed to the system
    for (const url of [PROFILE, RESULT, 'https://progolftour.de/', 'https://www.progolftour.de/order-of-merit-en', 'about:blank', ET_RESULTS, 'https://www.europeantour.com/hotelplanner-tour/players/', 'https://europeantour.com/', 'https://letaccess.com/players', 'https://ladieseuropeantour.com/player-profiles/990001/', 'https://www.pgatour.com/', 'https://pgatour.com/korn-ferry-tour/players', 'https://www.lpga.com/athletes/directory', 'https://www.epsontour.com/']) {
      expect(top(url), url).toBe(true);
    }
    // Only over https, only the sites themselves; any other site (a world ranking's, a sponsor's) not in this window.
    for (const url of ['http://www.progolftour.de/', 'https://www.progolftour.de.evil.test/', 'https://www.owgr.com/', 'http://www.europeantour.com/players/x-1/', 'https://www.europeantour.com.evil.test/', 'http://letaccess.com/', 'https://letaccess.com.evil.test/', 'https://www.letaccess.com/', 'http://www.pgatour.com/', 'https://www.pgatour.com.evil.test/', 'https://tourcast.pgatour.com/', 'http://www.lpga.com/', 'https://www.lpga.com.evil.test/', 'intent://x', 'javascript:alert(1)']) {
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

const LETAS_PROFILE = 'https://letaccess.com/player-profiles/990001/';
const LETAS_OOM = 'https://letaccess.com/letas-order-of-merits?id=2026&oom=LO';
const LET_PROFILE = 'https://ladieseuropeantour.com/player-profiles/990001/';
const LET_OOM = 'https://ladieseuropeantour.com/order-of-merit?id=2026&oom=PT';
const ocsRead = ocs.readProfile(ocsProfile()) as ocs.Profile;
const ocsLine = ocs.readOom(ocsOom(), '990001') as ocs.OomLine;

describe('the tour window on the LET and the LET Access Series', () => {
  it('each site a tour of its own, her profile and the Order of Merit among its pages', () => {
    // As the module and the extension: the sites as they are, without a www in front.
    expect([tourSiteOf(LETAS_PROFILE), tourSiteOf(LET_OOM), tourSiteOf('https://www.letaccess.com/players')]).toEqual(['tour:let_access', 'tour:let', null]);
    expect([isOcs('tour:let'), isOcs('tour:let_access'), isOcs('tour:dp_world'), isOcs(null)]).toEqual([true, true, false, false]);
    expect([onOcsProfile(LETAS_PROFILE), onOcsProfile(LET_PROFILE), onOcsProfile(LETAS_OOM), onOcsProfile('https://letaccess.com.evil.test/player-profiles/990001/'), onOcsProfile(PROFILE)]).toEqual([true, true, false, false, false]);
    expect([onOcsOom(LETAS_OOM), onOcsOom(LET_OOM), onOcsOom(LETAS_PROFILE), onOcsOom('https://letaccess.com/players')]).toEqual([true, true, false, false]);
    // One window per tour: the LET's profile isn't the LET Access Series' window.
    expect([sameWindow(LETAS_PROFILE, 'tour:let_access'), sameWindow(LET_PROFILE, 'tour:let_access'), sameWindow(LET_PROFILE, 'tour:let')]).toEqual([true, false, true]);
  });

  it('keeps her profile to open the window there next time, never the Order of Merit', () => {
    expect([keptTourPage(LETAS_PROFILE), keptTourPage(LETAS_OOM), keptTourPage('https://letaccess.com/players')]).toEqual([LETAS_PROFILE, null, null]);
    expect([ocsProfileUrl('tour:let', '990001'), ocsProfileUrl('tour:let_access', '990001'), ocsProfileUrl('tour:let', '../x')]).toEqual([LET_PROFILE, LETAS_PROFILE, null]);
  });

  it('takes her profile only from the profile the window shows, on its own tour', () => {
    expect(readTourMessage(LETAS_PROFILE, msg({ ocs: ocsRead }), ASK)).toEqual({ ok: true, ocs: ocsRead });
    // Another player's profile shown meanwhile, or the profile of the other tour: nothing.
    expect(readTourMessage('https://letaccess.com/player-profiles/990011/', msg({ ocs: ocsRead }), ASK)).toBeNull();
    expect(readTourMessage(LET_PROFILE, msg({ ocs: ocsRead }), ASK)).toBeNull();
    // A line of the Order of Merit from her profile, a profile from the Order of Merit, or a read from the players' list: nothing.
    expect(readTourMessage(LETAS_PROFILE, msg({ ocs: ocsLine }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_OOM, msg({ ocs: ocsRead }), ASK)).toBeNull();
    expect(readTourMessage('https://letaccess.com/players', msg({ ocs: ocsRead }), ASK)).toBeNull();
    // Not the module's shape, or another of the page script's answers in its place.
    expect(readTourMessage(LETAS_PROFILE, msg({ ocs: { ...ocsRead, player_id: 'x' } }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_PROFILE, msg({ profile }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_PROFILE, msg({ read: etRead }), ASK)).toBeNull();
  });

  it('takes a line only from that tour’s Order of Merit; why a page wasn’t read; nothing of theirs elsewhere', () => {
    expect(readTourMessage(LETAS_OOM, msg({ ocs: ocsLine }), ASK)).toEqual({ ok: true, ocs: ocsLine });
    expect(readTourMessage(LET_OOM, msg({ ocs: ocsLine }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_OOM, msg({ ocsUnread: 'not_him' }), ASK)).toEqual({ ok: true, ocsUnread: 'not_him' });
    expect(readTourMessage(LETAS_PROFILE, msg({ ocsUnread: 'no_result' }), ASK)).toEqual({ ok: true, ocsUnread: 'no_result' });
    expect(readTourMessage(LETAS_PROFILE, msg({ ocsUnread: 'gone' }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_PROFILE, msg({ why: 'changed_page' }), ASK)).toEqual({ ok: false, why: 'changed_page' });
    expect(readTourMessage(LETAS_PROFILE, msg({ ocs: ocsRead }, 'ffffffffffffffff'), ASK)).toBeNull();
    // A read of the LET's sites from any other tour's page: nothing.
    expect(readTourMessage(PROFILE, msg({ ocs: ocsRead }), ASK)).toBeNull();
    expect(readTourMessage(ET_RESULTS, msg({ ocsUnread: 'no_result' }), ASK)).toBeNull();
  });

  it('that the address changed: only from their pages, only in exactly that shape', () => {
    const moved = JSON.stringify({ glmsync: TOUR_MESSAGE, moved: true });
    expect([readMovedMessage(LETAS_PROFILE, moved), readMovedMessage('https://ladieseuropeantour.com/players', moved)]).toEqual([true, true]);
    expect(readMovedMessage(ET_RESULTS, moved)).toBe(false);
    expect(readMovedMessage(PROFILE, moved)).toBe(false);
    for (const data of [JSON.stringify({ glmsync: TOUR_MESSAGE, moved: 1 }), JSON.stringify({ glmsync: TOUR_MESSAGE, moved: true, url: 'x' }), JSON.stringify({ glmsync: 'x', moved: true }), '[1]', 'nope', 7, 'x'.repeat(300)]) {
      expect(readMovedMessage(LETAS_PROFILE, data), String(data)).toBe(false);
    }
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

const PGA = 'https://www.pgatour.com/player/99002/max-erfunden/results';
const KF = 'https://www.pgatour.com/korn-ferry-tour/player/99002/max-erfunden/results';
const LPGA = 'https://www.lpga.com/athletes/lena-ausgedacht/99003/results';
const EPSON = 'https://www.epsontour.com/athletes/lena-ausgedacht/99003/results';
const pgaPage = (pgatour.readResults(pgaResults(), pgaFigures(), '2026-11-25') as { kind: 'page'; page: TourPage }).page;
const lpgaPage = (lpga.readResults(lpgaResults(), lpgaFigures(), '2026-11-25') as { kind: 'page'; page: TourPage }).page;

describe('the tour window on the season pages (PGA Tour, Korn Ferry, LPGA, Epson)', () => {
  it('knows each tour by its site and the address, his Results page among their pages', () => {
    // pgatour.com is one site for two tours: the address's, else the PGA Tour; its other tours' pages are the PGA Tour's window's.
    expect([tourSiteOf(PGA), tourSiteOf(KF), tourSiteOf('https://www.pgatour.com/korn-ferry-tour/players'), tourSiteOf('https://www.pgatour.com/players'), tourSiteOf('https://www.pgatour.com/americas/player/99002/max-erfunden/results'), tourSiteOf(LPGA), tourSiteOf(EPSON)]).toEqual([
      'tour:pga_tour', 'tour:korn_ferry', 'tour:korn_ferry', 'tour:pga_tour', 'tour:pga_tour', 'tour:lpga', 'tour:epson',
    ]);
    expect([isSeason('tour:pga_tour'), isSeason('tour:korn_ferry'), isSeason('tour:lpga'), isSeason('tour:epson'), isSeason('tour:let'), isSeason(null)]).toEqual([true, true, true, true, false, false]);
    expect([onSeasonResults(PGA), onSeasonResults(KF), onSeasonResults(LPGA), onSeasonResults(EPSON), onSeasonResults(`${PGA}?season=2025`)]).toEqual([true, true, true, true, true]);
    // His other pages, a tour the module doesn't read, the players' list, another site's look-alike: no Send.
    for (const url of ['https://www.pgatour.com/player/99002/max-erfunden', 'https://www.pgatour.com/americas/player/99002/max-erfunden/results', 'https://www.pgatour.com/pgatour-champions/player/99002/max-erfunden/results', 'https://www.lpga.com/athletes/directory', 'https://www.lpga.com.evil.test/athletes/x/1/results', PROFILE, null]) {
      expect(onSeasonResults(url), String(url)).toBe(false);
    }
  });

  it('one window for pgatour.com’s two tours; keeps his Results page to open there next time', () => {
    expect([sameWindow(KF, 'tour:pga_tour'), sameWindow(PGA, 'tour:korn_ferry'), sameWindow(LPGA, 'tour:epson'), sameWindow(EPSON, 'tour:epson'), sameWindow(PGA, 'tour:lpga')]).toEqual([true, true, false, true, false]);
    expect([keptTourPage(PGA), keptTourPage(KF), keptTourPage(LPGA), keptTourPage('https://www.pgatour.com/players'), keptTourPage('https://www.pgatour.com/americas/player/99002/max-erfunden/results')]).toEqual([PGA, KF, LPGA, null, null]);
  });

  it('takes a season only from his Results page, only his, only of a tour of that site', () => {
    expect(readTourMessage(PGA, msg({ season: pgaPage }), ASK)).toEqual({ ok: true, season: pgaPage });
    expect(readTourMessage(LPGA, msg({ season: lpgaPage }), ASK)).toEqual({ ok: true, season: lpgaPage });
    // His page picked on the Korn Ferry Tour while the address still says PGA Tour (the page's picker decides): his.
    const kf = { ...pgaPage, site: 'tour:korn_ferry', ranking: { ...pgaPage.ranking, source: 'tour:korn_ferry' } };
    expect(readTourMessage(PGA, msg({ season: kf }), ASK)).toMatchObject({ ok: true, season: { site: 'tour:korn_ferry' } });
    // Another player's page shown meanwhile, a tour of another site, his other pages, or another tour's window: nothing.
    expect(readTourMessage('https://www.pgatour.com/player/99012/otto-erfunden/results', msg({ season: pgaPage }), ASK)).toBeNull();
    expect(readTourMessage(EPSON, msg({ season: lpgaPage }), ASK)).toBeNull();
    expect(readTourMessage(PGA, msg({ season: lpgaPage }), ASK)).toBeNull();
    expect(readTourMessage('https://www.pgatour.com/player/99002/max-erfunden', msg({ season: pgaPage }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_PROFILE, msg({ season: pgaPage }), ASK)).toBeNull();
    expect(readTourMessage(PROFILE, msg({ season: pgaPage }), ASK)).toBeNull();
    // Not a page in the module's shape, another ask's answer, or another of the page script's answers in its place.
    expect(readTourMessage(PGA, msg({ season: { ...pgaPage, id: '../x' } }), ASK)).toBeNull();
    expect(readTourMessage(PGA, msg({ season: pgaPage }, 'ffffffffffffffffffff'), ASK)).toBeNull();
    expect(readTourMessage(PGA, msg({ ocs: ocsRead }), ASK)).toBeNull();
    expect(readTourMessage(PGA, msg({ profile }), ASK)).toBeNull();
    expect(readTourMessage(PGA, msg({ read: etRead }), ASK)).toBeNull();
  });

  it('why his page gave nothing, and why it isn’t one', () => {
    expect(readTourMessage(PGA, msg({ seasonUnread: 'other_tour' }), ASK)).toEqual({ ok: true, seasonUnread: 'other_tour' });
    expect(readTourMessage(LPGA, msg({ seasonUnread: 'nothing' }), ASK)).toEqual({ ok: true, seasonUnread: 'nothing' });
    expect(readTourMessage(PGA, msg({ seasonUnread: 'changed_page' }), ASK)).toBeNull();
    expect(readTourMessage(LETAS_PROFILE, msg({ seasonUnread: 'nothing' }), ASK)).toBeNull();
    expect(readTourMessage(PGA, msg({ why: 'changed_page' }), ASK)).toEqual({ ok: false, why: 'changed_page' });
    expect(readTourMessage('https://www.pgatour.com/players', msg({ why: 'not_player_page' }), ASK)).toEqual({ ok: false, why: 'not_player_page' });
  });

  it('their address is watched by the page script, as the LET’s', () => {
    expect([watchedSite(PGA), watchedSite('https://www.pgatour.com/'), watchedSite(LPGA), watchedSite(EPSON), watchedSite(LETAS_PROFILE), watchedSite(ET_RESULTS), watchedSite(PROFILE)]).toEqual([true, true, true, true, true, false, false]);
    const moved = JSON.stringify({ glmsync: TOUR_MESSAGE, moved: true });
    expect([readMovedMessage(PGA, moved), readMovedMessage('https://www.lpga.com/', moved), readMovedMessage(ET_RESULTS, moved), readMovedMessage('https://www.owgr.com/', moved)]).toEqual([true, true, false, false]);
  });
});
