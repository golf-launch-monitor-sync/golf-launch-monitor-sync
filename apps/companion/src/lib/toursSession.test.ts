// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { ProView } from '@glmsync/browser/pro';
import { TourKeeper } from '@glmsync/browser/tours';
import { MemoryStorage } from '@glmsync/core';
import { checkTourPage, progolftour } from '@glmsync/provider-tours';
import { pgtLine, pgtProfile, pgtResult } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import type { TourAnswer } from './toursPage.ts';
import { TourSession, type TourState } from './toursSession.ts';

const PROFILE = 'https://www.progolftour.de/player-profile/99001?year=2026';
const TODAY = '2026-11-25';
const view: ProView = {
  pairings: [{ id: 'p1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-25T09:00:00Z', host: 'app.example.org' }],
  ended: [],
  question: null,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** A window on a made-up Pro Golf Tour: what it shows, what was opened, read and sent; a clock and timers the test moves. */
function world(o: { send?: () => Promise<ProView>; read?: (url: string, who: string | null) => TourAnswer | null; storage?: MemoryStorage } = {}) {
  let clock = Date.UTC(2026, 10, 25, 12);
  const storage = o.storage ?? new MemoryStorage();
  const keeper = new TourKeeper(storage, () => clock);
  const timers: { fn: () => void; ms: number }[] = [];
  const opened: string[] = [];
  const sent: unknown[] = [];
  const kept: string[] = [];
  const states: TourState[] = [];
  let at = PROFILE;
  const readOf = (url: string, who: string | null): TourAnswer | null => {
    if (progolftour.profileOf(url)) return { ok: true, profile: progolftour.readProfile(pgtProfile()) as progolftour.Profile };
    const slug = url.split('/').pop() as string;
    const l = progolftour.ownLine(pgtResult(slug, [pgtLine('T6', 'Lena Beispiel', 69, 70, 70), pgtLine('1', 'Otto Erfunden', 66, 67, 68)]), who ?? '');
    return l?.kind === 'result' ? { ok: true, key: l.key, line: l } : l?.kind === 'unread' ? { ok: true, key: progolftour.resultKey(url) as string, unread: l.why } : null;
  };
  const s = new TourSession({
    keeper,
    pro: {
      view: async () => view,
      send: async (page) => {
        sent.push(page);
        return o.send ? o.send() : view;
      },
      answer: async () => view,
    },
    lastPage: { set: async (url) => void kept.push(url) },
    read: async (who) => (o.read ?? readOf)(at, who),
    open: (url) => {
      opened.push(url);
      at = url;
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
  /** The next timer runs, the clock moved by its wait. */
  const tick = async () => {
    const t = timers.shift();
    if (!t) return false;
    clock += t.ms;
    t.fn();
    await flush();
    return true;
  };
  /** The page the run opened finishes loading. */
  const load = async () => {
    await s.loaded(at);
    await flush();
  };
  return { s, keeper, timers, opened, sent, kept, states, tick, load, storage, where: () => at };
}

describe('the tour window, Send', () => {
  it('reads his profile on the tap and sends his ranking; the window opens there next time', async () => {
    const w = world();
    await w.s.start();
    await w.s.send(PROFILE);
    expect(w.sent).toHaveLength(1);
    const page = checkTourPage(w.sent[0]);
    expect(page?.ranking).toMatchObject({ source: 'tour:pro_golf_tour', rank: 7, points: 17290.6, events: 3 });
    expect(page?.tournaments).toEqual([]); // no tournament without its rounds
    expect(w.kept).toEqual([PROFILE]);
    expect(w.s.now.phase).toBe('done');
    expect(w.opened).toEqual([]); // Send opens nothing
  });

  it('says what went wrong, and catches every failure', async () => {
    const noAnswer = world({ read: () => null });
    await noAnswer.s.send(PROFILE);
    expect([noAnswer.s.now.phase, noAnswer.sent.length]).toEqual(['error', 0]);
    const changed = world({ read: () => ({ ok: false, why: 'changed_page' }) });
    await changed.s.send(PROFILE);
    expect(changed.s.now.phase).toBe('changed_page');
    const down = world({ send: () => Promise.reject(new Error('offline')) });
    await down.s.send(PROFILE);
    expect([down.s.now.phase, down.kept]).toEqual(['error', []]);
  });
});

describe('the tour window, Fetch all', () => {
  it('opens his finished tournaments’ pages one by one at the run’s pace, takes his line of each, then sends once', async () => {
    const w = world();
    await w.s.start();
    await w.s.fetchAll(PROFILE);
    expect(w.s.now.tour?.run).toMatchObject({ done: 0, total: 3 });
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      await w.tick(); // the next page opens
      expect(w.opened).toHaveLength(i + 1);
      await w.load();
      expect(w.sent).toEqual([]); // nothing goes out before the run's end
      waits.push(w.timers[0]?.ms ?? 0);
      await w.tick(); // the step after the page: the pause
    }
    while (await w.tick());
    expect(w.opened.every((u) => progolftour.mayOpen(u) && progolftour.resultKey(u))).toBe(true);
    expect(waits.filter((ms) => ms > 0).every((ms) => ms >= 6000)).toBe(true);
    expect(w.sent).toHaveLength(1);
    const page = checkTourPage(w.sent[0]);
    expect(page?.tournaments.map((t) => t.rounds?.length)).toEqual([3, 3, 3]);
    expect(JSON.stringify(w.sent)).not.toContain('Otto Erfunden');
    expect(w.s.now).toMatchObject({ phase: 'done', tour: { run: null } });
  });

  it('a page that doesn’t load is a miss; three in a row end the run, and what it read goes out', async () => {
    const w = world();
    await w.s.fetchAll(PROFILE);
    for (let i = 0; i < 12 && w.timers.length; i++) await w.tick(); // no page ever loads
    expect(w.opened).toHaveLength(3);
    expect(w.sent).toHaveLength(1);
    expect(w.s.now.tour?.run).toBeNull();
  });

  it('Stop and closing the window end the run where it is and send what it read', async () => {
    const w = world();
    await w.s.fetchAll(PROFILE);
    await w.tick();
    await w.load();
    await w.s.stop();
    expect(checkTourPage(w.sent[0])?.tournaments).toHaveLength(1);
    expect(w.s.now.tour?.run).toBeNull();

    const v = world();
    await v.s.fetchAll(PROFILE);
    await v.tick();
    await v.load();
    await v.s.close();
    expect(checkTourPage(v.sent[0])?.tournaments).toHaveLength(1);
    expect(v.timers).toEqual([]); // nothing left to run after the window
  });

  it('a run left by a window that is gone ends when the window opens; nothing opens by itself', async () => {
    const storage = new MemoryStorage();
    const before = world({ storage });
    await before.s.fetchAll(PROFILE);
    const after = world({ storage });
    await after.s.start();
    expect(after.s.now.tour?.run).toBeNull();
    expect(after.timers).toEqual([]);
    expect(after.opened).toEqual([]);
  });

  it('three runs a day, then it says so', async () => {
    const w = world();
    for (let i = 0; i < 3; i++) {
      await w.s.fetchAll(PROFILE);
      await w.s.stop();
    }
    await w.s.fetchAll(PROFILE);
    expect(w.s.now).toMatchObject({ limit: true, phase: 'ready' });
  });

  it('only the page the run opened is read, and a page without his line is noted, not sent', async () => {
    const w = world();
    await w.s.fetchAll(PROFILE);
    await w.tick();
    await w.s.loaded('https://www.progolftour.de/tournament-details/someone-elses'); // not the page it waits for
    expect([w.opened.length, (await w.keeper.view()).read]).toEqual([1, 0]);
    await w.load();
    expect((await w.keeper.view()).read).toBe(1);
    const odd = world({ read: (url) => (progolftour.profileOf(url) ? { ok: true, profile: progolftour.readProfile(pgtProfile()) as progolftour.Profile } : { ok: true, key: progolftour.resultKey(url) as string, unread: 'not_him' }) });
    await odd.s.fetchAll(PROFILE);
    while (await odd.tick()) await odd.load();
    expect(odd.opened).toHaveLength(3);
    expect(checkTourPage(odd.sent[0])?.tournaments).toEqual([]);
  });
});
