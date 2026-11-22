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

  it('knows golf.de’s pages (the top frame only) and what may come from there', () => {
    expect(from('https://www.golf.de/mein-bereich/handicap-history-sheet.html', { frameId: 0 })).toBe('golfde');
    expect(from('https://www.golf.de/mein-bereich/handicap-history-sheet.html', { frameId: 2 })).toBe('other');
    expect(from('https://golf.de/mein-bereich/', { frameId: 0 })).toBe('target-page'); // another origin: only a paired target's bridge
    expect(accept({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: { kind: 'member' } }, 'golfde')).toEqual({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: { kind: 'member' } });
    expect(accept({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: { kind: 'member' } }, 'target-page')).toBeNull();
    expect(accept({ type: 'golfde-seen', page: 'not hex!', seen: {} }, 'golfde')).toBeNull();
    expect(accept({ type: 'golfde-seen', page: 'a1b2c3d4e5', seen: 'x' }, 'golfde')).toBeNull();
    expect(accept({ type: 'golfde-send' }, 'golfde')).toEqual({ type: 'golfde-send' });
    expect(accept({ type: 'hcp-unpair', id: 'abc' }, 'golfde')).toBeNull();
    expect(accept({ type: 'hcp-unpair', id: 'abc' }, 'extension')).toEqual({ type: 'hcp-unpair', id: 'abc' });
    expect(accept({ type: 'hcp-auto', auto: 'yes' }, 'extension')).toBeNull();
    // The yes to golf.de's account only from the extension's own pages: golf.de's scripts reach the line on its page.
    expect(accept({ type: 'hcp-confirm', yes: true }, 'extension')).toEqual({ type: 'hcp-confirm', yes: true });
    expect(accept({ type: 'hcp-confirm', yes: true }, 'golfde')).toBeNull();
    expect(accept({ type: 'hcp-confirm', yes: 'yes' }, 'extension')).toBeNull();
    // From golf.de only the way to that page.
    expect(accept({ type: 'golfde-confirm' }, 'golfde')).toEqual({ type: 'golfde-confirm' });
    expect(accept({ type: 'golfde-confirm' }, 'target-page')).toBeNull();
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
    expect(accept({ type: 'bridge', request }, 'target-page')).toEqual({ type: 'bridge', request: { id: 'r-1', ask: 'fetch' } });
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
