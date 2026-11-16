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

  it('with fields of the right kind only', () => {
    expect(accept({ type: 'portal-key', token: 42 }, 'portal')).toBeNull();
    expect(accept({ type: 'portal-key', token: 'x'.repeat(20_000) }, 'portal')).toBeNull();
    expect(accept({ type: 'confirm', yes: 'yes' }, 'extension')).toBeNull();
    expect(accept({ type: 'run', id: 3 }, 'extension')).toBeNull();
    expect(accept({ type: 'nonsense' }, 'extension')).toBeNull();
    expect(accept(null, 'extension')).toBeNull();
    expect(accept({ type: 'toString' }, 'extension')).toBeNull();
  });
});
