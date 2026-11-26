// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tour window does on the Alps Tour (`alps`; spec/prores.md), without the window: the extension's way there
 * (apps/extension/src/alps-content.ts) on the phone.
 *
 * His profile shows one report at a time, picked in the page's own select (*Select Report*): *This Season record* (his
 * rounds), *Results* (the totals to par, for the par), *Order of Merit* (his rank). The report shown is read once his
 * profile has loaded, and again a moment after he picks another; what was read is kept merged (`AlpsKeeper`,
 * `@glmsync/browser/alps`, shared with the extension), and *Send* reads the report once more and sends his season with
 * its rounds and his rank to every connected app, each after its plan (`ProClient`).
 *
 * The site changes its address without loading a page; the window tells every move (`moved`, `loaded`), whether the web
 * view saw it or the page script did. Nothing is read without a connection for a pro's pages (as the extension's content
 * script reads nothing then), nothing while the window is closed, and the site is asked nothing. Every keeper call runs
 * one after the other, and no failure is left uncaught: on his tap it becomes the bar's `error`; a read of its own that
 * fails says nothing (only a page the module doesn't know, as the extension's line does).
 */

import type { AlpsKeeper, AlpsView } from '@glmsync/browser/alps';
import type { ProView } from '@glmsync/browser/pro';
import type { LinePhase } from '@glmsync/browser/proView';
import { AFTER_PICK_MS, onAlpsProfile, type TourAnswer } from './toursPage.ts';

export interface AlpsState {
  view: ProView | null;
  /** The connections couldn't be read: the window says so, with *Load again*. */
  unread: boolean;
  alps: AlpsView | null;
  phase: LinePhase;
}

export interface AlpsSessionDeps {
  keeper: Pick<AlpsKeeper, 'view' | 'seen' | 'page'>;
  pro: { view(): Promise<ProView>; send(raw: unknown): Promise<ProView>; answer(yes: boolean): Promise<ProView> };
  lastPage: { set(url: string): Promise<void> };
  /** Ask the page script for a read of the page the window shows; null when no answer came. */
  read(): Promise<TourAnswer | null>;
  /** The player's day, on this phone's clock. */
  today(): string;
  onChange(state: AlpsState): void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class AlpsSession {
  private state: AlpsState = { view: null, unread: false, alps: null, phase: 'ready' };
  private chain: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  private reading = false;
  private closed = false;
  /** The address of the page shown now (the window tells every move). */
  private shown: string | null = null;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly d: AlpsSessionDeps) {
    this.schedule = d.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = d.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get now(): AlpsState {
    return this.state;
  }

  private set(part: Partial<AlpsState>): void {
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

  /** The window opened: what is connected and what was kept. */
  async start(): Promise<void> {
    await this.loadView();
    try {
      const alps = await this.serial(() => this.d.keeper.view());
      this.set({ alps });
    } catch {
      this.set({ alps: null }); // unreadable: the next read starts it afresh
    }
    // A profile that loaded while the connections were still being read is read now.
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
    if (this.state.phase !== 'reading') this.set({ phase: 'ready' });
  }

  /**
   * Reads the report the window shows and keeps it merged. `mine`: his tap - a failure says so on the bar; otherwise only
   * a page the module doesn't know does. True when it was read.
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
    if (!('alps' in a)) {
      if (mine) this.set({ phase: 'error' });
      return false;
    }
    const alps = await this.serial(() => this.d.keeper.seen(a.alps));
    this.set(this.state.phase === 'changed_page' ? { alps, phase: 'ready' } : { alps });
    return true;
  }

  /** A read of the window's own (his profile loaded, a pick): only with a connection, only of his profile, one at a time. */
  private async look(url: string, after?: () => void): Promise<void> {
    if (this.closed || this.reading || !this.connected || !onAlpsProfile(url) || url !== this.shown) return;
    this.reading = true;
    try {
      if (await this.readNow(false)) after?.();
    } catch {
      // Kept as it was; *Send* reads the report again.
    } finally {
      this.reading = false;
    }
  }

  /** The window finished loading `url` (or the site moved there): his profile is read as it shows. */
  async loaded(url: string): Promise<void> {
    this.shown = url;
    await this.look(url);
  }

  /** He picked another report in the page's own select: read again a moment later, once the site shows it. */
  picked(url: string): void {
    if (this.closed || !this.connected || !onAlpsProfile(url) || url !== this.shown) return;
    this.clearTimer();
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.look(url, () => {
        // Something new to send: *Send* is offered again.
        if (this.state.phase === 'done') this.set({ phase: 'ready' });
      });
    }, AFTER_PICK_MS);
  }

  /** His tap on *Send*, on his profile `url`: read the report once more, then his season to every connected app. */
  async send(url: string): Promise<void> {
    if (this.reading || !onAlpsProfile(url)) return;
    this.reading = true;
    this.clearTimer(); // the read now takes in a pick waiting
    this.set({ phase: 'reading' });
    try {
      if (!(await this.readNow(true))) return;
      const page = await this.serial(() => this.d.keeper.page(this.d.today()));
      if (!page) {
        // Nothing read that could go (no rounds of a tournament over, no rank): the bar says which report to pick.
        this.set({ phase: 'ready' });
        return;
      }
      this.set({ view: await this.d.pro.send(page), phase: 'done' });
      await this.d.lastPage.set(url).catch(() => undefined);
    } catch {
      this.set({ phase: 'error' });
    } finally {
      this.reading = false;
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

  /** The window closes: a pick waiting is dropped; what was read stays kept for the next *Send*. */
  close(): void {
    this.closed = true;
    this.clearTimer();
  }
}
