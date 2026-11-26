// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the Pro Golf Tour: on the player's tap on his own profile, the client opens the pages of his
 * finished tournaments of that season one by one, as he would by their links, and reads his line on each (the rounds
 * the profile doesn't show). Nothing by itself: no timer, only on his tap, and only pages the profile links to.
 *
 * Pure, as golf.de's run: a run is a value (kept as JSON by the client), moved on by what a page showed (`seeRun`) and
 * by time (`nextStep`). The pace is a person's and the site's own wish (robots.txt: `Crawl-delay: 5`), shared with the
 * other tours' *Fetch all* (`run.ts`, `TOUR_CLICKS`): it moves down after a measurement, never up without one, and no
 * option or setting loosens it.
 */

import type { OwnLine, Profile, Unread } from './progolftour.ts';
import { resultUrl } from './progolftour.ts';
import { DAY_MS, mayStart, pauseOf, TOUR_CLICKS } from './run.ts';

export { mayStart, TOUR_CLICKS };

export type Step = { do: 'wait'; ms: number } | { do: 'open'; url: string } | { do: 'end' };
export type StopWhy = 'changed_page' | 'other_player' | 'no_answer' | 'cancelled';

export interface RunState {
  v: 1;
  started: number;
  /** The profile the run was started on. */
  player_id: string;
  player_name: string;
  queue: string[];
  done: string[];
  failed: string[];
  misses: number;
  ready: number;
  awaiting?: { key: string; since: number };
  phase: 'pages' | 'done' | 'stopped';
  why?: StopWhy;
  ended?: number;
}

/**
 * A new run for this profile: its finished tournaments whose rounds the client doesn't have yet (`have`) and that
 * weren't opened within `again_days` (`opened`: key → time), newest first, at most `max_pages`.
 */
export function startRun(
  profile: Profile,
  have: readonly string[],
  opened: Readonly<Record<string, number>>,
  today: string,
  now: number,
): RunState {
  const skip = new Set(have);
  const queue = profile.entries
    .filter((e) => (e.end ?? e.start) < today && !skip.has(e.key))
    .filter((e) => !((opened[e.key] ?? 0) > now - TOUR_CLICKS.again_days * DAY_MS))
    .sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0))
    .slice(0, TOUR_CLICKS.max_pages)
    .map((e) => e.key);
  const run: RunState = {
    v: 1, started: now, player_id: profile.player_id, player_name: profile.player_name, queue, done: [], failed: [],
    misses: 0, ready: now, phase: queue.length > 0 ? 'pages' : 'done',
  };
  if (queue.length === 0) run.ended = now;
  return run;
}

function end(run: RunState, now: number, why?: StopWhy): RunState {
  const { awaiting: _gone, ...rest } = run;
  const out: RunState = { ...rest, phase: why ? 'stopped' : 'done', ended: now };
  if (why) out.why = why;
  return out;
}

/** The one step to take now. A page that doesn't answer in time counts as a miss, and the run moves on. */
export function nextStep(run: RunState, now: number, random: () => number = Math.random): { run: RunState; step: Step } {
  if (run.phase !== 'pages') return { run, step: { do: 'end' } };
  if (run.awaiting) {
    const left = run.awaiting.since + TOUR_CLICKS.answer_wait_ms - now;
    if (left > 0) return { run, step: { do: 'wait', ms: Math.min(left, 1000) } };
    const { awaiting, ...rest } = run;
    const missed: RunState = { ...rest, failed: [...run.failed, awaiting.key], misses: run.misses + 1, ready: now + pauseOf(random) };
    if (missed.misses >= TOUR_CLICKS.max_misses) return { run: end(missed, now, 'no_answer'), step: { do: 'end' } };
    return nextStep(missed, now, random);
  }
  if (now < run.ready) return { run, step: { do: 'wait', ms: run.ready - now } };
  const [key, ...queue] = run.queue;
  if (key === undefined) {
    const over = end(run, now);
    return { run: over, step: { do: 'end' } };
  }
  return { run: { ...run, queue, awaiting: { key, since: now } }, step: { do: 'open', url: resultUrl(key) } };
}

/** What the page opened for the run showed. Another page (the player went elsewhere) is ignored. */
export function seeRun(run: RunState, read: OwnLine | Unread | Profile | null, key: string | null, now: number, random: () => number = Math.random): RunState {
  if (run.phase !== 'pages' || !run.awaiting || key !== run.awaiting.key || read === null) return run;
  if (read.kind === 'profile') return run;
  if (read.kind === 'unread' && read.why === 'changed_page') return end(run, now, 'changed_page');
  const { awaiting, ...rest } = run;
  const ok = read.kind === 'result' && read.rounds.length > 0;
  // A page without his line (withdrawn before the start, a name written otherwise) or without a final result: noted, on.
  return {
    ...rest,
    done: ok ? [...run.done, awaiting.key] : run.done,
    failed: ok ? run.failed : [...run.failed, awaiting.key],
    misses: 0,
    ready: now + pauseOf(random),
  };
}

/** The player's *Stop*, or his profile changed to someone else's: the run ends where it is. */
export function stopRun(run: RunState, now: number, why: StopWhy): RunState {
  return run.phase === 'pages' ? end(run, now, why) : run;
}
