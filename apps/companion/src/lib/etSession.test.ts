// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { EtKeeper } from '@glmsync/browser/europeantour';
import type { ProView } from '@glmsync/browser/pro';
import { MemoryStorage } from '@glmsync/core';
import { checkTourPage, europeantour } from '@glmsync/provider-tours';
import { ET_TITLE, etLine, etOverview, etResults, etStats } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { EtSession, type EtState } from './etSession.ts';
import { AFTER_PICK_MS, type TourAnswer } from './toursPage.ts';

const BASE = 'https://www.europeantour.com/players/jonas-beispiel-99002';
const RESULTS = `${BASE}/results?tour=hotelplanner-tour`;
const OVERVIEW = `${BASE}/?tour=hotelplanner-tour`;
const STATS = `${BASE}/stats?tour=hotelplanner-tour`;
const LISTING = 'https://www.europeantour.com/hotelplanner-tour/players/';
const TODAY = '2026-11-25';
const view: ProView = {
  pairings: [{ id: 'p1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-25T09:00:00Z', host: 'app.example.org' }],
  ended: [],
  question: null,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const answer = (snap: ReturnType<typeof etResults>, title: string): TourAnswer => {
  const r = europeantour.readPage(snap, title, TODAY);
  return r?.kind === 'page' ? { ok: true, et: r } : { ok: false, why: 'changed_page' };
};

/** A window on made-up pages of europeantour.com: what it shows (the season picked), what was read and sent; timers the test runs. */
function world(o: { pro?: Partial<ProView>; read?: (url: string) => TourAnswer | null | Promise<TourAnswer | null>; send?: () => Promise<ProView>; storage?: MemoryStorage } = {}) {
  const storage = o.storage ?? new MemoryStorage();
  const keeper = new EtKeeper(storage);
  const timers: { fn: () => void; ms: number }[] = [];
  const sent: unknown[] = [];
  const kept: string[] = [];
  const reads: string[] = [];
  const states: EtState[] = [];
  let at = RESULTS;
  /** The season the results page shows: 2026, or 2025 once he picked it. */
  let season = 2026;
  const readOf = (url: string): TourAnswer | null => {
    if (url.startsWith(`${BASE}/results`)) {
      return season === 2026
        ? answer(etResults(), ET_TITLE)
        : answer(etResults({ selected: ['2025'] }, [etLine('02/11/2025', 'hotelplanner-tour/made-up-final-2025', 'Made-up Final 2025', '3', '80.0', 68, 69, 70, 71)]), ET_TITLE);
    }
    if (url.startsWith(`${BASE}/stats`)) return answer(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour');
    if (url.startsWith(`${BASE}/`)) return answer(etOverview(), 'Jonas BEISPIEL - Players - European Tour');
    return { ok: false, why: 'not_player_page' };
  };
  const s = new EtSession({
    keeper,
    pro: {
      view: async () => ({ ...view, ...o.pro }),
      send: async (page) => {
        sent.push(page);
        return o.send ? o.send() : { ...view, ...o.pro };
      },
      answer: async () => view,
    },
    lastPage: { set: async (url) => void kept.push(url) },
    read: async () => {
      reads.push(at);
      return (o.read ?? readOf)(at);
    },
    today: () => TODAY,
    onChange: (st) => states.push(st),
    schedule: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    cancel: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  /** The window shows `url` and it has loaded. */
  const go = async (url: string) => {
    at = url;
    s.moved(url);
    await s.loaded(url);
    await flush();
  };
  const tick = async () => {
    timers.shift()?.fn();
    await flush();
  };
  return { s, keeper, timers, sent, kept, reads, states, go, tick, pick: (y: number) => void (season = y), get at() { return at; } };
}

describe('the tour window on europeantour.com', () => {
  it('reads each page of his as it loads, merged, and Send sends a page per tour', async () => {
    const w = world();
    await w.s.start();
    await w.go(OVERVIEW);
    await w.go(STATS);
    await w.go(RESULTS);
    expect(w.reads).toEqual([OVERVIEW, STATS, RESULTS]);
    expect(w.sent).toEqual([]); // nothing goes before his tap
    expect(w.s.now.et).toEqual({ who: 'Jonas BEISPIEL', tournaments: { 'tour:hotelplanner': 3, 'tour:dp_world': 1 } });
    await w.s.send(RESULTS);
    expect(w.reads.at(-1)).toBe(RESULTS); // Send reads the page once more
    const pages = w.sent.map((p) => checkTourPage(p));
    expect(pages.map((p) => [p?.site, p?.ranking.rank, p?.ranking.points, p?.tournaments.length, p?.stats.length])).toEqual([
      ['tour:dp_world', undefined, undefined, 1, 0],
      ['tour:hotelplanner', 12, 1044.11, 3, 2],
    ]);
    expect(w.s.now).toMatchObject({ phase: 'done', sent: 'tour:hotelplanner' });
    expect(w.kept).toEqual([RESULTS]); // the window opens on his page next time
  });

  it('a season picked in the page’s select is read a moment later, and Send is offered again', async () => {
    const w = world();
    await w.s.start();
    await w.go(RESULTS);
    await w.s.send(RESULTS);
    expect(w.s.now.phase).toBe('done');
    w.pick(2025);
    w.s.picked(RESULTS);
    w.s.picked(RESULTS); // a second change before the first was read: one read
    expect(w.timers.map((t) => t.ms)).toEqual([AFTER_PICK_MS]);
    await w.tick();
    expect(w.reads).toEqual([RESULTS, RESULTS, RESULTS]);
    expect(w.s.now).toMatchObject({ phase: 'ready', et: { tournaments: { 'tour:hotelplanner': 4, 'tour:dp_world': 1 } } });
    w.sent.length = 0;
    await w.s.send(RESULTS);
    const hp = w.sent.map((p) => checkTourPage(p)).find((p) => p?.site === 'tour:hotelplanner');
    expect(hp?.tournaments.map((t) => t.end)).toEqual(['2026-11-01', '2026-10-11', '2025-11-02', '2015-08-16']);
  });

  it('a pick is dropped when the window moves on or closes, and Send takes it in at once', async () => {
    const w = world();
    await w.s.start();
    await w.go(RESULTS);
    w.s.picked(RESULTS);
    await w.go(STATS); // another page: the pick's read is gone (the page that loaded is read instead)
    expect(w.timers).toEqual([]);
    w.s.picked(STATS);
    await w.s.send(STATS);
    expect(w.timers).toEqual([]);
    w.s.picked(STATS);
    w.s.close();
    expect(w.timers).toEqual([]);
    // A pick of a page the window doesn't show, or not his page: nothing.
    const v = world();
    await v.s.start();
    await v.go(RESULTS);
    v.s.picked(STATS);
    v.s.picked(LISTING);
    expect(v.timers).toEqual([]);
  });

  it('reads nothing without a connection for a pro’s pages, and nothing of a page that isn’t his', async () => {
    const w = world({ pro: { pairings: [] } });
    await w.s.start();
    await w.go(RESULTS);
    w.s.picked(RESULTS);
    expect([w.reads, w.timers]).toEqual([[], []]);
    const v = world();
    await v.s.start();
    await v.go(LISTING);
    await v.s.send(LISTING);
    expect(v.reads).toEqual([]);
    expect(v.s.now.phase).toBe('ready');
  });

  it('a page that loaded before the connections were read is read once they are', async () => {
    const w = world();
    w.s.moved(RESULTS);
    await w.s.loaded(RESULTS); // the window loaded first: no view yet, nothing read
    expect(w.reads).toEqual([]);
    await w.s.start();
    await flush();
    expect(w.reads).toEqual([RESULTS]);
  });

  it('a page the module doesn’t know says so, also unasked; the next read that works clears it', async () => {
    let broken = true;
    const w = world({ read: () => (broken ? { ok: false, why: 'changed_page' } : answer(etResults(), ET_TITLE)) });
    await w.s.start();
    await w.go(RESULTS);
    expect(w.s.now.phase).toBe('changed_page');
    broken = false;
    await w.s.send(RESULTS);
    expect(w.s.now.phase).toBe('done');
    expect(w.sent).toHaveLength(2);
  });

  it('no answer: quiet when unasked, an error on his tap; a failing send or keeper is caught', async () => {
    const w = world({ read: () => null });
    await w.s.start();
    await w.go(RESULTS);
    expect(w.s.now.phase).toBe('ready');
    await w.s.send(RESULTS);
    expect(w.s.now.phase).toBe('error');
    const v = world({ send: () => Promise.reject(new Error('offline')) });
    await v.s.start();
    await v.go(RESULTS);
    await v.s.send(RESULTS);
    expect(v.s.now.phase).toBe('error');
    expect(v.kept).toEqual([]);
    // A keeper whose storage fails: the unasked read stays quiet, his tap says so.
    const storage = new MemoryStorage();
    storage.set = () => Promise.reject(new Error('full'));
    const x = world({ storage });
    await x.s.start();
    await x.go(RESULTS);
    expect(x.s.now.phase).toBe('ready');
    await x.s.send(RESULTS);
    expect(x.s.now.phase).toBe('error');
    // The page script found no page of his to read: nothing sent, the bar back to ready.
    const y = world({ read: () => ({ ok: false, why: 'not_player_page' }) });
    await y.s.start();
    await y.go(RESULTS);
    await y.s.send(RESULTS);
    expect(y.s.now.phase).toBe('ready');
    expect(y.sent).toEqual([]);
  });

  it('one read at a time: a tap while the page is being read does nothing more', async () => {
    let release: (a: TourAnswer | null) => void = () => undefined;
    const w = world({ read: () => new Promise((r) => (release = r)) });
    await w.s.start();
    w.s.moved(RESULTS);
    const loading = w.s.loaded(RESULTS);
    await w.s.send(RESULTS);
    expect(w.reads).toEqual([RESULTS]);
    release(answer(etResults(), ET_TITLE));
    await loading;
    expect(w.s.now.et?.tournaments).toEqual({ 'tour:hotelplanner': 3, 'tour:dp_world': 1 });
  });

  it('connections that can’t be read say so; his answer to the question; nothing told a closed window', async () => {
    const w = world();
    const s = new EtSession({
      keeper: w.keeper,
      pro: { view: () => Promise.reject(new Error('x')), send: () => Promise.reject(new Error('x')), answer: () => Promise.reject(new Error('x')) },
      lastPage: { set: async () => undefined },
      read: async () => null,
      today: () => TODAY,
      onChange: () => undefined,
    });
    await s.start();
    expect(s.now.unread).toBe(true);
    await s.answer(true);
    expect(s.now.phase).toBe('error');
    await w.s.start();
    await w.s.answer(true);
    expect(w.s.now.phase).toBe('done');
    const before = w.states.length;
    w.s.close();
    await w.s.loaded(RESULTS);
    expect(w.states.length).toBe(before);
  });
});
