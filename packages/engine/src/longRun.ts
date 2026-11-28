// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a background task does (the companion's src/background.ts runs it, an app embedding the engine its own; the
 * rules live here, tested on a virtual clock).
 *
 * On the iPhone `expo-background-task` is a `BGProcessingTask` (UIBackgroundModes `processing`): iOS starts the app for
 * it when it likes - mostly while the phone charges and nobody uses it, at night - and lets it work for minutes, not the
 * half minute of a wake. So there it does the regular look (`timer`) and then the older history chunk after chunk, each
 * asked of the target's plan and spaced as the target says, the guard as always, until the history is through (or not
 * due for long), the time below runs out, iOS ends the task, or the player opens the app (the screen's own loop takes
 * over). A chunk starts only if it can end within the time; iOS ending it in the middle of one stops the runner there:
 * that chunk hands nothing over (`cancelled`), the target keeps what it had, and the next plan - this client takes its
 * own lease over - asks for it again. Nothing reaches the target twice.
 *
 * On Android (WorkManager, at most ten minutes, no word when it ends) one chunk per run, as before; its timer comes
 * every half hour anyway.
 */

import { readJson, type Storage } from '@glmsync/core';
import type { Reason } from '@glmsync/spec';

/** How long a run on the iPhone goes on at most. iOS doesn't say how long it gives; its expiration ends it sooner. */
export const LONG_BUDGET_MS = 10 * 60_000;
/** What a chunk is taken to last until one was measured longer: ten sessions at the guard's pace, with room. */
export const CHUNK_GUESS_MS = 90_000;
/** The shortest pause between chunks, whatever the target answered (as the screen's loop). */
export const MIN_GAP_S = 5;
/**
 * How far past its own time a run on the iPhone gets only when iOS froze it. iOS ends a task when it likes and starts the
 * next one half an hour later at the earliest; its word that it ended it may never reach JavaScript (the first night,
 * 27/28 Nov: six runs cut after 20 s to a minute, five never heard it, one an hour and a half late). The frozen run then
 * goes on when the app is next woken, in the middle of whatever it was doing. A chunk that merely runs long stays well
 * inside this.
 */
export const FROZEN_SLACK_MS = 5 * 60_000;

/** What of the runner this needs. */
export interface LongRunner {
  syncAll(reason: Reason): Promise<unknown>;
  /** One chunk per pairing; the seconds until the next may go, or null when there is nothing to do now. */
  backfill(): Promise<number | null>;
  stop(): void;
}

/**
 * `frozen`: iOS stopped the app in the middle of the run without the run hearing of it (see FROZEN_SLACK_MS); its `ms`
 * is then the time it was seen working, up to the step it froze in - how long iOS really let it work, at least.
 */
export type LongEnd = 'done' | 'budget' | 'expired' | 'frozen' | 'front' | 'failed';

/** One background run, as the exported log shows it: times and counts, nothing of the player. */
export interface BackgroundRun {
  at: string;
  ms: number;
  chunks: number;
  ended: LongEnd;
}

export interface BackgroundWorkOptions {
  os: 'ios' | 'android';
  runner: LongRunner;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Goes when iOS ends the task's time. */
  signal: AbortSignal;
  /** Whether the app is in front now (its screen then fetches the history itself). */
  inFront?: () => boolean;
  budgetMs?: number;
  /**
   * What the app does with the time left once the sync is done, the time is up or a chunk failed - not when the system
   * ended the task or the player opened the app. The companion fetches its over-the-air update there (it applies at the
   * next start). Given the task's signal; what it throws or how long it hangs changes nothing of the run's record.
   */
  afterwards?: (signal: AbortSignal) => Promise<unknown>;
}

/** The task's work. Never throws; says how it ended. */
export async function backgroundWork(opts: BackgroundWorkOptions): Promise<BackgroundRun> {
  const run = await syncWork(opts);
  if (opts.afterwards && run.ended !== 'expired' && run.ended !== 'frozen' && run.ended !== 'front' && !opts.signal.aborted) {
    try {
      await opts.afterwards(opts.signal);
    } catch {
      // the app's own step: the sync's record stands
    }
  }
  return run;
}

async function syncWork(opts: BackgroundWorkOptions): Promise<BackgroundRun> {
  const start = opts.now();
  const budget = opts.budgetMs ?? LONG_BUDGET_MS;
  let chunks = 0;
  const done = (ended: LongEnd): BackgroundRun => ({ at: new Date(start).toISOString(), ms: opts.now() - start, chunks, ended });
  if (opts.signal.aborted) return done('expired');
  // When the step begun at `seen` came back: whether iOS froze the run in it. Then the run ends there, counting the time
  // up to that step; the step's own result stands (a thawed chunk hands over what it fetched, the target keeps each
  // session once), but nothing more is started in a time that is long gone.
  let seen = start;
  const frozen = () => opts.os === 'ios' && opts.now() - start > budget + FROZEN_SLACK_MS;
  const thawed = (): BackgroundRun => ({ at: new Date(start).toISOString(), ms: seen - start, chunks, ended: 'frozen' });

  // iOS's end stops what runs at once: a chunk under way ends as `cancelled` and hands nothing over.
  const cut = () => opts.runner.stop();
  opts.signal.addEventListener('abort', cut, { once: true });
  try {
    try {
      await opts.runner.syncAll('timer');
    } catch {
      // The runner records every way a run ends; a broken store shows again in the chunk below.
    }
    if (frozen()) return thawed();
    let longest = CHUNK_GUESS_MS;
    for (;;) {
      if (opts.signal.aborted) return done('expired');
      if (opts.inFront?.()) return done('front');
      if (opts.os === 'ios' && opts.now() - start + longest > budget) return done('budget');
      const began = opts.now();
      seen = began;
      let wait: number | null;
      try {
        wait = await opts.runner.backfill();
      } catch {
        return frozen() ? thawed() : done('failed');
      }
      chunks++;
      // Frozen first: iOS's word arriving only on the thaw (as once that night, an hour and a half late) is a freeze too.
      if (frozen()) return thawed();
      if (opts.signal.aborted) return done('expired');
      longest = Math.max(longest, opts.now() - began);
      if (opts.os !== 'ios' || wait === null) return done('done');
      const gap = Math.max(MIN_GAP_S, wait) * 1000;
      // A pause after which no chunk fits any more isn't waited out.
      if (opts.now() - start + gap + longest > budget) return done('budget');
      seen = opts.now();
      await opts.sleep(gap, opts.signal);
      if (frozen()) return thawed();
    }
  } finally {
    opts.signal.removeEventListener('abort', cut);
  }
}

/** The phone's pause: a timer, gone at once (and resolved) when the signal goes. Never rejects. */
export function pauseFor(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const end = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', end);
      resolve();
    }, ms);
    signal?.addEventListener('abort', end, { once: true });
  });
}

const KEY = 'glmsync/companion/background';
const KEEP = 20;
const ENDS: readonly LongEnd[] = ['done', 'budget', 'expired', 'frozen', 'front', 'failed'];

const isRun = (v: unknown): v is BackgroundRun => {
  const r = v as Partial<BackgroundRun> | null;
  return (
    !!r &&
    typeof r.at === 'string' &&
    !Number.isNaN(Date.parse(r.at)) &&
    typeof r.ms === 'number' &&
    Number.isFinite(r.ms) &&
    typeof r.chunks === 'number' &&
    Number.isInteger(r.chunks) &&
    ENDS.includes(r.ended as LongEnd)
  );
};

/** The last background runs, for the exported log (how long iOS let the app work, and how each ended). */
export class BackgroundRuns {
  constructor(private readonly storage: Storage) {}

  async list(): Promise<BackgroundRun[]> {
    try {
      const v = await readJson(this.storage, KEY);
      return Array.isArray(v) ? v.filter(isRun).map(({ at, ms, chunks, ended }) => ({ at, ms, chunks, ended })) : [];
    } catch {
      return [];
    }
  }

  /** Never throws: a store that fails costs the run nothing. */
  async add(run: BackgroundRun): Promise<void> {
    try {
      const runs = [...(await this.list()), run].slice(-KEEP);
      await this.storage.set(KEY, JSON.stringify(runs));
    } catch {
      // only the log misses it
    }
  }
}
