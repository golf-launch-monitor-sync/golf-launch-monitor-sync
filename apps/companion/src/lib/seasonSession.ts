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
 * Nothing is read without a connection for a pro's pages (the bar offers no *Send* then), nothing while the window is
 * closed, and the site is asked nothing. No failure is left uncaught: on his tap it becomes the bar's `error`.
 */

import type { ProView } from '@glmsync/browser/pro';
import type { LinePhase } from '@glmsync/browser/proView';
import { onSeasonResults, type TourAnswer } from './toursPage.ts';

/** What the bar says in place of the line's words, as the extension's line does (`seasonLine.*`). */
export type SeasonNote = 'otherTour' | 'nothing';

export interface SeasonState {
  view: ProView | null;
  /** The connections couldn't be read: the window says so, with *Load again*. */
  unread: boolean;
  phase: LinePhase;
  note: SeasonNote | null;
}

export interface SeasonSessionDeps {
  pro: { view(): Promise<ProView>; send(raw: unknown): Promise<ProView>; answer(yes: boolean): Promise<ProView> };
  lastPage: { set(url: string): Promise<void> };
  /** Ask the page script for a read of the page the window shows; null when no answer came. */
  read(): Promise<TourAnswer | null>;
  onChange(state: SeasonState): void;
}

export class SeasonSession {
  private state: SeasonState = { view: null, unread: false, phase: 'ready', note: null };
  private reading = false;
  private closed = false;

  constructor(private readonly d: SeasonSessionDeps) {}

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

  /** The window opened: what is connected. */
  async start(): Promise<void> {
    await this.loadView();
  }

  async loadView(): Promise<void> {
    try {
      this.set({ view: await this.d.pro.view(), unread: false });
    } catch {
      this.set({ unread: true });
    }
  }

  /** The window shows another page: whatever the bar said of the last one is over. */
  moved(): void {
    this.set(this.state.phase === 'reading' ? { note: null } : { phase: 'ready', note: null });
  }

  /** His tap on *Send* on his *Results* page: the season it shows to every connected app. */
  async send(url: string): Promise<void> {
    if (this.closed || this.reading || !this.connected || !onSeasonResults(url)) return;
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

  /** His answer to *Is this page yours?*. */
  async answer(yes: boolean): Promise<void> {
    try {
      this.set({ view: await this.d.pro.answer(yes), phase: 'done' });
    } catch {
      this.set({ phase: 'error' });
    }
  }

  /** The window closes. */
  close(): void {
    this.closed = true;
  }
}
