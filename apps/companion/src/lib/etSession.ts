// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tour window does on europeantour.com (DP World Tour, HotelPlanner Tour; spec/prores.md), without the window:
 * the extension's way there (apps/extension/src/europeantour-content.ts) on the phone. Each page of his is read once it
 * has loaded, and again a moment after he picks another season or tour in the page's own select; what was read is kept
 * merged (`EtKeeper`, `@glmsync/browser/europeantour`, shared with the extension), and *Send* reads the page once more
 * and sends a page per tour with something of it to every connected app, each after its plan (`ProClient`).
 *
 * *Fetch all* (decision 57; pickRun.ts, the extension's very run): on his tap on a page of his, his overview of each
 * tour, *Wins & Results* with each season of the reach and *Stats* with each tour are opened and picked for him at the
 * extension's pace, each read as above; at the end a page per tour goes out once, within the reach. While it runs the
 * window's own reads wait.
 *
 * Without it there is nothing to open: his results page has the rounds, a season at a time. Nothing is
 * read without a connection for a pro's pages (as the extension's content script reads nothing then), nothing while
 * the window is closed, and the site is asked nothing. Every keeper call runs one after the other, and no failure is
 * left uncaught: on his tap it becomes the bar's `error`; a read of its own that fails says nothing (only a page the
 * module doesn't know, as the extension's line does).
 */

import type { EtKeeper, EtView } from '@glmsync/browser/europeantour';
import type { ProView } from '@glmsync/browser/pro';
import type { LinePhase } from '@glmsync/browser/proView';
import { europeantour, run as pickRun, type TourSite } from '@glmsync/provider-tours';
import { PickRunDriver, type FetchAllDeps, type RunState } from './pickRun.ts';
import { AFTER_PICK_MS, onEtPage, type TourAnswer } from './toursPage.ts';

export interface EtState {
  view: ProView | null;
  /** The connections couldn't be read: the window says so, with *Load again*. */
  unread: boolean;
  et: EtView | null;
  phase: LinePhase;
  /** The tour a *Send* sent last (the bar speaks of it: an app keeps what it answered to the tour sent last). */
  sent: TourSite | null;
  /** *Fetch all*: the run going on, how the last one ended (none: the window offers no *Fetch all*). */
  run?: RunState;
}

export interface EtSessionDeps {
  keeper: Pick<EtKeeper, 'view' | 'seen' | 'pages'>;
  pro: { view(): Promise<ProView>; send(raw: unknown): Promise<ProView>; answer(yes: boolean): Promise<ProView> };
  lastPage: { set(url: string): Promise<void> };
  /** Ask the page script for a read of the page the window shows; null when no answer came. */
  read(): Promise<TourAnswer | null>;
  /** The player's day, on this phone's clock. */
  today(): string;
  onChange(state: EtState): void;
  /** *Fetch all* (none: not offered). */
  fetchAll?: FetchAllDeps;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class EtSession {
  private state: EtState = { view: null, unread: false, et: null, phase: 'ready', sent: null };
  private chain: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  private reading = false;
  private closed = false;
  /** The address of the page shown now (the window tells every move). */
  private shown: string | null = null;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  /** *Fetch all*'s run (none without it). */
  private readonly run: PickRunDriver | null;

  constructor(private readonly d: EtSessionDeps) {
    this.schedule = d.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = d.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.run = d.fetchAll
      ? new PickRunDriver({
          ...d.fetchAll,
          look: async () => ((await this.readNow(false)) ? 'read' : 'unread'),
          player: (url) => europeantour.playerPageOf(url)?.id ?? null,
          fresh: async () => undefined,
          send: () => this.sendRun(),
          // The keeper replaces another player's pages with his own read; nothing goes now.
          drop: async () => undefined,
          failed: () => this.set({ phase: 'error' }),
          today: d.today,
          onChange: (run) => this.set({ run }),
          ...(d.schedule ? { schedule: d.schedule } : {}),
          ...(d.cancel ? { cancel: d.cancel } : {}),
        })
      : null;
  }

  get now(): EtState {
    return this.state;
  }

  private set(part: Partial<EtState>): void {
    this.state = { ...this.state, ...part };
    if (!this.closed) this.d.onChange(this.state);
  }

  /** One keeper step after the other; a failure doesn't stop the ones after it. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private clearTimer(): void {
    if (this.timer !== null) this.cancel(this.timer);
    this.timer = null;
  }

  private get connected(): boolean {
    return !!this.state.view?.pairings.length;
  }

  /** The window opened: what is connected and what was kept (and a run left from a window that is gone ended). */
  async start(): Promise<void> {
    await this.loadView();
    await this.run?.start();
    try {
      const et = await this.serial(() => this.d.keeper.view());
      this.set({ et });
    } catch {
      this.set({ et: null }); // unreadable: the next read starts it afresh
    }
    // A page that loaded while the connections were still being read is read now.
    if (this.shown) void this.loaded(this.shown);
  }

  async loadView(): Promise<void> {
    try {
      this.set({ view: await this.d.pro.view(), unread: false });
    } catch {
      this.set({ unread: true });
    }
  }

  /** The window shows another page: whatever the bar said of the last one is over, and a pick waiting is dropped. */
  moved(url: string): void {
    this.shown = url;
    this.clearTimer();
    this.run?.moved(url);
    if (this.state.phase !== 'reading') this.set({ phase: 'ready' });
  }

  /**
   * Reads the page the window shows and keeps it. `mine`: his tap - a failure says so on the bar; otherwise only a page
   * the module doesn't know does. True when it was read.
   */
  private async readNow(mine: boolean): Promise<boolean> {
    const a = await this.d.read();
    if (!a) {
      if (mine) this.set({ phase: 'error' });
      return false;
    }
    if (!a.ok) {
      if (a.why === 'changed_page') this.set({ phase: 'changed_page' });
      else if (mine) this.set({ phase: 'ready' });
      return false;
    }
    if (!('et' in a)) {
      if (mine) this.set({ phase: 'error' });
      return false;
    }
    const et = await this.serial(() => this.d.keeper.seen(a.et));
    this.set(this.state.phase === 'changed_page' ? { et, phase: 'ready' } : { et });
    return true;
  }

  /** A read of the window's own (a page loaded, a pick): only with a connection, only of his page, one at a time. */
  private async look(url: string, after?: () => void): Promise<void> {
    if (this.closed || this.reading || !this.connected || !onEtPage(url) || url !== this.shown) return;
    this.reading = true;
    try {
      if (await this.readNow(false)) after?.();
    } catch {
      // Kept as it was; *Send* reads the page again.
    } finally {
      this.reading = false;
    }
  }

  /** The window finished loading `url`: a page of his is read as it shows. */
  async loaded(url: string): Promise<void> {
    this.shown = url;
    // During a run the page is the run's: it reads the pages it opened and after each of its picks.
    if (this.run?.takes(url)) {
      await this.run.loaded(url);
      return;
    }
    await this.look(url);
  }

  /** He picked another season or tour in the page's own select: read again a moment later, once the site shows it. */
  picked(url: string): void {
    if (this.closed || this.run?.running || !this.connected || !onEtPage(url) || url !== this.shown) return;
    this.clearTimer();
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.look(url, () => {
        // Something new to send: *Send* is offered again.
        if (this.state.phase === 'done') this.set({ phase: 'ready' });
      });
    }, AFTER_PICK_MS);
  }

  /** His tap on *Send*, on his page `url`: read it once more, then a page per tour to every connected app. */
  async send(url: string): Promise<void> {
    if (this.reading || this.run?.running || !onEtPage(url)) return;
    this.reading = true;
    this.clearTimer(); // the read now takes in a pick waiting
    this.set({ phase: 'reading' });
    try {
      if (!(await this.readNow(true))) return;
      const pages = await this.serial(() => this.d.keeper.pages(this.d.today()));
      if (pages.length === 0) {
        // Nothing on his pages worth sending (no rank, no tournament, no statistics): as the extension, nothing goes.
        this.set({ phase: 'ready' });
        return;
      }
      let view = this.state.view;
      for (const page of pages) view = await this.d.pro.send(page);
      this.set({ view, phase: 'done', sent: pages.at(-1)?.site ?? this.state.sent });
      await this.d.lastPage.set(url).catch(() => undefined);
    } catch {
      this.set({ phase: 'error' });
    } finally {
      this.reading = false;
    }
  }

  /** His tap on *Fetch all*, on a page of his `url`: his pages of both tours opened and picked for him. */
  async fetchAll(url: string): Promise<void> {
    if (!this.run || this.closed || this.reading || !this.connected || !onEtPage(url)) return;
    this.clearTimer(); // the run reads the pages itself
    this.set({ phase: 'ready' });
    await this.run.fetchAll(url);
  }

  /** His tap on *Stop*: the run ends where it is, and what it read goes out. */
  async stop(): Promise<void> {
    await this.run?.stop();
  }

  /** A run ended: a page per tour as read to every connected app, within the reach (two years, at most 50 tournaments). */
  private async sendRun(): Promise<void> {
    try {
      const today = this.d.today();
      const pages = await this.serial(() => this.d.keeper.pages(today));
      if (pages.length === 0) {
        this.set({ phase: 'ready' });
        return;
      }
      let view = this.state.view;
      for (const page of pages) view = await this.d.pro.send(pickRun.withinReach(page, today));
      this.set({ view, phase: 'done', sent: pages.at(-1)?.site ?? this.state.sent });
      if (this.shown && onEtPage(this.shown)) await this.d.lastPage.set(this.shown).catch(() => undefined);
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

  /**
   * The window closes: a pick waiting is dropped; what was read stays kept for the next *Send*. A run going on ends and
   * what it read goes out, as on *Stop*.
   */
  close(): void {
    this.closed = true;
    this.clearTimer();
    void this.run?.close();
  }
}
