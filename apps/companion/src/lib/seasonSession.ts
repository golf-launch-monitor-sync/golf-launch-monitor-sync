// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tour window does on the season pages (PGA Tour and Korn Ferry Tour on pgatour.com, LPGA Tour on lpga.com,
 * Epson Tour on epsontour.com; spec/prores.md, `@glmsync/provider-tours` `seasonPage`), without the window: the
 * extension's way there (apps/extension/src/season-content.ts) on the phone.
 *
 * His *Results* page shows the whole season with its rounds, so nothing is kept and nothing is read before he asks:
 * *Send* has the page script read the season the page shows then (the season he picked, the tour he picked on
 * pgatour.com) with its standing, and sends that page to every connected app, each after its plan (`ProClient`). A tour
 * of the site no module reads (PGA Tour Champions, Americas) or a season with nothing finished in it yet: the bar says
 * so, in the extension's words. The window opens on his *Results* page next time.
 *
 * *Fetch all* (decision 57; pickRun.ts, the extension's very run): on his tap on his *Results* or *Stats* page each
 * season of the reach is picked for him there (on pgatour.com for each of its two tours), then the same on his other
 * page, at the extension's pace; every page read is kept merged per tour (`SeasonKeeper`, `@glmsync/browser/season`,
 * shared with the extension) and goes out once at the end, a page per tour, within the reach. By hand, *Send* still
 * sends the page as it shows and keeps nothing.
 *
 * Nothing is read without a connection for a pro's pages (the bar offers no *Send* then), nothing while the window is
 * closed, and the site is asked nothing. No failure is left uncaught: on his tap it becomes the bar's `error`.
 */

import type { ProView } from '@glmsync/browser/pro';
import type { LinePhase } from '@glmsync/browser/proView';
import type { SeasonKeeper } from '@glmsync/browser/season';
import { run as pickRun, seasonPlayerOf, SITES_OF, type RunFamily, type TourSite } from '@glmsync/provider-tours';
import { PickRunDriver, type FetchAllDeps, type RunState } from './pickRun.ts';
import { onSeasonResults, type TourAnswer } from './toursPage.ts';

/** What the bar says in place of the line's words, as the extension's line does (`seasonLine.*`). */
export type SeasonNote = 'otherTour' | 'nothing';

export interface SeasonState {
  view: ProView | null;
  /** The connections couldn't be read: the window says so, with *Load again*. */
  unread: boolean;
  phase: LinePhase;
  note: SeasonNote | null;
  /** *Fetch all*: the run going on, how the last one ended (none: the window offers no *Fetch all*). */
  run?: RunState;
  /** The tour a run sent last (pgatour.com's two go as a page each): the bar speaks of it. */
  sent?: TourSite | null;
}

export interface SeasonSessionDeps {
  pro: { view(): Promise<ProView>; send(raw: unknown): Promise<ProView>; answer(yes: boolean): Promise<ProView> };
  lastPage: { set(url: string): Promise<void> };
  /** Ask the page script for a read of the page the window shows; null when no answer came. */
  read(): Promise<TourAnswer | null>;
  onChange(state: SeasonState): void;
  /** *Fetch all* (none: not offered), with the keeper of the pages a run read and the player's day. */
  fetchAll?: FetchAllDeps & { pages: Pick<SeasonKeeper, 'seen' | 'take'>; today(): string };
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class SeasonSession {
  private state: SeasonState = { view: null, unread: false, phase: 'ready', note: null };
  private reading = false;
  private closed = false;
  /** The address of the page shown now (the window tells every move). */
  private shown: string | null = null;
  /** *Fetch all*'s run (none without it). */
  private readonly run: PickRunDriver | null;

  constructor(private readonly d: SeasonSessionDeps) {
    const fa = d.fetchAll;
    this.run = fa
      ? new PickRunDriver({
          runs: fa.runs,
          pick: fa.pick,
          open: fa.open,
          // A page a run read is kept until the run ends (by hand, *Send* sends at once).
          look: async () => {
            const a = await this.d.read();
            if (!a?.ok || !('season' in a)) return 'unread';
            await fa.pages.seen(a.season);
            return 'read';
          },
          player: (url) => seasonPlayerOf(url),
          fresh: async (family) => void (await fa.pages.take(SITES_OF[family])),
          send: (family) => this.sendRun(family, fa.pages, fa.today()),
          drop: async (family) => void (await fa.pages.take(SITES_OF[family])),
          failed: () => this.set({ phase: 'error' }),
          today: fa.today,
          onChange: (run) => this.set({ run }),
          ...(d.schedule ? { schedule: d.schedule } : {}),
          ...(d.cancel ? { cancel: d.cancel } : {}),
        })
      : null;
  }

  get now(): SeasonState {
    return this.state;
  }

  private set(part: Partial<SeasonState>): void {
    this.state = { ...this.state, ...part };
    if (!this.closed) this.d.onChange(this.state);
  }

  private get connected(): boolean {
    return !!this.state.view?.pairings.length;
  }

  /** The window opened: what is connected (and a run left from a window that is gone ended). */
  async start(): Promise<void> {
    await this.loadView();
    await this.run?.start();
  }

  async loadView(): Promise<void> {
    try {
      this.set({ view: await this.d.pro.view(), unread: false });
    } catch {
      this.set({ unread: true });
    }
  }

  /** The window shows another page (`url`): whatever the bar said of the last one is over (a run's pick moves it too). */
  moved(url?: string): void {
    if (url !== undefined) {
      this.shown = url;
      this.run?.moved(url);
    }
    if (this.run?.running) return;
    this.set(this.state.phase === 'reading' ? { note: null, sent: null } : { phase: 'ready', note: null, sent: null });
  }

  /** The window finished loading `url` (or the site moved there): during a run, a page it opened is read. */
  async loaded(url: string): Promise<void> {
    this.shown = url;
    await this.run?.loaded(url);
  }

  /** His tap on *Send* on his *Results* page: the season it shows to every connected app. */
  async send(url: string): Promise<void> {
    if (this.closed || this.reading || this.run?.running || !this.connected || !onSeasonResults(url)) return;
    this.reading = true;
    this.set({ phase: 'reading', note: null });
    try {
      const a = await this.d.read();
      if (!a) {
        this.set({ phase: 'error' });
        return;
      }
      if (!a.ok) {
        // A page the module doesn't know says so; a page that isn't his results (the window moved on) says nothing.
        this.set({ phase: a.why === 'changed_page' ? 'changed_page' : 'ready' });
        return;
      }
      if ('seasonUnread' in a) {
        this.set({ phase: 'ready', note: a.seasonUnread === 'other_tour' ? 'otherTour' : 'nothing' });
        return;
      }
      if (!('season' in a)) {
        this.set({ phase: 'error' });
        return;
      }
      const view = await this.d.pro.send(a.season);
      this.set({ view, phase: 'done' });
      // The window opens on his *Results* page next time.
      await this.d.lastPage.set(url).catch(() => undefined);
    } catch {
      this.set({ phase: 'error' });
    } finally {
      this.reading = false;
    }
  }

  /** His tap on *Fetch all*, on his *Results* or *Stats* page `url`: each season (and tour) picked for him on both. */
  async fetchAll(url: string): Promise<void> {
    if (!this.run || this.closed || this.reading || !this.connected || !onSeasonResults(url)) return;
    this.shown = url;
    this.set({ phase: 'ready', note: null, sent: null });
    await this.run.fetchAll(url);
  }

  /** His tap on *Stop*: the run ends where it is, and what it read goes out. */
  async stop(): Promise<void> {
    await this.run?.stop();
  }

  /** A run ended: each tour's page as read to every connected app, within the reach (two years, at most 50 tournaments). */
  private async sendRun(family: RunFamily, pages: Pick<SeasonKeeper, 'take'>, today: string): Promise<void> {
    try {
      const kept = await pages.take(SITES_OF[family]);
      if (kept.length === 0) {
        // Nothing finished in the seasons of the reach: said so, as by hand.
        this.set({ phase: 'ready', note: 'nothing' });
        return;
      }
      let view = this.state.view;
      for (const page of kept) view = await this.d.pro.send(pickRun.withinReach(page, today));
      this.set({ view, phase: 'done', note: null, sent: kept.at(-1)?.site ?? null });
      if (this.shown && onSeasonResults(this.shown)) await this.d.lastPage.set(this.shown).catch(() => undefined);
    } catch {
      this.set({ phase: 'error' });
    }
  }

  /** His answer to *Is this page yours?*. */
  async answer(yes: boolean): Promise<void> {
    try {
      this.set({ view: await this.d.pro.answer(yes), phase: 'done' });
    } catch {
      this.set({ phase: 'error' });
    }
  }

  /** The window closes: a run going on ends and what it read goes out, as on *Stop*. */
  close(): void {
    this.closed = true;
    void this.run?.close();
  }
}
