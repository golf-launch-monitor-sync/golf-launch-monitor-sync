// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it, vi } from 'vitest';
import {
  askId,
  callFits,
  dayOf,
  keptPage,
  onRankingSite,
  openInRankingsWindow,
  RANKING_MESSAGE,
  rankingsWindowRules,
  readRankingMessage,
  readScript,
  SITES,
} from './rankingsPage.ts';

const OWGR = 'https://www.owgr.com/playerprofile/matt-example-17646';
const ROLEX = 'https://www.rolexrankings.com/players/4711';
const ASK = '0a1b2c3d4e5f60718293';
const page = (over: Record<string, unknown> = {}) => ({
  site: 'owgr',
  id: '17646',
  name: 'Matt Example',
  ranking: { source: 'owgr', as_of: '2026-11-25', rank: 3, points: 7.12, events: 47 },
  tournaments: [{ ref: 'owgr-9001', week: '2026-W47', tour: 'dp_world', name: 'Example Open', place: 17, tied: true, points: 4.1 }],
  ...over,
});
const msg = (over: Record<string, unknown> = {}) => JSON.stringify({ glmsync: RANKING_MESSAGE, ask: ASK, page: page(), ...over });

describe('the world ranking window', () => {
  const top = (url: string) => rankingsWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: true });
  const frame = (url: string) => rankingsWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: false });

  it('shows the two sites’ own pages, nothing else', () => {
    expect(rankingsWindowRules.originWhitelist).toEqual(['*']); // every load decided here, none handed to the system
    for (const url of [OWGR, ROLEX, SITES.owgr.start, SITES.rolex.start, 'https://owgr.com/', 'https://rolexrankings.com/', 'about:blank']) expect(top(url), url).toBe(true);
    for (const url of [
      'http://www.owgr.com/',
      'https://www.owgr.com.evil.test/',
      'https://evilowgr.com/',
      'https://www.pgatour.com/',
      'https://evil.test/?https://www.owgr.com/',
      'javascript:alert(1)',
      'intent://x',
    ])
      expect(top(url), url).toBe(false);
  });

  it('lets a page’s frames load over https only', () => {
    expect(frame('https://cdn.cookielaw.org/consent/x.html')).toBe(true);
    expect(frame('about:srcdoc')).toBe(true);
    expect(frame('http://cdn.example.org/x')).toBe(false);
    expect(frame('file:///etc/passwd')).toBe(false);
  });

  it('opens a new window of the site in this one, anything else nowhere', () => {
    expect(openInRankingsWindow(ROLEX)).toBe(ROLEX);
    expect(openInRankingsWindow('https://www.lpga.com/')).toBeNull();
    expect(openInRankingsWindow('about:blank')).toBeNull();
    expect(openInRankingsWindow(42)).toBeNull();
  });

  it('knows the sites by host only, over https', () => {
    expect(onRankingSite(OWGR)).toBe(true);
    expect(onRankingSite('https://www.rolexrankings.com/rankings?x=1')).toBe(true);
    expect(onRankingSite('http://www.owgr.com/')).toBe(false);
    expect(onRankingSite('https://www.owgr.com.evil.test/')).toBe(false);
    expect(onRankingSite(null)).toBe(false);
    expect(onRankingSite(`https://www.owgr.com/${'x'.repeat(5000)}`)).toBe(false);
  });
});

describe('asking the page script to read', () => {
  it('calls only the page script’s function, with an ask and a day it checks', () => {
    const s = readScript(ASK, '2026-11-25');
    expect(s).toContain('__glmsyncReadRanking');
    expect(s).toContain(ASK);
    expect(s?.trimEnd().endsWith('true;')).toBe(true);
    // Nothing of a caller's own gets into the script.
    expect(readScript('x");alert(1);("', '2026-11-25')).toBeNull();
    expect(readScript(ASK, '25.11.2026')).toBeNull();
    expect(callFits(ASK, '2026-11-25')).toBe(true);
    expect(callFits('short', '2026-11-25')).toBe(false);
    expect(callFits(ASK, 20261125)).toBe(false);
  });

  it('makes a new ask each time, and the player’s day on the phone’s clock', () => {
    let n = 0;
    const random = (k: number) => Uint8Array.from({ length: k }, () => n++);
    const a = askId(random);
    expect(a).toMatch(/^[0-9a-f]{18}$/);
    expect(askId(random)).not.toBe(a);
    expect(askId()).toMatch(/^[0-9a-f]{18}$/); // the runtime's own source
    // Without one (Hermes may have none), still an ask.
    vi.stubGlobal('crypto', undefined);
    try {
      expect(askId()).toMatch(/^[0-9a-f]{18}$/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(dayOf(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('a message from the window', () => {
  it('is taken from the player’s own page, answering the open ask, read again strictly', () => {
    const got = readRankingMessage(OWGR, msg(), ASK);
    expect(got).toEqual({ ok: true, page: page() });
  });

  it('says why nothing was read: not a player’s page, or a page this app doesn’t know', () => {
    expect(readRankingMessage(SITES.owgr.start, msg({ page: undefined, why: 'not_player_page' }), ASK)).toEqual({ ok: false, why: 'not_player_page' });
    expect(readRankingMessage(OWGR, msg({ page: undefined, why: 'changed_page' }), ASK)).toEqual({ ok: false, why: 'changed_page' });
    // A page posted from anywhere but a player's page is none.
    expect(readRankingMessage(SITES.owgr.start, msg(), ASK)).toEqual({ ok: false, why: 'not_player_page' });
  });

  it('is never one the app didn’t ask for, nor from anywhere else', () => {
    expect(readRankingMessage(OWGR, msg(), null)).toBeNull(); // no ask open
    expect(readRankingMessage(OWGR, msg({ ask: 'ffffffffffffffffff' }), ASK)).toBeNull(); // another ask
    expect(readRankingMessage('https://evil.test/playerprofile/matt-example-17646', msg(), ASK)).toBeNull();
    expect(readRankingMessage(OWGR, msg({ glmsync: 'golfde-seen' }), ASK)).toBeNull();
    expect(readRankingMessage(OWGR, 'not json', ASK)).toBeNull();
    expect(readRankingMessage(OWGR, { glmsync: RANKING_MESSAGE }, ASK)).toBeNull();
    expect(readRankingMessage(OWGR, 'x'.repeat(1_000_001), ASK)).toBeNull();
  });

  it('takes only the page the window shows: another player’s, a page that isn’t one, is dropped', () => {
    expect(readRankingMessage(OWGR, msg({ page: page({ id: '99' }) }), ASK)).toBeNull(); // the window moved on
    expect(readRankingMessage(ROLEX, msg(), ASK)).toBeNull(); // OWGR's page from Rolex's window
    expect(readRankingMessage(OWGR, msg({ page: page({ ranking: { source: 'owgr', as_of: '2026-11-25' } }) }), ASK)).toBeNull(); // no figure
    expect(readRankingMessage(OWGR, msg({ page: page({ name: 'X' }) }), ASK)).toBeNull();
    // What doesn't fit inside a page is dropped, the rest goes.
    const odd = readRankingMessage(OWGR, msg({ page: page({ tournaments: [{ ref: 'rolex-1', week: '2026-W47' }, { ref: 'owgr-2', week: '2026-W99' }, { ref: 'owgr-3', week: '2026-W46', tour: 'moon' }] }) }), ASK);
    expect(odd).toEqual({ ok: true, page: page({ tournaments: [{ ref: 'owgr-3', week: '2026-W46' }] }) });
  });
});

describe('the page kept for next time', () => {
  it('is only ever a player’s page of the two sites', () => {
    expect(keptPage(OWGR)).toBe(OWGR);
    expect(keptPage(ROLEX)).toBe(ROLEX);
    expect(keptPage(SITES.owgr.start)).toBeNull();
    expect(keptPage('https://evil.test/players/1')).toBeNull();
    expect(keptPage(null)).toBeNull();
  });
});
