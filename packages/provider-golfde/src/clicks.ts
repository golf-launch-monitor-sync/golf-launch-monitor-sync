// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all*: on the player's tap, after they signed in on golf.de themselves, the client does the clicks the player
 * would do (spec/hcp.md, *A client that observes and clicks for the player*): every page of the History Sheet, the
 * Scoring Record, then the result lists of their tournaments of the last two years that still lack a place, at most
 * 50. It only operates golf.de's own page - its links, its button, the addresses its own links have - and golf.de's
 * scripts load what they load; the client reads along as always and asks golf.de nothing itself.
 *
 * Pure: a run is a value (`RunState`, kept as JSON by the client), moved on by what the page showed (`see`) and by
 * time (`next`, which says the one step to take now). The numbers are the spec's (spec/hcp/clicks.json): a person's
 * pause between pages, a wait for the page's answer, the most pages and lists. A run stops on its own when golf.de
 * says the player isn't signed in, when another account shows, when a page doesn't answer as it should (its shape
 * changed, a button isn't there), or when the player cancels.
 */

import type { HcpResult } from '@glmsync/core';
import { HCP_CLICKS } from '@glmsync/spec';
import { HISTORY_SHEET_URL, type Seen } from './observe.ts';
import { resultsUrl, type Step } from './steps.ts';

export { mayOpen, RESULTS_PAGE, resultsUrl, type Step } from './steps.ts';

export type RunPhase = 'history' | 'scoring' | 'lists' | 'done' | 'stopped';
export type StopWhy = 'signed_out' | 'changed_page' | 'other_account' | 'cancelled';

interface Link {
  tournament: string;
  played_on: string;
  /** Not a club tournament of the player's (a registered private round, a foreign result): no result list of ours. */
  skip: boolean;
}

export interface RunState {
  v: 1;
  started: number;
  /** The golf.de account the run is for (the one the pages named when the player tapped). */
  subject: string;
  /** The day the run started, the player's; the lists of the two years before it. */
  today: string;
  phase: RunPhase;
  why?: StopWhy;
  ended?: number;
  /** Not before this: the pause after the last page. */
  ready: number;
  /** A step was taken and the page's answer to it is awaited since `since`. */
  awaiting?: { what: 'history' | 'scoring' | 'places'; since: number; tournament?: string; cursor?: string };
  /** History Sheet: pages read, entries read of `total`, golf.de's cursor of the next page, the cursors followed. */
  pages: number;
  entries: number;
  total?: number;
  next?: string;
  cursors: string[];
  scoring: boolean;
  /** Each result's tournament, by golf.de's id of the result. */
  links: Record<string, Link>;
  /** Results that have their place already (with the client): their list isn't opened again. */
  placed: string[];
  /** Tournaments whose list was opened lately (`list_again_days`): not again. */
  recent: string[];
  /** The lists still to open, newest first; how many there were; how many are done; misses in a row. */
  lists: string[];
  lists_total: number;
  lists_done: number;
  missing: number;
  /** The lists this run opened (the client keeps them as `recent` for the next runs). */
  opened: string[];
}

export const CLICKS = HCP_CLICKS;

function pause(random: () => number): number {
  const [lo, hi] = CLICKS.pause_ms as readonly [number, number];
  const r = random();
  return lo + Math.floor((Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0.5) * (hi - lo + 1));
}

/** The same day `years` years before `day` (YYYY-MM-DD); a 29 February becomes the 28th. */
export function yearsBefore(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const yy = y - years;
  const leap = (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${String(yy).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** A new run for the account the pages named; `placed` and `recent` from what the client keeps. */
export function startRun(opts: { subject: string; now: number; today: string; placed: Iterable<string>; recent: Iterable<string> }): RunState {
  return {
    v: 1,
    started: opts.now,
    subject: opts.subject,
    today: opts.today,
    phase: 'history',
    ready: opts.now,
    pages: 0,
    entries: 0,
    cursors: [],
    scoring: false,
    links: {},
    placed: [...new Set(opts.placed)].slice(0, 2000),
    recent: [...new Set(opts.recent)].slice(0, 500),
    lists: [],
    lists_total: 0,
    lists_done: 0,
    missing: 0,
    opened: [],
  };
}

export const running = (s: RunState | null | undefined): boolean => !!s && s.phase !== 'done' && s.phase !== 'stopped';

function stop(s: RunState, why: StopWhy, now: number): RunState {
  if (!running(s)) return s;
  const { awaiting: _, ...rest } = s;
  return { ...rest, phase: 'stopped', why, ended: now };
}

/** The player cancels. */
export function cancelRun(s: RunState, now: number): RunState {
  return stop(s, 'cancelled', now);
}

/** The lists to open: the player's club tournaments of the last years without a place yet, newest first, at most 50. */
export function listsOf(s: RunState): string[] {
  const from = yearsBefore(s.today, CLICKS.list_years);
  const placed = new Set(s.placed);
  const recent = new Set(s.recent);
  const newest = new Map<string, string>();
  for (const [ref, l] of Object.entries(s.links)) {
    if (l.skip || placed.has(ref) || recent.has(l.tournament) || l.played_on < from || l.played_on > s.today) continue;
    const had = newest.get(l.tournament);
    if (!had || l.played_on > had) newest.set(l.tournament, l.played_on);
  }
  return [...newest.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : Number(b[0]) - Number(a[0])))
    .slice(0, CLICKS.max_lists)
    .map(([t]) => t);
}

function linksFrom(s: RunState, results: readonly HcpResult[], links: readonly { ref: string; tournament: string }[] | undefined): Record<string, Link> {
  if (!links?.length) return s.links;
  const out = { ...s.links };
  for (const l of links) {
    const r = results.find((x) => x.ref === l.ref);
    if (!r) continue;
    out[l.ref] = { tournament: l.tournament, played_on: r.played_on, skip: r.format === 'rpr' || (r.kind !== undefined && r.kind !== 'tournament') };
    if (Object.keys(out).length >= 2000) break;
  }
  return out;
}

/** What golf.de's page showed while the run goes on. */
export function seeRun(s: RunState, seen: Seen, now: number, random: () => number = Math.random): RunState {
  if (!running(s)) return s;
  switch (seen.kind) {
    case 'signed_out':
      return stop(s, 'signed_out', now);
    case 'signed_in':
      return s;
    case 'changed_page':
      return stop(s, 'changed_page', now);
    case 'member':
      return seen.subject === s.subject ? s : stop(s, 'other_account', now);
    case 'history': {
      const next: RunState = { ...s, links: linksFrom(s, seen.results, seen.links) };
      if (s.awaiting?.what !== 'history') return next; // golf.de's page loaded it by itself: kept, nothing moves on
      const { awaiting: _, next: __, ...rest } = next;
      const followed = s.awaiting.cursor;
      return {
        ...rest,
        pages: s.pages + 1,
        entries: s.entries + seen.results.length,
        ...(seen.total !== undefined ? { total: seen.total } : {}),
        ...(seen.next ? { next: seen.next } : {}),
        cursors: followed ? [...s.cursors, followed] : s.cursors,
        ready: now + pause(random),
      };
    }
    case 'scoring': {
      if (s.awaiting?.what !== 'scoring') return { ...s, scoring: true };
      const { awaiting: _, ...rest } = s;
      return { ...rest, scoring: true, ready: now + pause(random) };
    }
    case 'places': {
      if (s.awaiting?.what !== 'places' || s.awaiting.tournament !== seen.tournament) return s;
      const { awaiting: _, ...rest } = s;
      return { ...rest, lists: s.lists.slice(1), lists_done: s.lists_done + 1, missing: 0, ready: now + pause(random) };
    }
  }
}

/** The step to take now, and the run as it is after taking it. */
export function nextStep(s: RunState, now: number, random: () => number = Math.random): { state: RunState; step: Step } {
  if (!running(s)) return { state: s, step: { do: 'end' } };
  let st = s;
  if (st.awaiting) {
    const left = st.awaiting.since + CLICKS.answer_wait_ms - now;
    if (left > 0) return { state: st, step: { do: 'wait', ms: Math.min(left, 1000) } };
    // No answer: a History Sheet or Scoring Record that doesn't come is a page that changed; a result list may simply
    // not be there (a tournament without one) - several in a row is a page that changed too.
    if (st.awaiting.what !== 'places') return { state: stop(st, 'changed_page', now), step: { do: 'end' } };
    const missing = st.missing + 1;
    const { awaiting: _, ...rest } = st;
    st = { ...rest, lists: st.lists.slice(1), lists_done: st.lists_done + 1, missing, ready: now + pause(random) };
    if (missing >= CLICKS.max_missing_lists) return { state: stop(st, 'changed_page', now), step: { do: 'end' } };
  }
  if (now < st.ready) return { state: st, step: { do: 'wait', ms: st.ready - now } };
  if (st.phase === 'history') {
    if (st.pages === 0) {
      return { state: { ...st, awaiting: { what: 'history', since: now } }, step: { do: 'open', url: HISTORY_SHEET_URL } };
    }
    const cursor = st.next;
    if (cursor && st.pages < CLICKS.max_history_pages && !st.cursors.includes(cursor)) {
      return { state: { ...st, awaiting: { what: 'history', since: now, cursor } }, step: { do: 'page', cursor } };
    }
    st = { ...st, phase: 'scoring' };
  }
  if (st.phase === 'scoring') {
    if (!st.scoring) return { state: { ...st, awaiting: { what: 'scoring', since: now } }, step: { do: 'click', what: 'scoring' } };
    const lists = listsOf(st);
    st = { ...st, phase: 'lists', lists, lists_total: lists.length };
  }
  const tournament = st.lists[0];
  if (st.phase === 'lists' && tournament) {
    return {
      state: { ...st, opened: [...st.opened, tournament], awaiting: { what: 'places', since: now, tournament } },
      step: { do: 'open', url: resultsUrl(tournament) },
    };
  }
  return { state: { ...st, phase: 'done', ended: now }, step: { do: 'end' } };
}

/** What the player sees of a run. */
export interface RunView {
  phase: RunPhase;
  why?: StopWhy;
  /** History Sheet: entries read of `total` (as far as golf.de said it). */
  entries: number;
  total?: number;
  lists_done: number;
  lists_total: number;
}

export function runView(s: RunState): RunView {
  return {
    phase: s.phase,
    ...(s.why ? { why: s.why } : {}),
    entries: s.entries,
    ...(s.total !== undefined ? { total: s.total } : {}),
    lists_done: s.lists_done,
    lists_total: s.lists_total,
  };
}

/** A kept run read again strictly (storage can hold anything); null when it isn't one. */
export function readRun(raw: unknown): RunState | null {
  const r = raw && typeof raw === 'object' ? (raw as Partial<RunState>) : null;
  if (!r || r.v !== 1 || typeof r.subject !== 'string' || typeof r.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.today)) return null;
  if (!['history', 'scoring', 'lists', 'done', 'stopped'].includes(String(r.phase))) return null;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!n(r.started) || !n(r.ready) || !n(r.pages) || !n(r.entries) || !n(r.lists_total) || !n(r.lists_done) || !n(r.missing)) return null;
  const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  if (!strs(r.cursors) || !strs(r.placed) || !strs(r.recent) || !strs(r.lists) || !strs(r.opened)) return null;
  if (!r.links || typeof r.links !== 'object') return null;
  return r as RunState;
}
