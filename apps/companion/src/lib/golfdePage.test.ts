// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { PAGE_MATCHES } from '@glmsync/provider-golfde';
import { describe, expect, it } from 'vitest';
import { fromGolfde, GOLFDE_MESSAGE, golfdeWindowRules, HISTORY_SHEET_URL, onReadPage, openInGolfdeWindow, pageId, readGolfdeMessage, unseenWindowRules } from './golfdePage.ts';

const PAGE = 'a1b2c3d4e5f60718293a';
const msg = (seen: unknown, over: Record<string, unknown> = {}) => JSON.stringify({ glmsync: GOLFDE_MESSAGE, page: PAGE, seen, ...over });
const result = { played_on: '2026-10-03', ref: 'c0ffee00-0000-4000-8000-000000000001', holes_read: 18, gbe: 85, cr: 71.2, slope: 128 };

describe('the pages the golf.de window reads along on', () => {
  it('are the extension’s, and only those', () => {
    expect(PAGE_MATCHES.length).toBeGreaterThan(0);
    for (const href of [
      HISTORY_SHEET_URL,
      `${HISTORY_SHEET_URL}#/??first=10&after=abc`,
      'https://www.golf.de/mein-bereich.html',
      'https://www.golf.de/mein-bereich/scoring-record.html',
      'https://www.golf.de/sport/turnierkalender/clubturniere.html?id=5001',
    ])
      expect(onReadPage(href), href).toBe(true);
    for (const href of [
      'https://www.golf.de/',
      'https://login.golf.de/mein-bereich/handicap-history-sheet.html',
      'http://www.golf.de/mein-bereich.html',
      'https://www.golf.de.evil.test/mein-bereich.html',
      'https://evil.test/?https://www.golf.de/mein-bereich.html',
      'https://www.golf.de/mein-bereichX.html',
      42,
      null,
    ])
      expect(onReadPage(href), String(href)).toBe(false);
  });
});

describe('the window nobody sees (a run by itself, spec 1.17.0)', () => {
  it('loads only the pages read along on; a sign-in or any other page doesn’t load and ends the run', () => {
    let refused = 0;
    const rules = unseenWindowRules(() => refused++);
    const top = (url: string) => rules.onShouldStartLoadWithRequest({ url, isTopFrame: true });
    for (const url of ['https://www.golf.de/mein-bereich.html', HISTORY_SHEET_URL, 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/5001/ergebnisse', 'about:blank'])
      expect(top(url), url).toBe(true);
    expect(refused).toBe(0);
    for (const url of ['https://login.golf.de/auth', 'https://accounts.google.com/o/oauth2', 'https://appleid.apple.com/auth', 'https://www.golf.de/', 'https://evil.test/'])
      expect(top(url), url).toBe(false);
    expect(refused).toBe(5);
    // The page's own frames as in the player's window; they end nothing.
    expect(rules.onShouldStartLoadWithRequest({ url: 'https://consent.example/frame', isTopFrame: false })).toBe(true);
    expect(rules.onShouldStartLoadWithRequest({ url: 'http://plain.example/', isTopFrame: false })).toBe(false);
    expect(refused).toBe(5);
    expect(unseenWindowRules(() => { throw new Error('x'); }).onShouldStartLoadWithRequest({ url: 'https://evil.test/' })).toBe(false);
  });
});

describe('the golf.de window', () => {
  const top = (url: string) => golfdeWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: true });
  const frame = (url: string) => golfdeWindowRules.onShouldStartLoadWithRequest({ url, isTopFrame: false });

  it('shows golf.de’s own pages and the sign-in pages it may send to, nothing else', () => {
    expect(golfdeWindowRules.originWhitelist).toEqual(['*']); // every load decided here, none handed to the system
    expect(top(HISTORY_SHEET_URL)).toBe(true);
    expect(top('https://login.golf.de/')).toBe(true);
    expect(top('https://golf.de/')).toBe(true);
    expect(top('https://accounts.google.com/o/oauth2')).toBe(true);
    expect(top('https://appleid.apple.com/auth')).toBe(true);
    expect(top('about:blank')).toBe(true);
    expect(top('http://www.golf.de/')).toBe(false);
    expect(top('https://www.golf.de.evil.test/')).toBe(false);
    expect(top('https://evilgolf.de/')).toBe(false);
    expect(top('https://example.org/')).toBe(false);
    expect(top('mailto:info@golf.de')).toBe(false);
    expect(top('javascript:alert(1)')).toBe(false);
  });

  it('lets the page’s own frames load over https only', () => {
    expect(frame('https://consent.example.org/banner')).toBe(true);
    expect(frame('about:srcdoc')).toBe(true);
    expect(frame('http://tracker.example.org/')).toBe(false);
    expect(frame('data:text/html,x')).toBe(false);
  });

  it('opens a new window of the page in itself, or nowhere', () => {
    expect(openInGolfdeWindow('https://www.golf.de/mein-bereich.html')).toBe('https://www.golf.de/mein-bereich.html');
    expect(openInGolfdeWindow('https://example.org/')).toBeNull();
    expect(openInGolfdeWindow('about:blank')).toBeNull();
    expect(openInGolfdeWindow(undefined)).toBeNull();
  });

  it('knows golf.de by its host, over https', () => {
    expect(fromGolfde('https://www.golf.de/x')).toBe(true);
    expect(fromGolfde('https://golf.de')).toBe(true);
    expect(fromGolfde('https://notgolf.de')).toBe(false);
    expect(fromGolfde('http://www.golf.de')).toBe(false);
    expect(fromGolfde('not a url')).toBe(false);
  });
});

describe('a message from the window', () => {
  it('is taken from golf.de’s page, in the page script’s shape, read again strictly', () => {
    expect(readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'history', results: [result], total: 1 }))).toEqual({
      page: PAGE,
      seen: { kind: 'history', results: [result], total: 1 },
    });
    expect(readGolfdeMessage(`${HISTORY_SHEET_URL}#/scorekarte/5001/1/x`, msg({ kind: 'signed_out' }))).toEqual({ page: PAGE, seen: { kind: 'signed_out' } });
  });

  it('is dropped from anywhere else, or in another shape', () => {
    const ok = msg({ kind: 'signed_out' });
    expect(readGolfdeMessage('https://login.golf.de/', ok)).toBeNull(); // not the page the script runs on
    expect(readGolfdeMessage('https://evil.test/', ok)).toBeNull();
    expect(readGolfdeMessage('http://www.golf.de/mein-bereich.html', ok)).toBeNull();
    expect(readGolfdeMessage(undefined, ok)).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, 'not json')).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, JSON.stringify(null))).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, { glmsync: GOLFDE_MESSAGE })).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'signed_out' }, { glmsync: 'other' }))).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'signed_out' }, { page: 'short' }))).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'signed_out' }, { page: 'A1B2C3D4E5F60718293A' }))).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'steal' }))).toBeNull();
    expect(readGolfdeMessage(HISTORY_SHEET_URL, 'x'.repeat(1_000_001))).toBeNull();
  });

  it('keeps only what dgvhcp/1 has of a result (a name the page might post never comes through)', () => {
    const got = readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'history', results: [{ ...result, firstName: 'Erika', memberNumber: '123' }] }));
    expect(got?.seen).toEqual({ kind: 'history', results: [result] });
  });
});

describe('a page’s id', () => {
  it('is hex, as the message reader wants it', () => {
    const id = pageId((n) => Uint8Array.from({ length: n }, (_, i) => i * 29));
    expect(id).toMatch(/^[0-9a-f]{18}$/);
    expect(readGolfdeMessage(HISTORY_SHEET_URL, msg({ kind: 'signed_out' }, { page: id }))).not.toBeNull();
  });
});
