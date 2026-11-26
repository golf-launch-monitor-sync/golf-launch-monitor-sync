// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the tours, shared: the pace of a person, the reach (the last two years, at most 50 tournaments), and
 * the run that does for the player, on his tap, what he does by hand on the tours whose pages show a part at a time -
 * opening his own pages there and picking in their own pickers (a season, a tour, a report). The Pro Golf Tour opens
 * tournament pages instead (`progolftour-run.ts`); its pace is the same.
 *
 * Pure: a run is a value (kept as JSON by the client), moved on by what a page showed (`seePickRun`) and by time
 * (`nextPickStep`). Which pages and picks make a run each tour says in its own file (`alps-run.ts`,
 * `europeantour-run.ts`, `ocs-run.ts`, `season-run.ts`; together in `tour-runs.ts`); doing a step in the page is
 * `operate.ts`. Nothing here asks a site anything of its own: a client opens the site's own addresses and picks in the
 * site's own pickers, and the site's own scripts load what they load.
 *
 * `TOUR_CLICKS` moves down after a measurement, never up without one, and no option or setting loosens it.
 */

import type { TourPage } from './page.ts';

export const TOUR_CLICKS = {
  /** The pause after a page's answer before the next step (at least the Pro Golf Tour's crawl delay of 5 s). */
  pause_ms: [6000, 10000] as const,
  /** How long a page may take to show what it shows. */
  answer_wait_ms: 30000,
  /** At most this many tournament pages a run on the Pro Golf Tour. */
  max_pages: 30,
  /** At most this many steps (pages opened, picks) a run on the other tours. */
  max_steps: 30,
  /** Pages that didn't answer in a row before a run gives up. */
  max_misses: 3,
  /** Runs a day, per tour. */
  runs_per_day: 3,
  /** A tournament's page read (or tried) lately isn't opened again within this many days (Pro Golf Tour). */
  again_days: 7,
  /** How far back a run reaches (decision 51 of the target's owner). */
  years: 2,
  /** At most this many tournaments a run sends (decision 51), the newest. */
  max_tournaments: 50,
} as const;

export const DAY_MS = 86400000;

/** Whether another run may start now, by the starts of the runs before (kept by the client). */
export function mayStart(starts: readonly number[], now: number): boolean {
  return starts.filter((t) => t > now - DAY_MS && t <= now).length < TOUR_CLICKS.runs_per_day;
}

/** A pause between `pause_ms`, by `random` (0..1). */
export function pauseOf(random: () => number): number {
  const [lo, hi] = TOUR_CLICKS.pause_ms;
  const r = random();
  return Math.round(lo + Math.min(Math.max(Number.isFinite(r) ? r : 0.5, 0), 1) * (hi - lo));
}

// ---------------------------------------------------------------------------
// The reach: the last two years, at most 50 tournaments
// ---------------------------------------------------------------------------

/** The first day a run reaches back to: `today` two years earlier (29 Feb counts as 28 Feb). */
export function reachSince(today: string): string {
  const y = Number(today.slice(0, 4)) - TOUR_CLICKS.years;
  const md = today.slice(5) === '02-29' ? '02-28' : today.slice(5);
  return `${String(y).padStart(4, '0')}-${md}`;
}

/**
 * The seasons a run picks, newest first: this year's back to the one the reach begins in; `ahead` adds next year's,
 * for a tour whose season starts before the year does (the DP World Tour's starts in November).
 */
export function seasonsOf(today: string, ahead = false): number[] {
  const y = Number(today.slice(0, 4));
  const from = Number(reachSince(today).slice(0, 4));
  const out: number[] = [];
  for (let s = ahead ? y + 1 : y; s >= from; s -= 1) out.push(s);
  return out;
}

/**
 * A page as a run sends it: only the tournaments of the reach (their first day on or after `reachSince`), the newest
 * `max_tournaments` of them. Its ranking and statistics as they are.
 */
export function withinReach(page: TourPage, today: string): TourPage {
  const since = reachSince(today);
  const tournaments = page.tournaments
    .filter((t) => typeof t.start === 'string' && t.start >= since)
    .sort((a, b) => ((a.start ?? '') < (b.start ?? '') ? 1 : (a.start ?? '') > (b.start ?? '') ? -1 : 0))
    .slice(0, TOUR_CLICKS.max_tournaments);
  return { ...page, tournaments };
}

// ---------------------------------------------------------------------------
// The run: pages opened, pickers picked
// ---------------------------------------------------------------------------

/**
 * One step a person would take: open one of his own pages by its address (the site's own), or pick in one of the
 * page's own pickers - a `<select>`, or a picker the page draws itself, named by the label it writes (`picker`:
 * "Season", "Tour"; none: the `<select>` that offers `value`).
 */
export type PickStep =
  | { key: string; do: 'open'; url: string }
  | { key: string; do: 'pick'; picker: string | null; value: string };

export type RunStep = PickStep | { do: 'wait'; ms: number } | { do: 'end' };
export type PickStopWhy = 'changed_page' | 'other_player' | 'no_answer' | 'cancelled';

/** What a page showed after a step: read, not read (it showed nothing of what is read), or the pick wasn't offered. */
export type PickOutcome = 'read' | 'unread' | 'absent';

export interface PickSeen {
  /** The step a pick answers (an opened page is known by its address). */
  key?: string;
  /** The page's address. */
  url: string;
  /** Whose page it is, where the page says it. */
  player?: string;
  outcome: PickOutcome;
}

export interface PickRun {
  v: 1;
  kind: 'pick';
  /** Which tour's run (`tour-runs.ts`): its pages, its keeper, its count of runs a day. */
  family: string;
  /** The player whose page the run was started on. */
  player_id: string;
  started: number;
  queue: PickStep[];
  done: string[];
  /** Picks the page didn't offer (a season he didn't play): nothing loaded, no pause. */
  skipped: string[];
  failed: string[];
  misses: number;
  ready: number;
  awaiting?: { step: PickStep; since: number };
  phase: 'steps' | 'done' | 'stopped';
  why?: PickStopWhy;
  ended?: number;
}

/** A new run of `plan` (steps with unique keys, at most `max_steps`). */
export function startPickRun(family: string, playerId: string, plan: readonly PickStep[], now: number): PickRun {
  const seen = new Set<string>();
  const queue = plan.filter((s) => !seen.has(s.key) && seen.add(s.key)).slice(0, TOUR_CLICKS.max_steps);
  const run: PickRun = {
    v: 1, kind: 'pick', family, player_id: playerId, started: now, queue, done: [], skipped: [], failed: [], misses: 0,
    ready: now, phase: queue.length > 0 ? 'steps' : 'done',
  };
  if (queue.length === 0) run.ended = now;
  return run;
}

function endPick(run: PickRun, now: number, why?: PickStopWhy): PickRun {
  const { awaiting: _gone, ...rest } = run;
  const out: PickRun = { ...rest, phase: why ? 'stopped' : 'done', ended: now };
  if (why) out.why = why;
  return out;
}

/** The one step to take now. A page that doesn't answer in time counts as a miss, and the run moves on. */
export function nextPickStep(run: PickRun, now: number, random: () => number = Math.random): { run: PickRun; step: RunStep } {
  if (run.phase !== 'steps') return { run, step: { do: 'end' } };
  if (run.awaiting) {
    const left = run.awaiting.since + TOUR_CLICKS.answer_wait_ms - now;
    if (left > 0) return { run, step: { do: 'wait', ms: Math.min(left, 1000) } };
    const { awaiting, ...rest } = run;
    const missed: PickRun = { ...rest, failed: [...run.failed, awaiting.step.key], misses: run.misses + 1, ready: now + pauseOf(random) };
    if (missed.misses >= TOUR_CLICKS.max_misses) return { run: endPick(missed, now, 'no_answer'), step: { do: 'end' } };
    return nextPickStep(missed, now, random);
  }
  if (now < run.ready) return { run, step: { do: 'wait', ms: run.ready - now } };
  const [step, ...queue] = run.queue;
  if (step === undefined) return { run: endPick(run, now), step: { do: 'end' } };
  return { run: { ...run, queue, awaiting: { step, since: now } }, step };
}

/** Two addresses of the same page: origin, path (a trailing slash aside) and query alike, in any order. */
export function sameAddress(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, '');
    const query = (u: URL) => [...u.searchParams.entries()].map(([k, v]) => `${k}=${v}`).sort().join('&');
    return x.origin === y.origin && path(x) === path(y) && query(x) === query(y);
  } catch {
    return false;
  }
}

/**
 * What the page showed after the step awaited. Another page or another pick is ignored (the player went elsewhere: the
 * run's step goes unanswered); another player's page ends the run.
 */
export function seePickRun(run: PickRun, seen: PickSeen, now: number, random: () => number = Math.random): PickRun {
  if (run.phase !== 'steps' || !run.awaiting) return run;
  if (seen.player !== undefined && seen.player !== run.player_id) return endPick(run, now, 'other_player');
  const step = run.awaiting.step;
  const answers = step.do === 'pick' ? seen.key === step.key : sameAddress(seen.url, step.url);
  if (!answers) return run;
  const { awaiting: _done, ...rest } = run;
  if (seen.outcome === 'absent') return { ...rest, skipped: [...run.skipped, step.key], misses: 0, ready: now };
  return {
    ...rest,
    done: seen.outcome === 'read' ? [...run.done, step.key] : run.done,
    failed: seen.outcome === 'read' ? run.failed : [...run.failed, step.key],
    misses: 0,
    ready: now + pauseOf(random),
  };
}

/** The player's *Stop*, or his page changed to someone else's: the run ends where it is. */
export function stopPickRun(run: PickRun, now: number, why: PickStopWhy): PickRun {
  return run.phase === 'steps' ? endPick(run, now, why) : run;
}

/** A run as kept by a client, read again (another version may have written it); none when its frame doesn't hold. */
export function checkPickRun(v: unknown): PickRun | null {
  const r = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!r || r.v !== 1 || r.kind !== 'pick' || typeof r.family !== 'string' || typeof r.player_id !== 'string') return null;
  if (!Array.isArray(r.queue) || !Array.isArray(r.done) || !Array.isArray(r.skipped) || !Array.isArray(r.failed)) return null;
  if (typeof r.started !== 'number' || typeof r.ready !== 'number' || typeof r.misses !== 'number') return null;
  if (r.phase !== 'steps' && r.phase !== 'done' && r.phase !== 'stopped') return null;
  const isStep = (s: unknown): s is PickStep => {
    const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : null;
    if (!o || typeof o.key !== 'string') return false;
    if (o.do === 'open') return typeof o.url === 'string';
    return o.do === 'pick' && typeof o.value === 'string' && (o.picker === null || typeof o.picker === 'string');
  };
  if (!r.queue.every(isStep)) return null;
  const a = r.awaiting && typeof r.awaiting === 'object' ? (r.awaiting as Record<string, unknown>) : null;
  if (a && (!isStep(a.step) || typeof a.since !== 'number')) return null;
  return r as unknown as PickRun;
}

/** How far a run is: steps answered, of all. */
export function progressOf(run: PickRun): { done: number; total: number } {
  const done = run.done.length + run.failed.length + run.skipped.length;
  return { done, total: done + run.queue.length + (run.awaiting ? 1 : 0) };
}
