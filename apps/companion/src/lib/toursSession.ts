// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tour window does, without the window (spec/prores.md): *Send* on his profile, *Fetch all* page by page,
 * *Stop*, the answer to *Is this page yours?*, and what happens when the window closes. The window (ToursView) hands it
 * how to ask the page script for a read and how to open a page; everything else is the extension's own parts - the
 * keeper of what was read (`TourKeeper`, `@glmsync/browser/tours`), its run's steps and pace (`progolftourRun`), and
 * `ProClient`, which sends to each connected app after its plan. So the app opens no page the extension wouldn't, at no
 * faster pace.
 *
 * Nothing by itself: a read only on his tap, or on a page his *Fetch all* opened. A run belongs to this window: one left
 * from a window that is gone (the app was closed during it) is ended when the window opens, and closing the window ends
 * a running one and sends what it read, as *Stop* does. Every keeper call runs one after the other (they read and write
 * the same entry), and no failure is left uncaught: it becomes the bar's `error`.
 */

import type { ProView } from '@glmsync/browser/pro';
import type { LinePhase } from '@glmsync/browser/proView';
import type { TourKeeper, TourView } from '@glmsync/browser/tours';
import { progolftour, progolftourRun } from '@glmsync/provider-tours';
import { WINDOW, type TourAnswer } from './toursPage.ts';

export interface TourState {
  view: ProView | null;
  /** The connections couldn't be read: the window says so, with *Load again*. */
  unread: boolean;
  tour: TourView | null;
  phase: LinePhase;
  /** *Fetch all* was refused just now: today's runs are used up. */
  limit: boolean;
}

export interface TourSessionDeps {
  keeper: Pick<TourKeeper, 'view' | 'seen' | 'fetchAll' | 'step' | 'stop' | 'page'>;
  pro: { view(): Promise<ProView>; send(raw: unknown): Promise<ProView>; answer(yes: boolean): Promise<ProView> };
  lastPage: { set(url: string): Promise<void> };
  /** Ask the page script for a read (`who`: his profile's name, on a tournament's page); null when no answer came. */
  read(who: string | null): Promise<TourAnswer | null>;
  /** Open a page in the window, as its link would. */
  open(url: string): void;
  /** The player's day, on this phone's clock. */
  today(): string;
  onChange(state: TourState): void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class TourSession {
  private state: TourState = { view: null, unread: false, tour: null, phase: 'ready', limit: false };
  private chain: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  /** The tournament page the run opened and waits for. */
  private awaiting: string | null = null;
  private reading = false;
  private closed = false;
  /** The address of the profile read last: kept for the window's next opening once a send went through. */
  private profileAt: string | null = null;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly d: TourSessionDeps) {
    this.schedule = d.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = d.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get now(): TourState {
    return this.state;
  }

  private set(part: Partial<TourState>): void {
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

  private later(ms: number): void {
    this.clearTimer();
    if (this.closed) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.advance();
    }, Math.max(0, ms));
  }

  /** The window opened: what is connected and what was read, and a run of a window that is gone ended. */
  async start(): Promise<void> {
    await this.loadView();
    try {
      const tour = await this.serial(async () => {
        const v = await this.d.keeper.view();
        return v.run ? this.d.keeper.stop() : v;
      });
      this.set({ tour });
    } catch {
      this.set({ tour: null }); // unreadable: the next read starts it afresh
    }
  }

  async loadView(): Promise<void> {
    try {
      this.set({ view: await this.d.pro.view(), unread: false });
    } catch {
      this.set({ unread: true });
    }
  }

  /** The window shows another page: whatever the bar said of the last one is over (a run goes on). */
  moved(): void {
    if (this.state.phase !== 'reading') this.set({ phase: 'ready', limit: false });
  }

  /** Reads the profile the window shows and keeps it; false (and the bar says why) when it couldn't. */
  private async readProfile(url: string): Promise<boolean> {
    const a = await this.d.read(null);
    if (!a) {
      this.set({ phase: 'error' });
      return false;
    }
    if (!a.ok || !('profile' in a)) {
      this.set({ phase: !a.ok && a.why === 'changed_page' ? 'changed_page' : 'ready' });
      return false;
    }
    const tour = await this.serial(() => this.d.keeper.seen({ profile: a.profile }));
    this.profileAt = url;
    this.set({ tour });
    return true;
  }

  /** What was read goes to every connected app, each after its plan. */
  private async sendRead(): Promise<void> {
    const page = await this.serial(() => this.d.keeper.page(this.d.today()));
    if (!page) {
      this.set({ phase: 'error' });
      return;
    }
    const view = await this.d.pro.send(page);
    this.set({ view, phase: 'done' });
    if (this.profileAt) await this.d.lastPage.set(this.profileAt).catch(() => undefined);
  }

  /** His tap on *Send*, on his profile `url`. */
  async send(url: string): Promise<void> {
    if (this.reading || this.state.tour?.run) return;
    this.reading = true;
    this.set({ phase: 'reading', limit: false });
    try {
      if (await this.readProfile(url)) await this.sendRead();
    } catch {
      this.set({ phase: 'error' });
    } finally {
      this.reading = false;
    }
  }

  /** His tap on *Fetch all*, on his profile `url`: read it, then his finished tournaments' pages one by one. */
  async fetchAll(url: string): Promise<void> {
    if (this.reading || this.state.tour?.run) return;
    this.reading = true;
    this.set({ phase: 'reading', limit: false });
    try {
      if (!(await this.readProfile(url))) return;
      const r = await this.serial(() => this.d.keeper.fetchAll(WINDOW, this.d.today()));
      const tour = await this.serial(() => this.d.keeper.view());
      if (r === 'limit') this.set({ tour, phase: 'ready', limit: true });
      else if (r === 'nothing') this.set({ tour, phase: 'error' });
      else {
        this.set({ tour, phase: 'ready' });
        this.later(0);
      }
    } catch {
      this.set({ phase: 'error' });
    } finally {
      this.reading = false;
    }
  }

  /** The run's next step: wait, open the next page, or - at its end - send what it read. */
  private async advance(): Promise<void> {
    if (this.closed) return;
    try {
      const step = await this.serial(() => this.d.keeper.step(WINDOW));
      const tour = await this.serial(() => this.d.keeper.view());
      this.set({ tour });
      if (!step) return;
      if (step.do === 'wait') {
        this.later(step.ms);
      } else if (step.do === 'open') {
        // Only the pages the module lets a run open (the keeper checked it too).
        if (!progolftour.mayOpen(step.url)) return this.later(0);
        this.awaiting = progolftour.resultKey(step.url);
        this.d.open(step.url);
        // No answer in time (the page didn't load, a script of the site in the way): the keeper counts it a miss.
        this.later(progolftourRun.TOUR_CLICKS.answer_wait_ms + 500);
      } else {
        this.awaiting = null;
        await this.sendRead();
      }
    } catch {
      this.awaiting = null;
      this.set({ phase: 'error' });
    }
  }

  /** The window finished loading `url`: when it is the page the run opened, his line of it is read. */
  async loaded(url: string): Promise<void> {
    const key = progolftour.resultKey(url);
    if (!key || key !== this.awaiting || this.reading) return;
    this.reading = true;
    try {
      const a = await this.d.read(this.state.tour?.who ?? null);
      if (key !== this.awaiting) return; // the run moved on meanwhile (its wait ran out)
      this.awaiting = null;
      if (a?.ok && 'line' in a) await this.serial(() => this.d.keeper.seen({ key, line: a.line }));
      else if (a?.ok && 'unread' in a) await this.serial(() => this.d.keeper.seen({ key, unread: a.unread }));
      else if (a && !a.ok && a.why === 'changed_page') await this.serial(() => this.d.keeper.seen({ key, unread: 'changed_page' }));
      else return this.later(0); // no answer: the keeper counts it a miss on the next step
      this.later(0);
    } catch {
      this.later(0);
    } finally {
      this.reading = false;
    }
  }

  /** His tap on *Stop*: the run ends where it is, and what it read goes out. */
  async stop(): Promise<void> {
    this.clearTimer();
    this.awaiting = null;
    try {
      const tour = await this.serial(() => this.d.keeper.stop());
      this.set({ tour });
      await this.sendRead();
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

  /** The window closes: a running run ends and what it read goes out, as on *Stop*; nothing is told the window any more. */
  async close(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    this.awaiting = null;
    try {
      const v = await this.serial(() => this.d.keeper.view());
      if (!v.run) return;
      await this.serial(() => this.d.keeper.stop());
      const page = await this.serial(() => this.d.keeper.page(this.d.today()));
      if (page) await this.d.pro.send(page);
      if (page && this.profileAt) await this.d.lastPage.set(this.profileAt);
    } catch {
      // The window is gone: what was read stays kept and goes with the next send.
    }
  }
}
