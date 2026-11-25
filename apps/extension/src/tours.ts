// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the extension keeps of a player's own pages of the Pro Golf Tour (`@glmsync/provider-tours`), between the pages
 * he opens: his profile as last read, his line of each tournament's final result, which tournament pages were opened
 * when, and a *Fetch all* run. Kept in the extension's own storage (no web page reaches it), only of the profile he
 * opened himself: a profile of another player replaces it and everything read with it.
 *
 * Everything arrives from a content script and is read again strictly (`checkProfile`, `checkOwnLine`). Pure apart from
 * the storage it is handed, so it is tested without a browser.
 */

import type { Storage } from '@glmsync/core';
import { progolftour, progolftourRun, type TourPage } from '@glmsync/provider-tours';

type Profile = progolftour.Profile;
type OwnLine = progolftour.OwnLine;
type RunState = progolftourRun.RunState;
type Step = progolftourRun.Step;

const KEY = 'tours:pro_golf_tour';
/** Lines of tournaments kept at most (a few seasons). */
const MOST_LINES = 200;

interface Kept {
  profile: Profile | null;
  lines: Record<string, OwnLine>;
  opened: Record<string, number>;
  starts: number[];
  run: (RunState & { tab: number }) | null;
}

/** What the line on the site's page shows of it. */
export interface TourView {
  /** The name of the profile read last: whose tournament lines are taken. */
  who: string | null;
  /** Tournaments of the profile whose rounds were read. */
  read: number;
  run: { done: number; total: number; tab: number } | null;
  /** The last run ended thus (`changed_page`, `no_answer`, `other_player`, `cancelled`), or ran through. */
  ended: RunState['why'] | 'done' | null;
}

export type Seen =
  | { profile: unknown }
  | { key: string; line: unknown }
  | { key: string; unread: 'changed_page' | 'not_him' | 'no_result' };

const empty = (): Kept => ({ profile: null, lines: {}, opened: {}, starts: [], run: null });

export class TourKeeper {
  private ended: TourView['ended'] = null;

  constructor(private readonly storage: Storage, private readonly now: () => number = Date.now) {}

  private async load(): Promise<Kept> {
    try {
      const raw = await this.storage.get(KEY);
      const v = raw ? (JSON.parse(raw) as Partial<Kept>) : null;
      if (!v || typeof v !== 'object') return empty();
      const profile = progolftour.checkProfile(v.profile);
      const lines: Record<string, OwnLine> = {};
      for (const [k, l] of Object.entries(v.lines ?? {})) {
        const line = progolftour.checkOwnLine(l);
        if (line && line.key === k) lines[k] = line;
      }
      const opened = Object.fromEntries(Object.entries(v.opened ?? {}).filter(([, t]) => typeof t === 'number'));
      const starts = Array.isArray(v.starts) ? v.starts.filter((t): t is number => typeof t === 'number') : [];
      const run = v.run && typeof v.run === 'object' && v.run.v === 1 && typeof v.run.tab === 'number' ? v.run : null;
      return { profile, lines, opened, starts, run };
    } catch {
      // Unreadable (another version wrote it): start afresh rather than fail every page.
      return empty();
    }
  }

  private async save(k: Kept): Promise<void> {
    const keys = Object.keys(k.lines);
    if (keys.length > MOST_LINES) for (const key of keys.slice(0, keys.length - MOST_LINES)) delete k.lines[key];
    const day = this.now() - 86_400_000;
    k.starts = k.starts.filter((t) => t > day);
    await this.storage.set(KEY, JSON.stringify(k));
  }

  private viewOf(k: Kept): TourView {
    const keys = new Set(k.profile?.entries.map((e) => e.key) ?? []);
    const run = k.run?.phase === 'pages' ? { done: k.run.done.length + k.run.failed.length, total: k.run.done.length + k.run.failed.length + k.run.queue.length + (k.run.awaiting ? 1 : 0), tab: k.run.tab } : null;
    return { who: k.profile?.player_name ?? null, read: Object.keys(k.lines).filter((x) => keys.has(x)).length, run, ended: this.ended };
  }

  async view(): Promise<TourView> {
    return this.viewOf(await this.load());
  }

  /** What a page of the site showed. A profile of someone else replaces his and ends a running run. */
  async seen(s: Seen): Promise<TourView> {
    const k = await this.load();
    const now = this.now();
    if ('profile' in s) {
      const p = progolftour.checkProfile(s.profile);
      if (!p) return this.viewOf(k);
      if (k.profile && k.profile.player_id !== p.player_id) {
        if (k.run?.phase === 'pages') this.ended = 'other_player';
        k.lines = {};
        k.opened = {};
        k.run = null;
      }
      k.profile = p;
    } else if (k.profile) {
      const line = 'line' in s ? progolftour.checkOwnLine(s.line) : null;
      if (line && line.key === s.key) k.lines[s.key] = line;
      if (typeof s.key === 'string' && s.key.length <= 200) k.opened[s.key] = now;
      if (k.run?.phase === 'pages') {
        const read = line ?? ('unread' in s ? { kind: 'unread' as const, why: s.unread } : null);
        const next = progolftourRun.seeRun(k.run, read, s.key, now);
        k.run = { ...next, tab: k.run.tab };
        if (next.phase !== 'pages') this.ended = next.why ?? 'done';
      }
    }
    await this.save(k);
    return this.viewOf(k);
  }

  /** *Fetch all* on his profile in tab `tab`: `limit` when today's runs are used up, `nothing` without a profile. */
  async fetchAll(tab: number, today: string): Promise<'started' | 'limit' | 'nothing'> {
    const k = await this.load();
    const now = this.now();
    if (!k.profile) return 'nothing';
    if (k.run?.phase === 'pages') return 'started';
    if (!progolftourRun.mayStart(k.starts, now)) return 'limit';
    const have = Object.values(k.lines).map((l) => l.key);
    const run = progolftourRun.startRun(k.profile, have, k.opened, today, now);
    this.ended = null;
    k.starts.push(now);
    k.run = run.phase === 'pages' ? { ...run, tab } : null;
    if (run.phase !== 'pages') this.ended = 'done';
    await this.save(k);
    return 'started';
  }

  /** The run's next step, only for the tab it runs in; `end` means it just ended (the page goes out then). */
  async step(tab: number): Promise<Step | null> {
    const k = await this.load();
    if (!k.run || k.run.tab !== tab) return null;
    if (k.run.phase !== 'pages') return null;
    const { run, step } = progolftourRun.nextStep(k.run, this.now());
    if (step.do === 'open' && !progolftour.mayOpen(step.url)) {
      k.run = null;
      this.ended = 'changed_page';
      await this.save(k);
      return { do: 'end' };
    }
    k.run = run.phase === 'pages' ? { ...run, tab } : null;
    if (run.phase !== 'pages') this.ended = run.why ?? 'done';
    await this.save(k);
    return step;
  }

  /** *Stop*. */
  async stop(): Promise<TourView> {
    const k = await this.load();
    if (k.run?.phase === 'pages') this.ended = 'cancelled';
    k.run = null;
    await this.save(k);
    return this.viewOf(k);
  }

  /** The page to send now: his profile with every finished tournament whose rounds were read. */
  async page(today: string): Promise<TourPage | null> {
    const k = await this.load();
    return k.profile ? progolftour.siteRead(k.profile, k.lines, today) : null;
  }
}
