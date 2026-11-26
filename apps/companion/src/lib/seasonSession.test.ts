// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { ProView } from '@glmsync/browser/pro';
import { pgatour, type TourPage } from '@glmsync/provider-tours';
import { pgaFigures, pgaResults } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { SeasonSession, type SeasonState } from './seasonSession.ts';
import type { TourAnswer } from './toursPage.ts';

const RESULTS = 'https://www.pgatour.com/player/99002/max-erfunden/results';
const OVERVIEW = 'https://www.pgatour.com/player/99002/max-erfunden';
const TODAY = '2026-11-25';
const page = (pgatour.readResults(pgaResults(), pgaFigures(), TODAY) as { kind: 'page'; page: TourPage }).page;
const view: ProView = {
  pairings: [{ id: 'p1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-25T09:00:00Z', host: 'app.example.org' }],
  ended: [],
  question: null,
};

/** A tour window on pgatour.com's made-up pages: what was asked, sent and kept. */
function world(o: { pro?: Partial<ProView>; read?: () => TourAnswer | null | Promise<TourAnswer | null>; send?: () => Promise<ProView>; view?: () => Promise<ProView>; kept?: () => Promise<void> } = {}) {
  const sent: unknown[] = [];
  const kept: string[] = [];
  const states: SeasonState[] = [];
  let reads = 0;
  const s = new SeasonSession({
    pro: {
      view: o.view ?? (async () => ({ ...view, ...o.pro })),
      send: async (raw) => {
        sent.push(raw);
        return o.send ? o.send() : { ...view, ...o.pro };
      },
      answer: async (yes) => ({ ...view, question: null, ended: yes ? [] : view.ended }),
    },
    lastPage: {
      set: async (url) => {
        if (o.kept) await o.kept();
        kept.push(url);
      },
    },
    read: async () => {
      reads += 1;
      return o.read ? o.read() : { ok: true, season: page };
    },
    onChange: (st) => states.push(st),
  });
  return { s, sent, kept, states, reads: () => reads };
}

describe('the season pages in the tour window', () => {
  it('reads nothing on its own; Send reads his Results page and sends the season it shows', async () => {
    const w = world();
    await w.s.start();
    w.s.moved();
    expect(w.reads()).toBe(0);
    await w.s.send(RESULTS);
    expect(w.reads()).toBe(1);
    expect(w.sent).toEqual([page]);
    expect(w.s.now).toMatchObject({ phase: 'done', note: null });
    expect(w.states.map((st) => st.phase)).toContain('reading');
    // The window opens on his Results page next time.
    expect(w.kept).toEqual([RESULTS]);
  });

  it('offers nothing off his Results page, without a connection, or once closed', async () => {
    const off = world();
    await off.s.start();
    await off.s.send(OVERVIEW);
    await off.s.send('https://www.pgatour.com/americas/player/99002/max-erfunden/results');
    expect(off.reads()).toBe(0);
    const alone = world({ pro: { pairings: [] } });
    await alone.s.start();
    await alone.s.send(RESULTS);
    expect([alone.reads(), alone.sent]).toEqual([0, []]);
    const closed = world();
    await closed.s.start();
    closed.s.close();
    await closed.s.send(RESULTS);
    expect(closed.reads()).toBe(0);
  });

  it('a tour no module reads, or nothing finished yet: the bar’s note, nothing sent, Send stays', async () => {
    const champions = world({ read: () => ({ ok: true, seasonUnread: 'other_tour' }) });
    await champions.s.start();
    await champions.s.send(RESULTS);
    expect([champions.s.now.phase, champions.s.now.note, champions.sent]).toEqual(['ready', 'otherTour', []]);
    // Another page shown: whatever the bar said is over.
    champions.s.moved();
    expect(champions.s.now.note).toBeNull();
    const early = world({ read: () => ({ ok: true, seasonUnread: 'nothing' }) });
    await early.s.start();
    await early.s.send(RESULTS);
    expect([early.s.now.phase, early.s.now.note]).toEqual(['ready', 'nothing']);
  });

  it('every failure is caught: no answer, a page it doesn’t know, a send that fails, a keep that fails', async () => {
    const silent = world({ read: () => null });
    await silent.s.start();
    await silent.s.send(RESULTS);
    expect(silent.s.now.phase).toBe('error');
    const changed = world({ read: () => ({ ok: false, why: 'changed_page' }) });
    await changed.s.start();
    await changed.s.send(RESULTS);
    expect(changed.s.now.phase).toBe('changed_page');
    const moved = world({ read: () => ({ ok: false, why: 'not_player_page' }) });
    await moved.s.start();
    await moved.s.send(RESULTS);
    expect(moved.s.now.phase).toBe('ready');
    const other = world({ read: () => ({ ok: true, ocsUnread: 'no_result' }) });
    await other.s.start();
    await other.s.send(RESULTS);
    expect([other.s.now.phase, other.sent]).toEqual(['error', []]);
    const thrown = world({ read: () => Promise.reject(new Error('boom')) });
    await thrown.s.start();
    await thrown.s.send(RESULTS);
    expect(thrown.s.now.phase).toBe('error');
    const failing = world({ send: () => Promise.reject(new Error('offline')) });
    await failing.s.start();
    await failing.s.send(RESULTS);
    expect([failing.s.now.phase, failing.kept]).toEqual(['error', []]);
    // The page went; only where the window opens next time couldn't be kept: still sent.
    const unkept = world({ kept: () => Promise.reject(new Error('storage')) });
    await unkept.s.start();
    await unkept.s.send(RESULTS);
    expect([unkept.s.now.phase, unkept.sent.length]).toEqual(['done', 1]);
    // After a failure he can send again.
    let first = true;
    const again = world({ read: () => (first ? ((first = false), null) : { ok: true, season: page }) });
    await again.s.start();
    await again.s.send(RESULTS);
    await again.s.send(RESULTS);
    expect([again.s.now.phase, again.sent.length]).toEqual(['done', 1]);
  });

  it('one Send at a time; a page shown meanwhile doesn’t end the reading', async () => {
    let release: (a: TourAnswer) => void = () => undefined;
    const w = world({ read: () => new Promise<TourAnswer>((r) => (release = r)) });
    await w.s.start();
    const first = w.s.send(RESULTS);
    await w.s.send(RESULTS);
    w.s.moved();
    expect(w.s.now.phase).toBe('reading');
    release({ ok: true, season: page });
    await first;
    expect([w.reads(), w.sent.length, w.s.now.phase]).toEqual([1, 1, 'done']);
  });

  it('the connections unread say so, with Load again; his answer to whose page it is', async () => {
    let fail = true;
    const w = world({ view: () => (fail ? Promise.reject(new Error('storage')) : Promise.resolve(view)) });
    await w.s.start();
    expect(w.s.now.unread).toBe(true);
    fail = false;
    await w.s.loadView();
    expect(w.s.now).toMatchObject({ unread: false, view });
    await w.s.answer(true);
    expect(w.s.now.phase).toBe('done');
    const broken = new SeasonSession({
      pro: { view: async () => view, send: async () => view, answer: () => Promise.reject(new Error('x')) },
      lastPage: { set: async () => undefined },
      read: async () => null,
      onChange: () => undefined,
    });
    await broken.answer(false);
    expect(broken.now.phase).toBe('error');
  });
});
