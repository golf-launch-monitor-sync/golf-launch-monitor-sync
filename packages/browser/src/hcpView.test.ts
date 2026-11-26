// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { HcpView } from './hcp.ts';
import { hcpLastText, lineOf } from './hcpView.ts';
import { translator } from './i18n.ts';

const t = translator('en');
const pairing = { id: 'a', base: 'https://app.example.org/hcp/v1', host: 'app.example.org', name: 'Example App', paired_at: '2026-11-21T19:00:00Z' };
const view = (over: Partial<HcpView> = {}): HcpView => ({ pairings: [pairing], auto: true, seen: 0, fresh: 0, waiting: false, signed_out: false, changed_page: false, sending: false, ended: [], account: 'confirmed', index: null, fetch_all: 'no', run: null, auto_fetch: true, ...over });

describe('Fetch all on the line', () => {
  const run = (over: Partial<NonNullable<HcpView['run']>> = {}): HcpView['run'] => ({ phase: 'history', entries: 0, lists_done: 0, lists_total: 0, ...over });

  it('offers it where it may run, and nowhere else', () => {
    expect(lineOf(view({ fetch_all: 'ready', seen: 20 }), t)).toMatchObject({ fetchAll: true });
    expect(lineOf(view({ fetch_all: 'ready' }), t)).toMatchObject({ fetchAll: true });
    expect(lineOf(view({ fetch_all: 'limit', seen: 20 }), t)).not.toHaveProperty('fetchAll');
    expect(lineOf(view({ fetch_all: 'ready', account: 'asking' }), t)).not.toHaveProperty('fetchAll');
  });

  it('says how far a run is, with Stop', () => {
    expect(lineOf(view({ fetch_all: 'running', run: run() }), t)).toEqual({ text: 'Golf Stats Sync: fetching all for Example App – History Sheet …', send: false, warn: false, stop: true });
    expect(lineOf(view({ fetch_all: 'running', run: run({ entries: 20, total: 37 }) }), t)?.text).toBe('Golf Stats Sync: fetching all for Example App – History Sheet, 20 of 37');
    expect(lineOf(view({ fetch_all: 'running', run: run({ phase: 'scoring' }) }), t)?.text).toContain('Scoring Record');
    expect(lineOf(view({ fetch_all: 'running', run: run({ phase: 'lists', lists_done: 3, lists_total: 12 }) }), t)?.text).toContain('result list 4 of 12');
  });

  it('says why a run stopped (not when the player stopped it)', () => {
    expect(lineOf(view({ fetch_all: 'ready', seen: 5, fresh: 2, run: run({ phase: 'stopped', why: 'signed_out' }) }), t)).toMatchObject({ warn: true, send: true, fetchAll: true, text: 'Golf Stats Sync: stopped: not signed in on golf.de any more' });
    expect(lineOf(view({ seen: 5, run: run({ phase: 'stopped', why: 'changed_page' }) }), t)?.text).toContain('what was read so far goes to Example App');
    expect(lineOf(view({ seen: 5, run: run({ phase: 'stopped', why: 'cancelled' }) }), t)?.text).toContain('has them all');
  });
});

describe('the line on golf.de', () => {
  it('shows nothing without a connected app', () => {
    expect(lineOf(view({ pairings: [] }), t)).toBeNull();
  });

  it('says what was seen and what is new, with Send where something is', () => {
    expect(lineOf(view(), t)).toEqual({ text: 'Golf Stats Sync: reads along for Example App', send: false, warn: false });
    expect(lineOf(view({ seen: 20, fresh: 3 }), t)).toEqual({ text: 'Golf Stats Sync: 20 results seen · 3 new – they go to Example App in a moment', send: true, warn: false });
    expect(lineOf(view({ seen: 20, fresh: 3, auto: false }), t)?.text).toBe('Golf Stats Sync: 20 results seen · 3 new for Example App');
    expect(lineOf(view({ seen: 20 }), t)?.text).toBe('Golf Stats Sync: 20 results seen · Example App has them all');
  });

  it('says what stands in the way', () => {
    expect(lineOf(view({ waiting: true }), t)?.text).toContain('Mein Bereich');
    expect(lineOf(view({ pairings: [{ ...pairing, other_account: true }] }), t)).toMatchObject({ warn: true, send: false });
    expect(lineOf(view({ changed_page: true, seen: 3 }), t)).toMatchObject({ warn: true });
    expect(lineOf(view({ seen: 3, fresh: 1, pairings: [{ ...pairing, last: { at: '2026-11-21T19:00:00Z', status: 'failed', error: 'unreachable' } }] }), t)).toMatchObject({ warn: true, send: true });
    expect(lineOf(view({ signed_out: true }), t)?.text).toContain('not signed in');
    expect(lineOf(view({ sending: true, seen: 3, fresh: 3 }), t)?.text).toContain('sending');
  });
});

describe('what a target last answered', () => {
  const now = Date.parse('2026-11-21T19:30:00Z');
  it('as one line', () => {
    expect(hcpLastText(pairing, t, 'en', now)).toBeNull();
    expect(hcpLastText({ ...pairing, last: { at: '2026-11-21T19:29:00Z', status: 'sent', brought: 3 } }, t, 'en', now)).toContain('3 new or completed');
    expect(hcpLastText({ ...pairing, last: { at: '2026-11-21T19:29:00Z', status: 'sent', brought: 0 } }, t, 'en', now)).toContain('nothing new');
    expect(hcpLastText({ ...pairing, last: { at: 'x', status: 'failed', error: 'unreachable' } }, t, 'en', now)).toContain('–');
    expect(hcpLastText({ ...pairing, last: { at: '2026-11-21T19:29:00Z', status: 'other_account' } }, t, 'en', now)).toBeNull();
  });
});
