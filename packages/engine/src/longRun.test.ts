// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The background task's work, offline and on a virtual clock (longRun.ts): on the iPhone, where iOS starts the app
 * for longer work (`BGProcessingTask`), the older history a chunk at a time with the target's pauses until it is through,
 * the time is up, iOS ends it or the player opens the app; on Android one chunk, as before. Nothing is fetched twice into
 * the target, also when iOS ends the time in the middle of a chunk.
 */
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { MemoryStorage, type FetchLike } from '@glmsync/core';
import { describe, expect, it, vi } from 'vitest';
import { BackgroundRuns, backgroundWork, CHUNK_GUESS_MS, FROZEN_SLACK_MS, LONG_BUDGET_MS, MIN_GAP_S, pauseFor, type LongRunner } from './longRun.ts';
import { MemorySecrets } from './secrets.ts';
import { makeEngine } from './engine.ts';

const T0 = Date.parse('2026-11-28T02:00:00Z');

/** A runner whose chunks take `chunkMs` each and answer the waits given, then null (nothing more now). */
function fakeRunner(clock: VirtualClock, waits: (number | null)[], chunkMs = 40_000) {
  const calls: string[] = [];
  let stopped = 0;
  let during: (() => void) | null = null;
  const runner: LongRunner = {
    async syncAll(reason) {
      calls.push(`sync:${reason}`);
    },
    async backfill() {
      calls.push(`chunk@${(clock.t - T0) / 1000}`);
      const hook = during;
      during = null;
      hook?.();
      clock.advance(chunkMs);
      return waits.length ? (waits.shift() ?? null) : null;
    },
    stop() {
      stopped++;
    },
  };
  return { runner, calls, stopped: () => stopped, duringNextChunk: (fn: () => void) => (during = fn) };
}

/** The clock's sleep, cut short when the signal goes (as `pauseFor` on the phone). */
function abortableSleep(clock: VirtualClock, onSleep?: (ms: number) => void) {
  const slept: number[] = [];
  const sleep = async (ms: number, signal?: AbortSignal) => {
    slept.push(ms);
    onSleep?.(ms);
    if (signal?.aborted) return;
    clock.advance(ms);
  };
  return { sleep, slept };
}

describe('on the iPhone: the older history while iOS lets the app work', () => {
  it('runs the regular look first, then chunk after chunk with the target’s pauses, until nothing more is due', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 90, 75, null]);
    const { sleep, slept } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0', 'chunk@100', 'chunk@230', 'chunk@345']);
    expect(slept).toEqual([60_000, 90_000, 75_000]);
    expect(rec).toMatchObject({ at: new Date(T0).toISOString(), chunks: 4, ended: 'done', ms: 385_000 });
  });

  it('never waits less than a few seconds, whatever the answer (as the screen)', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [0, 2, null], 10_000);
    const { sleep, slept } = abortableSleep(clock);
    await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(slept).toEqual([MIN_GAP_S * 1000, MIN_GAP_S * 1000]);
  });

  it('starts no chunk it could not finish within the time, and sleeps for none', async () => {
    const clock = new VirtualClock(T0);
    // Chunks of 40 s, a minute apart: 100 s a round, so six fit into ten minutes and the sixth's pause is not slept.
    const r = fakeRunner(clock, Array<number>(20).fill(60));
    const { sleep, slept } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(rec.ended).toBe('budget');
    expect(rec.ms).toBeLessThanOrEqual(LONG_BUDGET_MS);
    // The guess of a chunk (until one was measured longer) keeps the last chunk inside the time.
    const last = Number(r.calls.at(-1)?.split('@')[1]) * 1000;
    expect(last + Math.max(CHUNK_GUESS_MS, 40_000)).toBeLessThanOrEqual(LONG_BUDGET_MS);
    expect(slept).toHaveLength(rec.chunks - 1);
    expect(r.stopped()).toBe(0); // nothing cut off: it ended between chunks
  });

  it('a chunk measured longer than the guess counts from then on', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, Array<number>(20).fill(60), 200_000);
    const { sleep } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal });
    // 0-200 s, pause to 260 s, 260-460 s; then 460 + 60 + 200 > 600: the third would run past the time.
    expect(r.calls).toEqual(['sync:timer', 'chunk@0', 'chunk@260']);
    expect(rec).toMatchObject({ chunks: 2, ended: 'budget' });
  });

  it('iOS ending the time during a pause: no further chunk, at once', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, 60, null]);
    const end = new AbortController();
    let n = 0;
    const { sleep } = abortableSleep(clock, () => {
      if (++n === 2) end.abort();
    });
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: end.signal });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0', 'chunk@100']);
    expect(rec).toMatchObject({ chunks: 2, ended: 'expired' });
    expect(clock.t - T0).toBe(140_000); // the second pause wasn't waited out
  });

  it('iOS ending the time in the middle of a chunk stops the runner and starts nothing more', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, null]);
    const end = new AbortController();
    const { sleep } = abortableSleep(clock);
    let chunks = 0;
    const runner: LongRunner = {
      ...r.runner,
      async backfill() {
        if (++chunks === 2) end.abort(); // iOS's expiration arrives while this chunk fetches
        return r.runner.backfill();
      },
    };
    const rec = await backgroundWork({ os: 'ios', runner, now: clock.now, sleep, signal: end.signal });
    expect(r.stopped()).toBe(1);
    expect(r.calls).toEqual(['sync:timer', 'chunk@0', 'chunk@100']);
    expect(rec).toMatchObject({ chunks: 2, ended: 'expired' });
  });

  it('time already over before it began: nothing at all', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60]);
    const end = new AbortController();
    end.abort();
    const { sleep } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: end.signal });
    expect(r.calls).toEqual([]);
    expect(rec).toMatchObject({ chunks: 0, ended: 'expired' });
  });

  it('the player opening the app ends it before the next chunk: the screen’s own loop takes over', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, null]);
    let front = false;
    const { sleep } = abortableSleep(clock, () => {
      front = true;
    });
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal, inFront: () => front });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0']);
    expect(r.stopped()).toBe(0); // the chunk under way was never cut
    expect(rec).toMatchObject({ chunks: 1, ended: 'front' });
  });

  it('a regular look that fails keeps no chunk from running; a chunk that throws ends it, without throwing', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, null]);
    const { sleep } = abortableSleep(clock);
    const failing: LongRunner = {
      ...r.runner,
      async syncAll() {
        throw new Error('storage');
      },
    };
    expect(await backgroundWork({ os: 'ios', runner: failing, now: clock.now, sleep, signal: new AbortController().signal })).toMatchObject({ chunks: 2, ended: 'done' });
    const broken: LongRunner = {
      ...r.runner,
      async backfill() {
        throw new TypeError('broken');
      },
    };
    expect(await backgroundWork({ os: 'ios', runner: broken, now: clock.now, sleep, signal: new AbortController().signal })).toMatchObject({ chunks: 0, ended: 'failed' });
  });
});

describe('frozen by iOS without a word (its end never reached the run; the first night, 27/28 Nov)', () => {
  // iOS ended the tasks after 20 s to a minute and rescheduled them, but the runs never heard: each froze in the middle of a
  // step and went on half an hour later, when iOS started the next task, then ended as `budget` with 30 minutes - as if
  // it had worked the ten. A step that returns that far past the run's time can only come back from such a freeze.
  const FREEZE = 30 * 60_000;

  it('frozen in the middle of a chunk: ends as `frozen` once the chunk comes back, counting only the time seen working', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, 60, null]);
    let n = 0;
    const runner: LongRunner = {
      ...r.runner,
      async backfill() {
        if (++n === 2) clock.advance(FREEZE);
        return r.runner.backfill();
      },
    };
    const { sleep } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0', 'chunk@1900']);
    // The thawed chunk is not cut: what it fetched still goes to the target, which keeps each session once.
    expect(r.stopped()).toBe(0);
    expect(rec).toMatchObject({ chunks: 2, ended: 'frozen', ms: 100_000 });
  });

  it('frozen in a pause: no further chunk after it, the time up to the pause', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, null]);
    const { sleep } = abortableSleep(clock, () => clock.advance(FREEZE));
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0']);
    expect(rec).toMatchObject({ chunks: 1, ended: 'frozen', ms: 40_000 });
  });

  it('iOS’s word heard only on the thaw is a freeze too, timed up to the step it froze in', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, null]);
    const end = new AbortController();
    const { sleep } = abortableSleep(clock, () => {
      clock.advance(FREEZE);
      end.abort();
    });
    const rec = await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: end.signal });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0']);
    expect(rec).toMatchObject({ chunks: 1, ended: 'frozen', ms: 40_000 });
  });

  it('frozen in the regular look: no chunk at all', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, null]);
    const runner: LongRunner = { ...r.runner, syncAll: async () => void clock.advance(FREEZE) };
    const { sleep } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(r.calls).toEqual([]);
    expect(rec).toMatchObject({ chunks: 0, ended: 'frozen', ms: 0 });
  });

  it('a chunk that only runs long past the time is no freeze', async () => {
    const clock = new VirtualClock(T0);
    // 40 s chunks a minute apart until the sixth, at 500 s, which takes four minutes: 740 s, past the ten, not frozen.
    const r = fakeRunner(clock, Array<number>(20).fill(60));
    let n = 0;
    const runner: LongRunner = {
      ...r.runner,
      async backfill() {
        if (++n === 6) clock.advance(200_000);
        return r.runner.backfill();
      },
    };
    const { sleep } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'ios', runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(rec).toMatchObject({ chunks: 6, ended: 'budget', ms: 740_000 });
    expect(LONG_BUDGET_MS + FROZEN_SLACK_MS).toBeGreaterThan(740_000);
  });

  it('nothing afterwards for a frozen run (its time is gone), and Android keeps its one chunk', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, null]);
    const { sleep } = abortableSleep(clock, () => clock.advance(FREEZE));
    const after = vi.fn(async () => undefined);
    expect(await backgroundWork({ os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal, afterwards: after })).toMatchObject({ ended: 'frozen' });
    expect(after).not.toHaveBeenCalled();

    const a = fakeRunner(clock, [60, null], FREEZE);
    expect(await backgroundWork({ os: 'android', runner: a.runner, now: clock.now, sleep, signal: new AbortController().signal })).toMatchObject({ chunks: 1, ended: 'done' });
  });

  it('the exported log keeps a frozen run', async () => {
    const storage = new MemoryStorage();
    await new BackgroundRuns(storage).add({ at: new Date(T0).toISOString(), ms: 19_000, chunks: 1, ended: 'frozen' });
    expect(await new BackgroundRuns(storage).list()).toEqual([{ at: new Date(T0).toISOString(), ms: 19_000, chunks: 1, ended: 'frozen' }]);
  });
});

describe('afterwards: what the app does with the time left (the companion: its over-the-air update)', () => {
  it('runs once the sync is done or the time is up, with the task’s signal, and not when iOS ended it or the player came', async () => {
    const run = async (os: 'ios' | 'android', end: 'done' | 'budget' | 'expired' | 'front' | 'failed') => {
      const clock = new VirtualClock(T0);
      const r = fakeRunner(clock, end === 'budget' ? [60, 60, 60, 60, 60, 60, 60, 60, 60, 60] : [60, null]);
      const stop = new AbortController();
      const { sleep } = abortableSleep(clock, () => {
        if (end === 'expired') stop.abort();
      });
      const broken: LongRunner = end === 'failed' ? { ...r.runner, backfill: async () => Promise.reject(new TypeError('x')) } : r.runner;
      const seen: AbortSignal[] = [];
      const order: string[] = [];
      const runner: LongRunner = { ...broken, backfill: async () => (order.push('chunk'), broken.backfill()) };
      const rec = await backgroundWork({
        os, runner, now: clock.now, sleep, signal: stop.signal, inFront: () => end === 'front' && order.length > 0,
        afterwards: async (signal) => {
          seen.push(signal);
          order.push('afterwards');
        },
      });
      return { rec, seen, order, signal: stop.signal };
    };
    for (const os of ['ios', 'android'] as const) {
      const done = await run(os, 'done');
      expect(done.rec.ended).toBe('done');
      expect(done.order.at(-1)).toBe('afterwards');
      expect(done.seen).toEqual([done.signal]);
    }
    expect((await run('ios', 'budget')).order.at(-1)).toBe('afterwards');
    expect((await run('ios', 'failed')).order).toEqual(['chunk', 'afterwards']); // an update may be what mends it
    expect((await run('ios', 'expired')).seen).toEqual([]);
    expect((await run('ios', 'front')).seen).toEqual([]);
  });

  it('a step that throws or hangs past iOS’s end costs the run nothing', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [null]);
    const { sleep } = abortableSleep(clock);
    const rec = await backgroundWork({
      os: 'ios', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal,
      afterwards: async () => {
        throw new Error('update server');
      },
    });
    expect(rec).toMatchObject({ chunks: 1, ended: 'done' });
  });
});

describe('on Android: as before', () => {
  it('the regular look and one chunk, whatever comes next', async () => {
    const clock = new VirtualClock(T0);
    const r = fakeRunner(clock, [60, 60, null]);
    const { sleep, slept } = abortableSleep(clock);
    const rec = await backgroundWork({ os: 'android', runner: r.runner, now: clock.now, sleep, signal: new AbortController().signal });
    expect(r.calls).toEqual(['sync:timer', 'chunk@0']);
    expect(slept).toEqual([]);
    expect(rec).toMatchObject({ chunks: 1, ended: 'done' });
  });
});

describe('against a made-up target and a made-up Trackman', () => {
  const SUB = '7c1d2e3f-0000-4000-8000-0000000000c1';
  const DAY = 86_400_000;

  /** Seven sessions in the provider's history; the target asks for two a chunk, a minute apart, and knows what it has. */
  function world() {
    const clock = new VirtualClock(T0);
    const target = new FakeTarget({
      plan: (ask, t) => {
        if (ask.reason !== 'backfill') return { due: false };
        const left = tm.activities.filter((a) => !t.known().includes(String(a.id))).length;
        if (!left) return { due: false, history: { done: true } };
        if (last !== null && clock.t - last < 60_000) return { due: false, wait_s: Math.ceil((60_000 - (clock.t - last)) / 1000), history: { done: false } };
        last = clock.t;
        return { due: true, plan_id: `h-${clock.t}`, known_ids: t.known(), rounds: false, round_shots: false, max_sessions: 2, history: { done: false } };
      },
    });
    let last: number | null = null;
    const tm = new FakeTrackman(clock.now);
    const token = fakeToken(SUB, { exp: Math.floor((clock.t + 7 * DAY) / 1000) });
    tm.tokens.add(token);
    tm.activities = Array.from({ length: 7 }, (_, i) => ({ id: `A${i + 1}`, time: new Date(clock.t - (i + 1) * DAY).toISOString(), kind: 'RANGE_PRACTICE' }));
    for (const a of tm.activities) tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
    let onRequest: ((body: string) => void) | null = null;
    const fetch: FetchLike = (url, init) => {
      if (url === GRAPHQL_URL) {
        onRequest?.(String(init?.body ?? ''));
        return tm.fetch(url, init);
      }
      return target.fetch(url, init);
    };
    const services = makeEngine({ secrets: new MemorySecrets(), storage: new MemoryStorage(), fetch, now: clock.now, sleep: clock.sleep });
    const imported = () => target.imports.flatMap((b) => b.sessions.map((s) => s.external_id));
    return { clock, target, tm, token, services, imported, cut: (fn: ((body: string) => void) | null) => (onRequest = fn) };
  }

  async function ready(w: ReturnType<typeof world>) {
    await w.services.load();
    await w.services.runner.pair({ target: w.target.base, code: 'K7M2PQ9X' });
    await w.services.signIns.set('trackman', w.token);
  }

  it('one night brings the whole history, each session once, with the target’s minute between chunks', async () => {
    const w = world();
    await ready(w);
    const { sleep } = abortableSleep(w.clock);
    const rec = await backgroundWork({ os: 'ios', runner: w.services.runner, now: w.clock.now, sleep, signal: new AbortController().signal });
    expect(rec.ended).toBe('done');
    expect(rec.chunks).toBe(5); // four of two sessions, then the one that hears the history is done
    expect(w.imported().sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
    const chunkPlans = w.target.asked.filter((p) => p.reason === 'backfill');
    expect(chunkPlans.length).toBeGreaterThanOrEqual(4);
  });

  it('cut by iOS in the middle of a chunk: what that chunk fetched goes nowhere, the next night brings it, nothing twice', async () => {
    const w = world();
    await ready(w);
    const end = new AbortController();
    let seen = 0;
    // The first chunk lists the activities and fetches two sessions; iOS ends the time at the second chunk's second
    // session, after its first came.
    w.cut((body) => {
      if (/query Session\(/.test(body) && ++seen === 4) end.abort();
    });
    const { sleep } = abortableSleep(w.clock);
    const first = await backgroundWork({ os: 'ios', runner: w.services.runner, now: w.clock.now, sleep, signal: end.signal });
    expect(first.ended).toBe('expired');
    // Only the first chunk's two: the cut chunk handed nothing over.
    expect(w.imported().sort()).toEqual(['A1', 'A2']);

    w.cut(null);
    w.clock.advance(6 * 3600_000);
    const second = await backgroundWork({ os: 'ios', runner: w.services.runner, now: w.clock.now, sleep, signal: new AbortController().signal });
    expect(second.ended).toBe('done');
    const all = w.imported();
    expect(all.sort()).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']); // each exactly once
  });
});

describe('what each background run leaves (for the exported log)', () => {
  it('keeps the last runs, newest last, at most twenty, and reads a broken store as none', async () => {
    const storage = new MemoryStorage();
    const runs = new BackgroundRuns(storage);
    for (let i = 0; i < 25; i++) await runs.add({ at: new Date(T0 + i * 60_000).toISOString(), ms: 1000, chunks: i, ended: 'done' });
    const list = await runs.list();
    expect(list).toHaveLength(20);
    expect(list.at(-1)?.chunks).toBe(24);
    await storage.set('glmsync/companion/background', '{not json');
    expect(await new BackgroundRuns(storage).list()).toEqual([]);
    await storage.set('glmsync/companion/background', JSON.stringify([{ at: 'x', ms: 'y' }, { at: new Date(T0).toISOString(), ms: 5, chunks: 1, ended: 'budget' }]));
    expect(await new BackgroundRuns(storage).list()).toEqual([{ at: new Date(T0).toISOString(), ms: 5, chunks: 1, ended: 'budget' }]);
  });

  it('a store that fails to write costs the run nothing', async () => {
    const storage = new MemoryStorage();
    storage.set = async () => {
      throw new Error('full');
    };
    await expect(new BackgroundRuns(storage).add({ at: new Date(T0).toISOString(), ms: 1, chunks: 0, ended: 'done' })).resolves.toBeUndefined();
  });
});

describe('pauseFor (the phone’s sleep)', () => {
  it('waits the time, and ends at once when the signal goes', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      void pauseFor(60_000).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(59_000);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(done).toBe(true);
      const end = new AbortController();
      let cut = false;
      void pauseFor(60_000, end.signal).then(() => (cut = true));
      end.abort();
      await vi.advanceTimersByTimeAsync(0);
      expect(cut).toBe(true);
      expect(vi.getTimerCount()).toBe(0); // its timer went with it
      const gone = new AbortController();
      gone.abort();
      await expect(pauseFor(60_000, gone.signal)).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the exported log', () => {
  it('carries the last background runs beside the guard’s requests', async () => {
    const services = makeEngine({ secrets: new MemorySecrets(), storage: new MemoryStorage(), now: () => T0 });
    await services.load();
    await services.background.add({ at: new Date(T0).toISOString(), ms: 480_000, chunks: 4, ended: 'budget' });
    const file = JSON.parse((await services.runner.logFile()).text) as { format: string; background_runs: unknown };
    expect(file.format).toBe('glmsync-guard-log/1');
    expect(file.background_runs).toEqual([{ at: new Date(T0).toISOString(), ms: 480_000, chunks: 4, ended: 'budget' }]);
  });
});
