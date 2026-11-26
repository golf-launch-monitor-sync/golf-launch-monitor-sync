// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* by itself on the phone (spec/hcp.md, *By itself, when the record is due*: a companion app, only while it
 * is open). Neither phone lets a web view work while the app is in the back (iOS suspends the app within seconds and
 * gives a background task or a silent wake about half a minute; Android's background work has no view at all), and a
 * run takes minutes - so the app looks when it comes to the front, and runs in a golf.de window kept behind its own
 * screen (src/ui/UnseenGolfde.tsx), which says on the home page that it runs.
 *
 * The run itself is `HcpClient`'s, as on a tap: here only when to start it, when the window may go, and how it ends -
 * the app to the back or the player's own golf.de window: interrupted, no hold (nothing went wrong); a page that leads
 * elsewhere (a sign-in) or the player's *Stop*: as an early stop, held until golf.de showed them signed in again.
 * Pure apart from what it is handed, so it is tested without a phone.
 */

import type { HcpClient, HcpView } from '@glmsync/browser/hcp';

/** Which page drives a run by itself: the window nobody sees (the player's window is lib/fetchAll.ts `WINDOW_OWNER`). */
export const AUTO_OWNER = 'unseen';
/** Runs of the day left for the player's tap: the phone may cut a run of its own off. */
export const AUTO_SPARE = 1;
/** After coming to the front, a moment first: a link that opened the app picks its screen before the look. */
export const LOOK_AFTER_MS = 4000;
/** The window's first page must have loaded by then; else the run ends (a slow network isn't golf.de's fault). */
export const LOAD_WITHIN_MS = 60_000;

export type AutoState = 'idle' | 'looking' | 'opening' | 'running';

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

export interface AutoDeps {
  hcp: Pick<HcpClient, 'autoDue' | 'startFetchAll' | 'interruptFetchAll' | 'leaveFetchAll' | 'cancelFetchAll'>;
  /** Shows the unseen window (it calls `loaded` once its first page is there); else the frame follows `subscribe`. */
  open?(): void;
  /** Takes it away again. */
  close?(): void;
  timers?: Timers;
}

/**
 * One run by itself at a time. Every method is safe to call in any state, and none throws: a failure to ask is the end
 * of this look, and the run ends by itself (`RUN_LEFT_MS`) if it was under way.
 */
export class AutoFetch {
  private st: AutoState = 'idle';
  /** Which look is the current one: a look ended meanwhile (and a newer begun) starts nothing. */
  private gen = 0;
  private timer: unknown = null;
  private readonly listeners = new Set<(s: AutoState) => void>();
  private readonly timers: Timers;

  constructor(private readonly deps: AutoDeps) {
    this.timers = deps.timers ?? { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  }

  get state(): AutoState {
    return this.st;
  }

  /** Hears every change of state (the frame shows or hides the window by it). */
  subscribe(fn: (s: AutoState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Looks whether a run is due, and starts it. `golfdeOpen`: the player's own golf.de window is open - there they tap.
   * True when the window should now show.
   */
  async look(golfdeOpen: boolean): Promise<boolean> {
    if (this.st !== 'idle' || golfdeOpen) return false;
    const mine = ++this.gen;
    const current = () => this.gen === mine && this.st === 'looking';
    this.set('looking');
    try {
      if (!(await this.deps.hcp.autoDue({ spare: AUTO_SPARE }))) return this.idle(mine, false);
      if (!current()) return false; // ended meanwhile (the app went to the back)
      const v = await this.deps.hcp.startFetchAll(AUTO_OWNER, { auto: true });
      if (v.fetch_all !== 'running' || !v.run?.auto) return this.idle(mine, false);
      if (!current()) {
        // Gone to the back while it started: the run ends at once, unheld.
        await this.deps.hcp.interruptFetchAll(AUTO_OWNER).catch(() => undefined);
        return false;
      }
    } catch {
      return this.idle(mine, false);
    }
    this.set('opening');
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.interrupt();
    }, LOAD_WITHIN_MS);
    this.safe(() => this.deps.open?.());
    return true;
  }

  /** The window's page has loaded: true the first time, when the window should start asking for its steps. */
  loaded(): boolean {
    if (this.st !== 'opening') return false;
    this.clearTimer();
    this.set('running');
    return true;
  }

  /** The window's run has ended (its steps said so): the window goes. */
  ended(): void {
    if (this.st === 'opening' || this.st === 'running') this.finish();
  }

  /** The app went to the back, or the player opens golf.de themselves: the run ends, what it read goes out, no hold. */
  async interrupt(): Promise<HcpView | null> {
    if (this.st === 'idle') return null;
    const had = this.st !== 'looking';
    this.gen++;
    this.finish();
    if (!had) return null; // a look still asking: it sees the state and starts nothing
    return this.deps.hcp.interruptFetchAll(AUTO_OWNER).catch(() => null);
  }

  /** The window's page led elsewhere (a sign-in page, golf.de's start page): an early stop, held as such. */
  async refused(): Promise<HcpView | null> {
    if (this.st !== 'opening' && this.st !== 'running') return null;
    this.finish();
    return this.deps.hcp.leaveFetchAll(AUTO_OWNER).catch(() => null);
  }

  /** The player taps *Stop* on the home page: as their *Stop* anywhere (held until they are back on golf.de). */
  async stop(): Promise<HcpView | null> {
    if (this.st === 'opening' || this.st === 'running') this.finish();
    return this.deps.hcp.cancelFetchAll().catch(() => null);
  }

  private finish(): void {
    this.clearTimer();
    const shown = this.st === 'opening' || this.st === 'running';
    this.set('idle');
    if (shown) this.safe(() => this.deps.close?.());
  }

  private idle<T>(mine: number, out: T): T {
    if (this.gen === mine && this.st === 'looking') this.set('idle');
    return out;
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }

  private set(s: AutoState): void {
    if (this.st === s) return;
    this.st = s;
    for (const fn of this.listeners) this.safe(() => fn(s));
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      // a listener's or the frame's trouble is its own
    }
  }
}
