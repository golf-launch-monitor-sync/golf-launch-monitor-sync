// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { RunKeeper } from '@glmsync/browser/runs';
import { MemoryStorage, type Storage } from '@glmsync/core';
import { alps, europeantour, ocs, run as pick, type operate, type RunFamily } from '@glmsync/provider-tours';
import { describe, expect, it } from 'vitest';
import { PickRunDriver, type PickRunDeps, type RunState } from './pickRun.ts';
import { WINDOW } from './toursPage.ts';

const TODAY = '2026-11-26';
const ALPS = 'https://www.alpstourgolf.com/playerprofile/TST001';
const ALPS_OTHER = 'https://www.alpstourgolf.com/playerprofile/VAN054';
const ET = 'https://www.europeantour.com/players/jonas-beispiel-99002/';
const ET_OTHER = 'https://www.europeantour.com/players/otto-erfunden-99003/';
const LET = 'https://letaccess.com/player-profiles/990001/';
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

type PickStep = Extract<pick.PickStep, { do: 'pick' }>;

/**
 * A tour window on the phone, made up: the extension's keeper on this phone's storage, a clock and timers the test runs,
 * the page script's picks and the window's opens answered as the test says. `loads`: an opened page loads in the window
 * (the window then tells the run, as ToursView does).
 */
function world(o: { pickAs?: (step: PickStep) => operate.PickResult | null; lookAs?: (url: string) => 'read' | 'unread'; loads?: boolean; storage?: Storage; player?: (url: string) => string | null } = {}) {
  let now = Date.UTC(2026, 10, 26, 12);
  const storage = o.storage ?? new MemoryStorage();
  const runs = new RunKeeper(storage, () => now);
  const timers: { fn: () => void; ms: number }[] = [];
  const picks: string[] = [];
  const opened: string[] = [];
  const looked: string[] = [];
  const sent: RunFamily[] = [];
  const dropped: RunFamily[] = [];
  const fresh: RunFamily[] = [];
  const states: RunState[] = [];
  let failures = 0;
  const deps: PickRunDeps = {
    runs,
    pick: async (step) => {
      picks.push(step.value);
      return o.pickAs ? o.pickAs(step) : 'picked';
    },
    open: (url) => {
      opened.push(url);
      if (o.loads !== false) {
        // The window goes there and, once loaded, tells the run.
        void Promise.resolve().then(() => {
          d.moved(url);
          return d.loaded(url);
        });
      }
    },
    look: async (url) => {
      looked.push(url);
      return o.lookAs ? o.lookAs(url) : 'read';
    },
    player: o.player ?? ((url) => alps.profileIdOf(url) ?? europeantour.playerPageOf(url)?.id ?? ocs.profileIdOf(url)),
    fresh: async (f) => void fresh.push(f),
    send: async (f) => void sent.push(f),
    drop: async (f) => void dropped.push(f),
    failed: () => void (failures += 1),
    today: () => TODAY,
    onChange: (st) => void states.push(st),
    schedule: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    cancel: (h) => {
      const i = timers.indexOf(h as { fn: () => void; ms: number });
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const d = new PickRunDriver(deps);
  /** The next timer: the clock moves on by its time, then it runs. */
  const tick = async () => {
    const t = timers.shift();
    if (!t) return false;
    now += t.ms;
    t.fn();
    await flush();
    return true;
  };
  /** Every timer, until the run rests (or a bound, so a loop would fail the test rather than hang it). */
  const drain = async (most = 400) => {
    for (let i = 0; i < most && (await tick()); i++);
  };
  return { d, runs, timers, picks, opened, looked, sent, dropped, fresh, states, tick, drain, failures: () => failures, go: (ms: number) => (now += ms), now: () => now };
}

describe('Fetch all in the tour window', () => {
  it('on his Alps Tour profile: the three reports picked one after the other, each read, at a person\'s pace; one send at the end', async () => {
    const w = world();
    await w.d.start();
    await w.d.fetchAll(ALPS);
    expect(w.d.running).toBe(true);
    expect(w.d.now.view?.running).toMatchObject({ family: 'alps', done: 0, total: 3, tab: WINDOW });
    const started = w.now();
    await w.drain();
    expect(w.picks).toEqual(['This Season record', 'Results', 'Order of Merit']);
    expect(w.looked).toEqual([ALPS, ALPS, ALPS]);
    expect(w.sent).toEqual(['alps']);
    expect(w.opened).toEqual([]); // nothing opened on the Alps Tour
    // Two pauses of 6-10 s between the three picks, one more before the end.
    expect(w.now() - started).toBeGreaterThanOrEqual(3 * pick.TOUR_CLICKS.pause_ms[0]);
    expect(w.d.running).toBe(false);
    expect(w.d.now.view?.ended).toEqual({ family: 'alps', how: 'done' });
    expect(w.failures()).toBe(0);
  });

  it('three runs a day per tour, as in the extension: the fourth is refused and says so', async () => {
    const w = world();
    await w.d.start();
    for (let i = 0; i < 3; i++) {
      await w.d.fetchAll(ALPS);
      await w.drain();
    }
    expect(w.sent).toEqual(['alps', 'alps', 'alps']);
    await w.d.fetchAll(ALPS);
    expect(w.d.now.limit).toBe(true);
    expect(w.d.running).toBe(false);
    w.d.moved(ALPS); // another page: the note is over
    expect(w.d.now.limit).toBe(false);
  });

  it('on europeantour.com: his own pages opened in the window, each read once loaded, the seasons and tours picked; a page per tour at the end', async () => {
    const w = world();
    await w.d.start();
    await w.d.fetchAll(ET);
    await w.drain();
    const base = 'https://www.europeantour.com/players/jonas-beispiel-99002/';
    expect(w.opened).toEqual([`${base}?tour=dpworld-tour`, `${base}?tour=hotelplanner-tour`, `${base}results/?tour=dpworld-tour`, `${base}stats/?tour=dpworld-tour`]);
    // The DP World Tour's next season too (it starts in November), back to two years ago; then each tour on *Stats*.
    expect(w.picks).toEqual(['2027', '2026', '2025', '2024', 'DP World Tour', 'HotelPlanner Tour']);
    expect(w.looked).toHaveLength(4 + 6);
    expect(w.sent).toEqual(['europeantour']);
    expect(w.d.now.view?.ended).toEqual({ family: 'europeantour', how: 'done' });
  });

  it('a season the page doesn\'t offer is skipped without a read; a picker that isn\'t there, or no answer, reads nothing and the run goes on', async () => {
    const w = world({ pickAs: (s) => (s.value === '2024' ? 'absent' : s.value === '2025' ? 'missing' : s.value === 'DP World Tour' ? null : 'picked') });
    await w.d.start();
    await w.d.fetchAll(ET);
    await w.drain();
    expect(w.picks).toEqual(['2027', '2026', '2025', '2024', 'DP World Tour', 'HotelPlanner Tour']);
    expect(w.looked).toHaveLength(4 + 3); // the opened pages, 2027, 2026, HotelPlanner Tour
    expect(w.sent).toEqual(['europeantour']);
  });

  it('a page that doesn\'t answer counts as a miss; three in a row end the run, and what was read goes out', async () => {
    const w = world({ loads: false });
    await w.d.start();
    await w.d.fetchAll(ET);
    await w.drain();
    expect(w.opened).toHaveLength(3);
    expect(w.looked).toEqual([]);
    expect(w.d.now.view?.ended).toEqual({ family: 'europeantour', how: 'no_answer' });
    expect(w.sent).toEqual(['europeantour']);
  });

  it('another player\'s page opened meanwhile ends the run, and nothing goes', async () => {
    const w = world({ loads: false });
    await w.d.start();
    await w.d.fetchAll(ET);
    await w.tick(); // the first step: his overview opened
    expect(w.opened).toHaveLength(1);
    // He follows a link to someone else's page meanwhile.
    w.d.moved(ET_OTHER);
    expect(await w.d.loaded(ET_OTHER)).toBe(true);
    await flush();
    expect(w.d.running).toBe(false);
    expect(w.d.now.view?.ended).toEqual({ family: 'europeantour', how: 'other_player' });
    expect(w.dropped).toEqual(['europeantour']);
    expect(w.sent).toEqual([]);
    await w.drain();
    expect(w.opened).toHaveLength(1); // nothing more opened
  });

  it('a page of his that isn\'t the one awaited is the run\'s too (no read of the session\'s own), and changes nothing of its pace', async () => {
    const w = world({ loads: false });
    await w.d.start();
    await w.d.fetchAll(ET);
    await w.tick();
    const waiting = w.timers.length;
    expect(await w.d.loaded('https://www.europeantour.com/players/jonas-beispiel-99002/stats/')).toBe(true);
    await flush();
    expect(w.looked).toEqual([]);
    expect(w.timers.length).toBe(waiting);
    expect(w.d.running).toBe(true);
    // Without a run, a loaded page is the session's.
    const v = world();
    expect(await v.d.loaded(ET)).toBe(false);
    expect(v.d.takes(ET)).toBe(false);
  });

  it('Stop ends it where it is and what was read goes out; closing the window does the same', async () => {
    const w = world();
    await w.d.start();
    await w.d.fetchAll(ALPS);
    await w.tick();
    expect(w.picks).toEqual(['This Season record']);
    await w.d.stop();
    expect(w.d.running).toBe(false);
    expect(w.sent).toEqual(['alps']);
    await w.drain();
    expect(w.picks).toEqual(['This Season record']);

    const v = world();
    await v.d.start();
    await v.d.fetchAll(LET);
    await v.tick();
    await v.d.close();
    expect(v.sent).toEqual(['tour:let_access']);
    expect((await v.runs.view()).running).toBeNull();
    expect(v.timers).toEqual([]);
  });

  it('a run left by a window that is gone ends when a window opens; a season site\'s run starts afresh from nothing kept', async () => {
    const storage = new MemoryStorage();
    const gone = world({ storage });
    await gone.d.fetchAll('https://www.pgatour.com/player/99002/max-erfunden/results');
    expect(gone.fresh).toEqual(['pgatour']);
    const w = world({ storage });
    await w.d.start();
    expect(w.d.running).toBe(false);
    expect((await w.runs.view()).running).toBeNull();
    expect(w.sent).toEqual([]); // what it read stays kept
    // Another tap starts a new run (the second of the day).
    await w.d.fetchAll(ALPS);
    expect(w.d.running).toBe(true);
  });

  it('a page no run starts on, and a keeper that can\'t be read, end in the bar\'s error - never uncaught', async () => {
    const w = world();
    await w.d.start();
    await w.d.fetchAll('https://www.alpstourgolf.com/stats');
    expect(w.failures()).toBe(1);
    expect(w.d.running).toBe(false);

    const broken: Storage = { get: () => Promise.reject(new Error('x')), set: () => Promise.reject(new Error('x')), remove: () => Promise.reject(new Error('x')) } as unknown as Storage;
    const b = world({ storage: broken });
    await b.d.start(); // read as nothing kept (the keeper's own rule)
    await b.d.fetchAll(ALPS); // can't be kept: the bar says error
    expect(b.d.running).toBe(false);
    await b.d.stop();
    await b.d.close();
    expect(b.failures()).toBeGreaterThanOrEqual(1);
  });

  it('a read that throws counts as nothing read; the run goes on to its end', async () => {
    const w = world({ lookAs: () => { throw new Error('page gone'); } });
    await w.d.start();
    await w.d.fetchAll(ALPS);
    await w.drain();
    expect(w.picks).toHaveLength(3);
    expect(w.sent).toEqual(['alps']);
    expect(w.failures()).toBe(0);
  });

  it('the other player\'s page by the address the keeper compares: his own Alps profile is no other', async () => {
    const w = world();
    await w.d.start();
    await w.d.fetchAll(ALPS);
    // The site moves to another profile while a pick waits: the next step's answer names another player.
    w.d.moved(ALPS_OTHER);
    await w.drain();
    expect(w.d.now.view?.ended).toEqual({ family: 'alps', how: 'other_player' });
    expect(w.sent).toEqual([]);
    expect(w.dropped).toEqual(['alps']);
  });
});
