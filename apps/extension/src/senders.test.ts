// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { accept, sourceOf } from './senders.ts';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = `chrome-extension://${ID}/`;
const tab = { id: 7 };
const from = (url: string, extra: Record<string, unknown> = {}) => sourceOf({ id: ID, url, tab, ...extra }, ID, ORIGIN);

describe('who sent a message', () => {
  it('knows the portal, the pairing page and the extension’s own pages', () => {
    expect(from('https://portal.trackmangolf.com/activities')).toBe('portal');
    expect(from('https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair#target=x&code=y')).toBe('pair-page');
    expect(from('https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair.html')).toBe('pair-page');
    expect(from('https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair/')).toBe('pair-page');
    expect(sourceOf({ id: ID, url: `${ORIGIN}popup.html` }, ID, ORIGIN)).toBe('extension');
  });

  it('knows a page’s top frame as a possible target’s page (the bridge; its origin is checked against the pairings)', () => {
    expect(from('https://app.example.org/profile', { frameId: 0 })).toBe('target-page');
    expect(from('http://localhost:8081/', { frameId: 0 })).toBe('target-page');
    expect(from('https://app.example.org/profile', { frameId: 3 })).toBe('other'); // a frame inside it
    expect(from('https://app.example.org/profile')).toBe('other');
    // The project's own site is no target.
    expect(from('https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/app.html', { frameId: 0 })).toBe('other');
    expect(sourceOf({ id: ID, url: 'https://app.example.org/', frameId: 0 }, ID, ORIGIN)).toBe('other'); // no tab
  });

  it('knows the season pages\' sites (the top frame only) and takes from there only their line, a page and the answer', () => {
    expect(from('https://www.pgatour.com/player/1/max-erfunden/results', { frameId: 0 })).toBe('season');
    expect(from('https://www.epsontour.com/', { frameId: 0 })).toBe('season');
    expect(from('https://www.lpga.com/athletes/x/1/results', { frameId: 1 })).toBe('other');
    expect(accept({ type: 'season-send', page: { site: 'tour:lpga' } }, 'season')).toEqual({ type: 'season-send', page: { site: 'tour:lpga' } });
    expect(accept({ type: 'season-send', page: { site: 'tour:lpga' } }, 'tour')).toBeNull();
    expect(accept({ type: 'season-send', page: ['x'] }, 'season')).toBeNull();
    expect(accept({ type: 'season-send', page: { big: 'x'.repeat(300_000) } }, 'season')).toBeNull();
    expect(accept({ type: 'season-line' }, 'season')).toEqual({ type: 'season-line' });
    expect(accept({ type: 'season-answer' }, 'season')).toEqual({ type: 'season-answer' });
    expect(accept({ type: 'pro-unpair', id: 'abc' }, 'season')).toBeNull();
  });

  it('knows golf.de’s pages (the top frame only) and what may come from there', () => {
    expect(from('https://www.golf.de/mein-bereich/handicap-history-sheet.html', { frameId: 0 })).toBe('golfde');
    expect(from('https://www.golf.de/mein-bereich/handicap-history-sheet.html', { frameId: 2 })).toBe('other');
    expect(from('https://golf.de/mein-bereich/', { frameId: 0 })).toBe('target-page'); // another origin: only a paired target's bridge
    expect(accept({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: { kind: 'member' } }, 'golfde')).toEqual({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: { kind: 'member' } });
    expect(accept({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: { kind: 'member' } }, 'target-page')).toBeNull();
    expect(accept({ type: 'golfde-seen', page: 'not hex!', seen: {} }, 'golfde')).toBeNull();
    expect(accept({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: 'x' }, 'golfde')).toBeNull();
    expect(accept({ type: 'golfde-send' }, 'golfde')).toEqual({ type: 'golfde-send' });
    // The LET's pages: only from their top frame, naming one of the two tours (the background checks it is this page's).
    expect(from('https://letaccess.com/player-profiles/911221/', { frameId: 0 })).toBe('ocs');
    expect(from('https://ladieseuropeantour.com/order-of-merit?id=2026', { frameId: 0 })).toBe('ocs');
    expect(from('https://letaccess.com/player-profiles/911221/', { frameId: 3 })).not.toBe('ocs');
    expect(accept({ type: 'ocs-send', site: 'tour:let' }, 'ocs')).toEqual({ type: 'ocs-send', site: 'tour:let' });
    expect(accept({ type: 'ocs-send', site: 'tour:pro_golf_tour' }, 'ocs')).toBeNull();
    expect(accept({ type: 'ocs-send', site: 'tour:let' }, 'tour')).toBeNull();
    expect(accept({ type: 'ocs-seen', site: 'tour:let_access', seen: { oom: { rank: 3 } } }, 'ocs')).toEqual({ type: 'ocs-seen', site: 'tour:let_access', seen: { oom: { rank: 3 } } });
    expect(accept({ type: 'ocs-seen', site: 'tour:let_access', seen: { other: 1 } }, 'ocs')).toBeNull();
    expect(accept({ type: 'ocs-seen', site: 'tour:let_access', seen: { profile: 'x'.repeat(70_000) } }, 'ocs')).toBeNull();
    expect(accept({ type: 'ocs-answer' }, 'ocs')).toEqual({ type: 'ocs-answer' });
    expect(accept({ type: 'pro-answer', yes: true }, 'ocs')).toBeNull();
    // The Alps Tour: its own script, only the top frame; a read only as a frame of its size.
    expect(from('https://www.alpstourgolf.com/playerprofile/VAN054', { frameId: 0 })).toBe('alps');
    expect(from('https://alpstourgolf.com/stats', { frameId: 0 })).toBe('alps');
    expect(from('https://www.alpstourgolf.com/playerprofile/VAN054', { frameId: 2 })).not.toBe('alps');
    expect(accept({ type: 'alps-seen', read: { kind: 'alps' } }, 'alps')).toEqual({ type: 'alps-seen', read: { kind: 'alps' } });
    expect(accept({ type: 'alps-seen', read: [1] }, 'alps')).toBeNull();
    expect(accept({ type: 'alps-seen', read: { x: 'x'.repeat(270_000) } }, 'alps')).toBeNull();
    expect(accept({ type: 'alps-send' }, 'alps')).toEqual({ type: 'alps-send' });
    expect(accept({ type: 'alps-send' }, 'ocs')).toBeNull();
    expect(accept({ type: 'ocs-send', site: 'tour:let' }, 'alps')).toBeNull();
    expect(accept({ type: 'hcp-unpair', id: 'abc' }, 'golfde')).toBeNull();
    expect(accept({ type: 'hcp-unpair', id: 'abc' }, 'extension')).toEqual({ type: 'hcp-unpair', id: 'abc' });
    expect(accept({ type: 'hcp-auto', auto: 'yes' }, 'extension')).toBeNull();
    // The switch for Fetch all by itself only from the extension's own pages: golf.de's scripts can't turn it on.
    expect(accept({ type: 'hcp-auto-fetch', on: false }, 'extension')).toEqual({ type: 'hcp-auto-fetch', on: false });
    expect(accept({ type: 'hcp-auto-fetch', on: true }, 'golfde')).toBeNull();
    expect(accept({ type: 'hcp-auto-fetch', on: 'yes' }, 'extension')).toBeNull();
    // The yes to golf.de's account only from the extension's own pages: golf.de's scripts reach the line on its page.
    expect(accept({ type: 'hcp-confirm', yes: true }, 'extension')).toEqual({ type: 'hcp-confirm', yes: true });
    expect(accept({ type: 'hcp-confirm', yes: true }, 'golfde')).toBeNull();
    expect(accept({ type: 'hcp-confirm', yes: 'yes' }, 'extension')).toBeNull();
    // From golf.de only the way to that page.
    expect(accept({ type: 'golfde-confirm' }, 'golfde')).toEqual({ type: 'golfde-confirm' });
    // Fetch all: only from golf.de's page (the tab that tapped drives it), never from anywhere else.
    for (const type of ['golfde-fetch-all', 'golfde-step', 'golfde-stop'] as const) {
      expect(accept({ type }, 'golfde')).toEqual({ type });
      expect(accept({ type }, 'target-page')).toBeNull();
      expect(accept({ type }, 'extension')).toBeNull();
    }
    expect(accept({ type: 'golfde-confirm' }, 'target-page')).toBeNull();
    // One tournament (spec 1.19.0): only from golf.de's top frame, one object of a tournament's size, read again later.
    const event = { id: '42', url: 'https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42', name: 'X', date: '2027-05-01' };
    expect(from('https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42', { frameId: 0 })).toBe('golfde');
    expect(from('https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42', { frameId: 2 })).toBe('other');
    expect(accept({ type: 'golfde-event-line' }, 'golfde')).toEqual({ type: 'golfde-event-line' });
    expect(accept({ type: 'golfde-event-take', target: 'abc', event }, 'golfde')).toEqual({ type: 'golfde-event-take', target: 'abc', event });
    expect(accept({ type: 'golfde-event-take', target: 'abc', event }, 'target-page')).toBeNull();
    expect(accept({ type: 'golfde-event-take', target: 'abc', event }, 'extension')).toBeNull();
    expect(accept({ type: 'golfde-event-take', target: 'abc', event: [event] }, 'golfde')).toBeNull();
    expect(accept({ type: 'golfde-event-take', target: 'x'.repeat(65), event }, 'golfde')).toBeNull();
    expect(accept({ type: 'golfde-event-take', target: 'abc', event: { ...event, name: 'x'.repeat(20_000) } }, 'golfde')).toBeNull();
  });

  it('knows a player\'s pages on europeantour.com (the top frame only) and what may come from there', () => {
    expect(from('https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour', { frameId: 0 })).toBe('europeantour');
    expect(from('https://www.europeantour.com/players/jonas-beispiel-99002/', { frameId: 1 })).toBe('other');
    // The rest of the site is no player's page: only a paired target's bridge could be there.
    expect(from('https://www.europeantour.com/dpworld-tour/players/', { frameId: 0 })).toBe('target-page');
    expect(accept({ type: 'et-seen', read: { kind: 'page' } }, 'europeantour')).toEqual({ type: 'et-seen', read: { kind: 'page' } });
    expect(accept({ type: 'et-seen', read: 'x' }, 'europeantour')).toBeNull();
    expect(accept({ type: 'et-seen', read: { big: 'x'.repeat(300_000) } }, 'europeantour')).toBeNull();
    for (const type of ['et-seen', 'et-line', 'et-send', 'et-answer'] as const) {
      expect(accept({ type, read: {} }, 'target-page')).toBeNull();
      expect(accept({ type, read: {} }, 'tour')).toBeNull();
      expect(accept({ type, read: {} }, 'extension')).toBeNull();
    }
    // The answer whether a page is his only from the extension's own pages.
    expect(accept({ type: 'pro-answer', yes: true }, 'europeantour')).toBeNull();
  });

  it('trusts nothing else', () => {
    expect(from('https://portal.trackmangolf.com.evil.example/')).toBe('other');
    expect(from('http://portal.trackmangolf.com/')).toBe('other');
    expect(from('https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/app.html')).toBe('other');
    expect(from('https://golf-launch-monitor-sync.github.io/other-repo/pair')).toBe('other');
    expect(sourceOf({ id: 'another-extension', url: 'https://portal.trackmangolf.com/', tab }, ID, ORIGIN)).toBe('other');
    expect(sourceOf({ id: ID, url: 'https://portal.trackmangolf.com/' }, ID, ORIGIN)).toBe('other'); // no tab: not a content script
    expect(sourceOf({ id: ID }, ID, ORIGIN)).toBe('other');
    expect(sourceOf({ id: ID, url: 'chrome-extension://someoneelse/popup.html' }, ID, ORIGIN)).toBe('other');
  });
});

describe('which messages are taken', () => {
  it('each kind only from where it may come', () => {
    expect(accept({ type: 'portal-key', token: 'a.b.c' }, 'portal')).toEqual({ type: 'portal-key', token: 'a.b.c' });
    expect(accept({ type: 'portal-key', token: 'a.b.c' }, 'pair-page')).toBeNull();
    expect(accept({ type: 'pair-offer', fragment: '#x' }, 'pair-page')).toEqual({ type: 'pair-offer', fragment: '#x' });
    expect(accept({ type: 'pair-offer', fragment: '#x' }, 'portal')).toBeNull();
    // The portal can't confirm an account, run a sync, read the status or the log.
    for (const type of ['confirm', 'run', 'status', 'export-log', 'pair-confirm', 'unpair']) expect(accept({ type, yes: true, id: 'x' }, 'portal')).toBeNull();
    expect(accept({ type: 'confirm', yes: true }, 'extension')).toEqual({ type: 'confirm', yes: true });
  });

  it('a bridge request only from a target’s page, read as strictly as the spec says', () => {
    const request = { glmsync: 'request', v: 1, id: 'r-1', ask: 'fetch', extra: 'ignored' };
    expect(accept({ type: 'bridge', request }, 'target-page')).toEqual({ type: 'bridge', request: { id: 'r-1', ask: 'fetch', reason: 'manual' } });
    expect(accept({ type: 'bridge', request }, 'extension')).toBeNull();
    expect(accept({ type: 'bridge', request }, 'portal')).toBeNull();
    expect(accept({ type: 'bridge', request: { ...request, ask: 'unpair' } }, 'target-page')).toBeNull();
    expect(accept({ type: 'bridge', request: { ...request, id: '<script>' } }, 'target-page')).toBeNull();
    // A target's page can't do anything else.
    for (const type of ['confirm', 'run', 'status', 'unpair', 'switch-account', 'open-portal', 'portal-key', 'pair-offer']) {
      expect(accept({ type, yes: true, id: 'x', token: 'a.b.c', fragment: '#x' }, 'target-page')).toBeNull();
    }
    expect(accept({ type: 'switch-account' }, 'extension')).toEqual({ type: 'switch-account' });
  });

  it('the yes to a pairing with the service chosen, and *Connect new*, only from the extension’s own pages', () => {
    expect(accept({ type: 'pair-confirm' }, 'extension')).toEqual({ type: 'pair-confirm' });
    expect(accept({ type: 'pair-confirm', provider: 'trackman' }, 'extension')).toEqual({ type: 'pair-confirm', provider: 'trackman' });
    expect(accept({ type: 'pair-confirm', provider: 'Trackman' }, 'extension')).toBeNull();
    expect(accept({ type: 'pair-confirm', provider: 7 }, 'extension')).toBeNull();
    expect(accept({ type: 'open-connect' }, 'extension')).toEqual({ type: 'open-connect' });
    for (const source of ['target-page', 'portal', 'pair-page', 'golfde', 'other'] as const) {
      expect(accept({ type: 'pair-confirm', provider: 'trackman' }, source)).toBeNull();
      expect(accept({ type: 'open-connect' }, source)).toBeNull();
    }
  });

  it('with fields of the right kind only', () => {
    expect(accept({ type: 'portal-key', token: 42 }, 'portal')).toBeNull();
    expect(accept({ type: 'portal-key', token: 'x'.repeat(20_000) }, 'portal')).toBeNull();
    expect(accept({ type: 'confirm', yes: 'yes' }, 'extension')).toBeNull();
    expect(accept({ type: 'run', id: 3 }, 'extension')).toBeNull();
    expect(accept({ type: 'nonsense' }, 'extension')).toBeNull();
    expect(accept(null, 'extension')).toBeNull();
    expect(accept({ type: 'toString' }, 'extension')).toBeNull();
  });

  it('test mode only from the extension’s own pages, with a code and a pairing of sane size', () => {
    expect(accept({ type: 'test-fetch', code: 'T17K2M9Q' }, 'extension')).toEqual({ type: 'test-fetch', code: 'T17K2M9Q' });
    expect(accept({ type: 'test-fetch', code: 'T17K2M9Q', id: 'abc' }, 'extension')).toEqual({ type: 'test-fetch', code: 'T17K2M9Q', id: 'abc' });
    expect(accept({ type: 'test-fetch', code: 'x'.repeat(3000) }, 'extension')).toBeNull();
    expect(accept({ type: 'test-fetch', code: 7 }, 'extension')).toBeNull();
    expect(accept({ type: 'test-fetch', code: 'T17K2M9Q', id: 'x'.repeat(65) }, 'extension')).toBeNull();
    expect(accept({ type: 'test-confirm', yes: true }, 'extension')).toEqual({ type: 'test-confirm', yes: true });
    expect(accept({ type: 'test-confirm', yes: 1 }, 'extension')).toBeNull();
    expect(accept({ type: 'test-end', id: 'abc' }, 'extension')).toEqual({ type: 'test-end', id: 'abc' });
    expect(accept({ type: 'test-end' }, 'extension')).toBeNull();
    // A page, the portal or the pairing page can't start, confirm or end a test.
    for (const source of ['target-page', 'portal', 'pair-page', 'other'] as const) {
      for (const type of ['test-fetch', 'test-confirm', 'test-end']) expect(accept({ type, code: 'T17K2M9Q', yes: true, id: 'abc' }, source)).toBeNull();
    }
  });
});
