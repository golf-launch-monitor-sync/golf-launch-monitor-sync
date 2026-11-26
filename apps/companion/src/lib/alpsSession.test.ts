// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { AlpsKeeper } from '@glmsync/browser/alps';
import type { ProView } from '@glmsync/browser/pro';
import { MemoryStorage } from '@glmsync/core';
import { alps, checkTourPage, type Snapshot } from '@glmsync/provider-tours';
import { alpsOom, alpsRecord, alpsResults, alpsStatistics } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { AlpsSession, type AlpsState } from './alpsSession.ts';
import { AFTER_PICK_MS, type TourAnswer } from './toursPage.ts';

const PROFILE = 'https://www.alpstourgolf.com/playerprofile/TST001';
const OTHER = 'https://www.alpstourgolf.com/playerprofile/VAN054';
const STATS = 'https://www.alpstourgolf.com/stats';
const TODAY = '2026-11-26';
const view: ProView = {
  pairings: [{ id: 'p1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-25T09:00:00Z', host: 'app.example.org' }],
  ended: [],
  question: null,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};
const answer = (snap: Snapshot): TourAnswer => {
  const r = alps.readPage(snap);
  return r?.kind === 'alps' ? { ok: true, alps: r } : { ok: false, why: 'changed_page' };
};
const REPORTS: Record<string, () => Snapshot> = { Statistics: alpsStatistics, Results: alpsResults, 'Order of Merit': alpsOom, 'This Season record': alpsRecord };

/** A window on his made-up profile on the Alps Tour: the report picked there, what was read and sent; timers the test runs. */
function world(o: { pro?: Partial<ProView>; read?: (url: string) => TourAnswer | null | Promise<TourAnswer | null>; send?: () => Promise<ProView>; storage?: MemoryStorage } = {}) {
  const storage = o.storage ?? new MemoryStorage();
  const keeper = new AlpsKeeper(storage);
  const timers: { fn: () => void; ms: number }[] = [];
  const sent: unknown[] = [];
  const kept: string[] = [];
  const reads: string[] = [];
  const states: AlpsState[] = [];
  let at = PROFILE;
  /** The report his profile shows: *Statistics* when it opens, as the site picks it. */
  let report = 'Statistics';
  const readOf = (url: string): TourAnswer | null => {
    if (url === PROFILE) return answer((REPORTS[report] ?? alpsStatistics)());
    if (url === OTHER) return answer(alpsRecord({ url: OTHER, pairs: { 'Player name': 'Otto Erfunden' } }));
    return { ok: false, why: 'not_player_page' };
  };
  const s = new AlpsSession({
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
  /** The window shows `url` and it has loaded (or the site moved there). */
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
  /** He picks another report under *Select Report*; the page script says only that he picked. */
  const pick = (r: string) => {
    report = r;
    s.picked(at);
  };
  return { s, keeper, timers, sent, kept, reads, states, go, tick, pick };
}

describe('the tour window on the Alps Tour', () => {
  it('reads the report his profile shows once it loads, and each report he picks a moment later, merged', async () => {
    const w = world();
    await w.s.start();
    await w.go(PROFILE);
    expect(w.reads).toEqual([PROFILE]);
    // *Statistics*, as it opens: his name, nothing that goes - the bar says which report to pick.
    expect(w.s.now.alps).toEqual({ who: 'Paul Platzhalter', read: null, totals: false, rank: null });
    w.pick('This Season record');
    expect(w.timers.map((t) => t.ms)).toEqual([AFTER_PICK_MS]);
    expect(w.reads).toHaveLength(1); // not before the site shows it
    await w.tick();
    w.pick('Results');
    await w.tick();
    w.pick('Order of Merit');
    await w.tick();
    expect(w.reads).toEqual([PROFILE, PROFILE, PROFILE, PROFILE]);
    expect(w.s.now.alps).toEqual({ who: 'Paul Platzhalter', read: 3, totals: true, rank: 4 });
    expect(w.sent).toEqual([]); // nothing goes before his tap
  });

  it('Send reads the report once more and sends his season with its rounds, the par and his rank', async () => {
    const w = world();
    await w.s.start();
    await w.go(PROFILE);
    for (const r of ['This Season record', 'Results', 'Order of Merit']) {
      w.pick(r);
      await w.tick();
    }
    await w.s.send(PROFILE);
    expect(w.reads).toHaveLength(5); // Send read the report once more
    const page = checkTourPage(w.sent[0]);
    expect(w.sent).toHaveLength(1);
    expect(page).toMatchObject({ site: 'tour:alps', id: 'tst001', name: 'Paul Platzhalter', ranking: { source: 'tour:alps', rank: 4, points: 26845.35, events: 9, as_of: TODAY } });
    expect(page?.tournaments.map((t) => [t.start, t.place, (t.rounds ?? []).map((r) => [r.gross, r.par])])).toEqual([
      ['2026-02-17', 6, [[69, 72], [67, 72], [73, 72]]],
      ['2026-02-22', 51, [[70, 72], [71, 72]]],
      ['2026-04-09', 1, [[67, 72], [65, 72], [70, 72]]],
    ]);
    expect(w.s.now.phase).toBe('done');
    expect(w.kept).toEqual([PROFILE]); // the window opens on his profile next time
  });

  it('after a send, another report picked offers Send again; a pick is dropped when the window moves on or closes', async () => {
    const w = world();
    await w.s.start();
    await w.go(PROFILE);
    w.pick('This Season record');
    await w.tick();
    await w.s.send(PROFILE);
    expect(w.s.now.phase).toBe('done');
    w.pick('Order of Merit');
    w.s.picked(PROFILE); // a second change before the first was read: one read
    expect(w.timers).toHaveLength(1);
    await w.tick();
    expect(w.s.now).toMatchObject({ phase: 'ready', alps: { rank: 4 } });
    w.pick('Results');
    await w.go(STATS); // the site moved on: the pick's read is gone
    expect(w.timers).toEqual([]);
    await w.go(PROFILE);
    w.pick('Results');
    await w.s.send(PROFILE); // Send takes a pick waiting in at once
    expect(w.timers).toEqual([]);
    w.pick('Results');
    w.s.close();
    expect(w.timers).toEqual([]);
    // A pick of a page the window doesn't show, or not his profile: nothing.
    const v = world();
    await v.s.start();
    await v.go(PROFILE);
    v.s.picked(OTHER);
    v.s.picked(STATS);
    expect(v.timers).toEqual([]);
  });

  it('another player’s profile replaces what was kept, as in the extension', async () => {
    const w = world();
    await w.s.start();
    await w.go(PROFILE);
    w.pick('Order of Merit');
    await w.tick();
    expect(w.s.now.alps?.rank).toBe(4);
    await w.go(OTHER);
    expect(w.s.now.alps).toEqual({ who: 'Otto Erfunden', read: 3, totals: false, rank: null });
  });

  it('nothing that could go yet: Send sends nothing and the bar goes back to which report to pick', async () => {
    const w = world();
    await w.s.start();
    await w.go(PROFILE);
    await w.s.send(PROFILE); // *Statistics* only
    expect(w.sent).toEqual([]);
    expect(w.s.now.phase).toBe('ready');
    expect(w.kept).toEqual([]);
  });

  it('reads nothing without a connection for a pro’s pages, and nothing of a page that isn’t his profile', async () => {
    const w = world({ pro: { pairings: [] } });
    await w.s.start();
    await w.go(PROFILE);
    w.pick('Results');
    expect([w.reads, w.timers]).toEqual([[], []]);
    const v = world();
    await v.s.start();
    await v.go(STATS);
    await v.s.send(STATS);
    expect(v.reads).toEqual([]);
    expect(v.s.now.phase).toBe('ready');
  });

  it('a profile that loaded before the connections were read is read once they are', async () => {
    const w = world();
    w.s.moved(PROFILE);
    await w.s.loaded(PROFILE);
    expect(w.reads).toEqual([]);
    await w.s.start();
    await flush();
    expect(w.reads).toEqual([PROFILE]);
  });

  it('a page the module doesn’t know says so, also unasked; the next read that works clears it', async () => {
    let broken = true;
    const w = world({ read: () => (broken ? { ok: false, why: 'changed_page' } : answer(alpsRecord())) });
    await w.s.start();
    await w.go(PROFILE);
    expect(w.s.now.phase).toBe('changed_page');
    broken = false;
    await w.s.send(PROFILE);
    expect(w.s.now.phase).toBe('done');
    expect(w.sent).toHaveLength(1);
  });

  it('no answer: quiet when unasked, an error on his tap; a failing send or keeper is caught', async () => {
    const w = world({ read: () => null });
    await w.s.start();
    await w.go(PROFILE);
    expect(w.s.now.phase).toBe('ready');
    await w.s.send(PROFILE);
    expect(w.s.now.phase).toBe('error');
    const v = world({ read: () => answer(alpsRecord()), send: () => Promise.reject(new Error('offline')) });
    await v.s.start();
    await v.go(PROFILE);
    await v.s.send(PROFILE);
    expect(v.s.now.phase).toBe('error');
    expect(v.kept).toEqual([]);
    // A keeper whose storage fails: the unasked read stays quiet, his tap says so.
    const storage = new MemoryStorage();
    storage.set = () => Promise.reject(new Error('full'));
    const x = world({ storage });
    await x.s.start();
    await x.go(PROFILE);
    expect(x.s.now.phase).toBe('ready');
    await x.s.send(PROFILE);
    expect(x.s.now.phase).toBe('error');
    // The page script found no profile to read (he went on meanwhile): nothing sent, the bar back to ready.
    const y = world({ read: () => ({ ok: false, why: 'not_player_page' }) });
    await y.s.start();
    await y.go(PROFILE);
    await y.s.send(PROFILE);
    expect(y.s.now.phase).toBe('ready');
    expect(y.sent).toEqual([]);
    // An answer of another site's shape is no read.
    const z = world({ read: () => ({ ok: true, ocsUnread: 'no_result' }) });
    await z.s.start();
    await z.go(PROFILE);
    await z.s.send(PROFILE);
    expect(z.s.now.phase).toBe('error');
  });

  it('one read at a time: a tap while the report is being read does nothing more', async () => {
    let release: (a: TourAnswer | null) => void = () => undefined;
    const w = world({ read: () => new Promise((r) => (release = r)) });
    await w.s.start();
    w.s.moved(PROFILE);
    const loading = w.s.loaded(PROFILE);
    await w.s.send(PROFILE);
    expect(w.reads).toEqual([PROFILE]);
    release(answer(alpsRecord()));
    await loading;
    expect(w.s.now.alps?.read).toBe(3);
  });

  it('connections that can’t be read say so; his answer to the question; nothing told a closed window', async () => {
    const w = world();
    const s = new AlpsSession({
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
    await w.s.loaded(PROFILE);
    expect(w.states.length).toBe(before);
  });
});
