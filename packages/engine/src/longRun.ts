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

/** What of the runner this needs. */
export interface LongRunner {
  syncAll(reason: Reason): Promise<unknown>;
  /** One chunk per pairing; the seconds until the next may go, or null when there is nothing to do now. */
  backfill(): Promise<number | null>;
  stop(): void;
}

export type LongEnd = 'done' | 'budget' | 'expired' | 'front' | 'failed';

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
}

/** The task's work. Never throws; says how it ended. */
export async function backgroundWork(opts: BackgroundWorkOptions): Promise<BackgroundRun> {
  const start = opts.now();
  const budget = opts.budgetMs ?? LONG_BUDGET_MS;
  let chunks = 0;
  const done = (ended: LongEnd): BackgroundRun => ({ at: new Date(start).toISOString(), ms: opts.now() - start, chunks, ended });
  if (opts.signal.aborted) return done('expired');

  // iOS's end stops what runs at once: a chunk under way ends as `cancelled` and hands nothing over.
  const cut = () => opts.runner.stop();
  opts.signal.addEventListener('abort', cut, { once: true });
  try {
    try {
      await opts.runner.syncAll('timer');
    } catch {
      // The runner records every way a run ends; a broken store shows again in the chunk below.
    }
    let longest = CHUNK_GUESS_MS;
    for (;;) {
      if (opts.signal.aborted) return done('expired');
      if (opts.inFront?.()) return done('front');
      if (opts.os === 'ios' && opts.now() - start + longest > budget) return done('budget');
      const began = opts.now();
      let wait: number | null;
      try {
        wait = await opts.runner.backfill();
      } catch {
        return done('failed');
      }
      chunks++;
      longest = Math.max(longest, opts.now() - began);
      if (opts.signal.aborted) return done('expired');
      if (opts.os !== 'ios' || wait === null) return done('done');
      const gap = Math.max(MIN_GAP_S, wait) * 1000;
      // A pause after which no chunk fits any more isn't waited out.
      if (opts.now() - start + gap + longest > budget) return done('budget');
      await opts.sleep(gap, opts.signal);
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
const ENDS: readonly LongEnd[] = ['done', 'budget', 'expired', 'front', 'failed'];

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
