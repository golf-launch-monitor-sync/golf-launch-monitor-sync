// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* in the tour window on the tours whose pages show a part at a time (decision 57; the Alps Tour,
 * europeantour.com, the LET's, the season pages), without the window: the extension's very run on the phone. The run is
 * the extension's value (`run`, `tour-runs` of `@glmsync/provider-tours`), kept by its keeper (`RunKeeper`,
 * `@glmsync/browser/runs`, three runs a day per tour); planned only from the window's address on his tap, it opens only
 * his own pages there (the keeper checks `runMayOpen` before each) and picks only in the page's own pickers, one step at
 * a time at the extension's pace (6-10 s after each answer, 30 s for an answer, three without one end it).
 *
 * Each tour's session (alpsSession.ts, etSession.ts, ocsSession.ts, seasonSession.ts) hands in what is its own: how the
 * page the window shows is read and kept (`look`), and what goes out at the end (`send`: its pages within the reach,
 * the last two years and at most 50 tournaments). The window hands in how a pick is done in the page (`pick`: the page
 * script, `operate.pickSettled`) and how a page is opened. A run belongs to this window: one left from a window that is
 * gone (the app was closed during it) is ended when a window opens, and closing the window ends a running one and sends
 * what it read, as *Stop* does. Another player's page opened meanwhile ends it, and nothing goes.
 *
 * Every keeper call runs one after the other, and no failure is left uncaught: it ends as the session's `error`.
 */

import type { RunKeeper, RunView } from '@glmsync/browser/runs';
import { type operate, run as pickRun, type RunFamily } from '@glmsync/provider-tours';
import { WINDOW } from './toursPage.ts';

/** What the bar shows of *Fetch all*. */
export interface RunState {
  /** The keeper's view: the run going on (with how far it got), how the last one ended. */
  view: RunView | null;
  /** *Fetch all* was refused just now: today's runs of this tour are used up. */
  limit: boolean;
}

export interface PickRunDeps {
  runs: Pick<RunKeeper, 'view' | 'start' | 'step' | 'seen' | 'stop'>;
  /** Reads the page the window shows (at `url`) and keeps what is his: `read`, or `unread` when it showed nothing of it. */
  look(url: string): Promise<'read' | 'unread'>;
  /** Does a pick in the page as a person does it and waits until it shows; null when no answer came. */
  pick(step: Extract<pickRun.PickStep, { do: 'pick' }>): Promise<operate.PickResult | null>;
  /** Opens one of his own pages in the window, as its link would. */
  open(url: string): void;
  /** Whose page this is, where its address says it. */
  player(url: string): string | null;
  /** A run started afresh: what its tour keeps of an earlier run goes (the season pages keep a run's reads). */
  fresh(family: RunFamily): Promise<void>;
  /** The run ended: what it read goes to every connected app, within the reach. */
  send(family: RunFamily): Promise<void>;
  /** Another player's page ended the run: what was kept may be his, and nothing goes. */
  drop(family: RunFamily): Promise<void>;
  /** A step of the run failed in a way the bar should say (the keeper unreadable, a send that failed). */
  failed(): void;
  /** The player's day, on this phone's clock. */
  today(): string;
  onChange(state: RunState): void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

/** What the window hands a tour's session for *Fetch all*: the run's keeper, how a pick is done, how a page opens. */
export type FetchAllDeps = Pick<PickRunDeps, 'runs' | 'pick' | 'open'>;

export class PickRunDriver {
  private state: RunState = { view: null, limit: false };
  private chain: Promise<unknown> = Promise.resolve();
  private timer: unknown = null;
  /** The page the run opened and waits for. */
  private awaiting: string | null = null;
  /** A step is being taken (a pick in the page, a page read): the next waits for it. */
  private stepping = false;
  private closed = false;
  /** The address the window shows now (the window tells every move). */
  private shown: string | null = null;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  constructor(private readonly d: PickRunDeps) {
    this.schedule = d.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancel = d.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get now(): RunState {
    return this.state;
  }

  /** Whether a run of this window goes on: the session's own reads of a loaded page or a pick wait then. */
  get running(): boolean {
    return this.state.view?.running?.tab === WINDOW;
  }

  private set(part: Partial<RunState>): void {
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

  private async refresh(): Promise<void> {
    this.set({ view: await this.serial(() => this.d.runs.view()) });
  }

  /** The window opened: a run left from a window that is gone ends where it is (what it read stays kept). */
  async start(): Promise<void> {
    try {
      const view = await this.serial(() => this.d.runs.view());
      if (view.running?.tab === WINDOW) await this.serial(() => this.d.runs.stop('cancelled', WINDOW));
      await this.refresh();
    } catch {
      this.set({ view: null }); // unreadable: the next run starts it afresh
    }
  }

  /** The window shows another page (a run goes on: a page it opened answers when it has loaded). */
  moved(url: string): void {
    this.shown = url;
    if (this.state.limit) this.set({ limit: false });
  }

  /** His tap on *Fetch all*, on his page `url`: the run planned from it starts, and its steps follow. */
  async fetchAll(url: string): Promise<void> {
    if (this.closed || this.running || this.stepping) return;
    this.shown = url;
    try {
      const r = await this.serial(() => this.d.runs.start(url, WINDOW, this.d.today()));
      if (r.outcome === 'started' && r.fresh && r.family) await this.d.fresh(r.family);
      await this.refresh();
      if (r.outcome === 'limit') this.set({ limit: true });
      else if (r.outcome === 'started') this.later(0);
      // `nothing`: no run starts on this page (the bar offers *Fetch all* only where one does); `busy` can't be in one
      // window (a run left is ended when it opens) - either way, nothing more to do but say so.
      else this.d.failed();
    } catch {
      this.d.failed();
    }
  }

  /** The run's next step: wait, open one of his pages, pick in the page, or - at its end - send what it read. */
  private async advance(): Promise<void> {
    if (this.closed || this.stepping) return;
    try {
      const s = await this.serial(() => this.d.runs.step(WINDOW));
      await this.refresh();
      if (!s) return;
      const { step, family } = s;
      if (step.do === 'wait') {
        this.later(step.ms);
      } else if (step.do === 'open') {
        this.awaiting = step.url;
        this.d.open(step.url);
        // No answer in time (the page didn't load, a script of the site in the way): the keeper counts it a miss.
        this.later(pickRun.TOUR_CLICKS.answer_wait_ms + 500);
      } else if (step.do === 'pick') {
        await this.pickNow(step);
      } else {
        await this.ended(family);
      }
    } catch {
      this.awaiting = null;
      this.d.failed();
    }
  }

  /** A pick in the page, then the page read as it shows (as after the player's own pick), and told the keeper. */
  private async pickNow(step: Extract<pickRun.PickStep, { do: 'pick' }>): Promise<void> {
    this.stepping = true;
    let outcome: pickRun.PickOutcome = 'unread';
    try {
      const done = await this.d.pick(step);
      if (done === 'absent') outcome = 'absent';
      else if (done === 'picked' || done === 'already') outcome = this.shown ? await this.d.look(this.shown) : 'unread';
      // `missing` (no such picker: the page looks different) or no answer: nothing read, the run goes on.
    } catch {
      outcome = 'unread';
    } finally {
      this.stepping = false;
    }
    if (this.closed) return;
    await this.tell({ key: step.key, outcome });
  }

  /**
   * What the page showed, to the keeper (with whose page it is). `answer`: it answers the step - the next step (or the
   * end) follows; otherwise the run's own timer stays as it is.
   */
  private async tell(seen: Omit<pickRun.PickSeen, 'url' | 'player'>, answer = true): Promise<void> {
    const url = this.shown ?? '';
    const player = url ? this.d.player(url) : null;
    const view = await this.serial(() => this.d.runs.seen(WINDOW, { url, ...seen, ...(player ? { player: player.toLowerCase() } : {}) }));
    this.set({ view });
    // Another player's page ended it: nothing of what was kept goes.
    if (view.ended?.how === 'other_player' && !view.running) {
      this.clearTimer();
      this.awaiting = null;
      await this.d.drop(view.ended.family);
      return;
    }
    if (answer) this.later(0);
  }

  /** Whether a page the window loaded at `url` is the run's (one goes on): the session then hands it to `loaded`. */
  takes(url: string): boolean {
    this.shown = url;
    return this.running;
  }

  /**
   * The window finished loading `url` (or the site moved there). During a run it is the run's: the page it opened is
   * read and answers its step; any other page is only looked at for whose it is (another player's ends the run). True
   * when the run took it, so the session reads nothing of its own.
   */
  async loaded(url: string): Promise<boolean> {
    this.shown = url;
    if (!this.running) return false;
    if (this.stepping) return true; // a pick is being done: the page it shows is read after it
    const opened = this.awaiting !== null && pickRun.sameAddress(url, this.awaiting);
    if (!opened) {
      // Not the page the run waits for: said so with whose page it is - another player's ends the run.
      try {
        if (this.d.player(url) !== null) await this.tell({ outcome: 'unread' }, false);
      } catch {
        this.d.failed();
      }
      return true;
    }
    this.awaiting = null;
    this.clearTimer();
    this.stepping = true;
    let outcome: 'read' | 'unread' = 'unread';
    try {
      outcome = await this.d.look(url);
    } catch {
      outcome = 'unread';
    } finally {
      this.stepping = false;
    }
    if (this.closed) return true;
    try {
      await this.tell({ outcome });
    } catch {
      this.d.failed();
    }
    return true;
  }

  /** The run ended (ran through, or a stop the keeper made): what it read goes out - not after another player's page. */
  private async ended(family: RunFamily): Promise<void> {
    this.awaiting = null;
    const view = await this.serial(() => this.d.runs.view());
    this.set({ view });
    if (view.ended?.family === family && view.ended.how === 'other_player') await this.d.drop(family);
    else await this.d.send(family);
  }

  /** His tap on *Stop*: the run ends where it is, and what it read goes out. */
  async stop(): Promise<void> {
    this.clearTimer();
    this.awaiting = null;
    try {
      const family = await this.serial(() => this.d.runs.stop('cancelled', WINDOW));
      await this.refresh();
      if (family) await this.d.send(family);
    } catch {
      this.d.failed();
    }
  }

  /** The window closes: a running run ends and what it read goes out, as on *Stop*; nothing is told the window any more. */
  async close(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    this.awaiting = null;
    try {
      const family = await this.serial(() => this.d.runs.stop('cancelled', WINDOW));
      if (family) await this.d.send(family);
    } catch {
      // The window is gone: what was read stays kept and goes with the next send.
    }
  }
}
