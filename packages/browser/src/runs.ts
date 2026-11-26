// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a client keeps of *Fetch all* on the tours whose pages show a part at a time (`run` and `tour-runs` of
 * `@glmsync/provider-tours`; decision 57 of the target's owner): the one run going on, the tab it runs in, and the
 * starts of each tour's runs today (three a day). Kept in the client's own storage (no web page reaches it). The Pro
 * Golf Tour's run is `TourKeeper`'s (`tours.ts`).
 *
 * A run belongs to the tab it was started in (`tab`: the extension's tab id; the companion app has one window and
 * passes the same number every time), so only that tab is told its steps. Its plan comes from the address of the page
 * it was started on, as the client saw it - never from what a page says.
 *
 * Pure apart from the storage it is handed, so it is tested without a browser.
 */

import type { Storage } from '@glmsync/core';
import { isRunFamily, run as pick, runMayOpen, runPlanOf, type RunFamily } from '@glmsync/provider-tours';
import type { T } from './i18n.ts';

type PickRun = pick.PickRun;
type RunStep = pick.RunStep;

const KEY = 'tours:pick-run';
/** A run whose tab said nothing for this long is taken as gone (its tab closed while the browser was off). */
const STALE_MS = pick.TOUR_CLICKS.answer_wait_ms * pick.TOUR_CLICKS.max_misses * 2;

interface Kept {
  run: (PickRun & { tab: number; touched: number }) | null;
  starts: Partial<Record<RunFamily, number[]>>;
}

/** What a tour's line shows of it. */
export interface RunView {
  /** The run going on: its tour, how far, and its tab. */
  running: { family: RunFamily; done: number; total: number; tab: number } | null;
  /** How the last run of this client ended, while the client runs: `done`, or why it stopped. */
  ended: { family: RunFamily; how: pick.PickStopWhy | 'done' } | null;
}

export type StartOutcome = 'started' | 'limit' | 'busy' | 'nothing';

const empty = (): Kept => ({ run: null, starts: {} });

export class RunKeeper {
  private ended: RunView['ended'] = null;

  constructor(private readonly storage: Storage, private readonly now: () => number = Date.now) {}

  private async load(): Promise<Kept> {
    try {
      const raw = await this.storage.get(KEY);
      const v = raw ? (JSON.parse(raw) as Partial<Kept> & { run?: unknown }) : null;
      if (!v || typeof v !== 'object') return empty();
      const r = pick.checkPickRun(v.run);
      const extra = v.run && typeof v.run === 'object' ? (v.run as { tab?: unknown; touched?: unknown }) : {};
      const run = r && isRunFamily(r.family) && typeof extra.tab === 'number' && typeof extra.touched === 'number' ? { ...r, tab: extra.tab, touched: extra.touched } : null;
      const starts: Kept['starts'] = {};
      for (const [f, list] of Object.entries(v.starts ?? {})) {
        if (isRunFamily(f) && Array.isArray(list)) starts[f] = list.filter((t): t is number => typeof t === 'number').slice(-10);
      }
      return { run, starts };
    } catch {
      // Unreadable (another version wrote it): start afresh rather than fail every page.
      return empty();
    }
  }

  private async save(k: Kept): Promise<void> {
    const day = this.now() - pick.DAY_MS;
    for (const f of Object.keys(k.starts) as RunFamily[]) k.starts[f] = (k.starts[f] ?? []).filter((t) => t > day);
    await this.storage.set(KEY, JSON.stringify(k));
  }

  private viewOf(k: Kept): RunView {
    const r = k.run;
    const running = r?.phase === 'steps' && isRunFamily(r.family) ? { family: r.family, ...pick.progressOf(r), tab: r.tab } : null;
    return { running, ended: this.ended };
  }

  private finish(k: Kept, r: PickRun): void {
    if (r.phase !== 'steps' && isRunFamily(r.family)) {
      this.ended = { family: r.family, how: r.why ?? 'done' };
      k.run = null;
    }
  }

  async view(): Promise<RunView> {
    return this.viewOf(await this.load());
  }

  /**
   * *Fetch all* tapped on the page at `url` in tab `tab` (`today`: the player's day). `limit` when that tour's runs of
   * today are used up, `busy` while a run goes on in another tab, `nothing` on a page that starts none; `fresh` when this
   * tap started it (not one already going on in this tab).
   */
  async start(url: string, tab: number, today: string): Promise<{ outcome: StartOutcome; family?: RunFamily; fresh?: boolean }> {
    const plan = runPlanOf(url, today);
    if (!plan) return { outcome: 'nothing' };
    const k = await this.load();
    const now = this.now();
    if (k.run?.phase === 'steps' && now - k.run.touched < STALE_MS) {
      if (k.run.tab !== tab) return { outcome: 'busy', family: plan.family };
      if (k.run.family === plan.family) return { outcome: 'started', family: plan.family, fresh: false };
    }
    if (!pick.mayStart(k.starts[plan.family] ?? [], now)) return { outcome: 'limit', family: plan.family };
    const r = pick.startPickRun(plan.family, plan.player_id, plan.steps, now);
    this.ended = null;
    k.starts[plan.family] = [...(k.starts[plan.family] ?? []), now];
    k.run = r.phase === 'steps' ? { ...r, tab, touched: now } : null;
    if (r.phase !== 'steps') this.ended = { family: plan.family, how: 'done' };
    await this.save(k);
    return { outcome: 'started', family: plan.family, fresh: true };
  }

  /**
   * The run's next step, only for the tab it runs in (none for any other). `end` means it just ended: its tour's pages
   * go out then (`family`). An address the run may not open ends it instead of being opened.
   */
  async step(tab: number): Promise<{ step: RunStep; family: RunFamily } | null> {
    const k = await this.load();
    const r = k.run;
    if (!r || r.tab !== tab || r.phase !== 'steps' || !isRunFamily(r.family)) return null;
    const family = r.family;
    const now = this.now();
    let { run, step } = pick.nextPickStep(r, now);
    if (step.do === 'open' && !runMayOpen(family, r.player_id, step.url)) {
      run = pick.stopPickRun(run, now, 'changed_page');
      step = { do: 'end' };
    }
    k.run = { ...run, tab, touched: now };
    this.finish(k, run);
    await this.save(k);
    return { step, family };
  }

  /** What the page showed after a step, from the run's tab (any other tab's is no answer). */
  async seen(tab: number, s: pick.PickSeen): Promise<RunView> {
    const k = await this.load();
    const r = k.run;
    if (!r || r.tab !== tab || r.phase !== 'steps') return this.viewOf(k);
    const now = this.now();
    const next = pick.seePickRun(r, s, now);
    k.run = { ...next, tab, touched: now };
    this.finish(k, next);
    await this.save(k);
    return this.viewOf(k);
  }

  /** *Stop* on the line, or the run's tab closed: the run ends where it is. Its tour, for what was read to go out. */
  async stop(why: pick.PickStopWhy = 'cancelled', tab?: number): Promise<RunFamily | null> {
    const k = await this.load();
    const r = k.run;
    if (!r || (tab !== undefined && r.tab !== tab) || !isRunFamily(r.family)) return null;
    const family = r.family;
    const ended = pick.stopPickRun(r, this.now(), why);
    this.finish(k, ended);
    k.run = null;
    await this.save(k);
    return family;
  }
}

/** The line's text while a run goes on, or after it stopped (none after one that ran through: the send says that). */
export function runNote(v: RunView, family: RunFamily | null, t: T): string | null {
  if (v.running && v.running.family === family) return t('runLine.running', { done: v.running.done, total: v.running.total });
  if (v.ended && v.ended.family === family && v.ended.how !== 'done' && v.ended.how !== 'cancelled') return t(`runLine.stopped.${v.ended.how}`);
  return null;
}
