// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One tournament from golf.de's page in the app's golf.de window (spec/hcp.md, *Taking one tournament*, 1.19.0): the
 * page script says whether the page is a tournament's to offer; the player taps *Add to …* for an app; the window asks
 * the page for its lines then (`takeScript`), and what comes back goes to that app through `HcpClient.takeEvent`, which
 * reads it again. Nothing without the tap. Kept apart from the window (GolfdeView) so it is tested without one.
 */

import type { TakeOutcome } from '@glmsync/browser/hcp';
import { takeScript, type EventMessage } from './golfdePage.ts';

/** How long the page has to answer a tap before the window says it didn't. */
export const TAKE_WAIT_MS = 10_000;

export interface EventState {
  /** Whether the page is a tournament's the window offers to take. */
  offer: boolean;
  /** The app a tap is under way for. */
  busy: string | null;
  /** What the last tap came to; null: nothing to say. */
  said: TakeOutcome | null;
}

export interface EventTakeDeps {
  hcp: { takeEvent(id: string, event: unknown): Promise<TakeOutcome> };
  inject(script: string): void;
  show(state: EventState): void;
  /** The name of an app by its pairing's id, for what is said when the page can't be read. */
  nameOf(id: string): string | undefined;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** A refusal the window says itself, named for the app tapped where its name is known. */
function refusal(name: string | undefined, error: 'changed_page' | 'failed'): TakeOutcome {
  return name ? { ok: false, name, error } : { ok: false, error };
}

export class EventTake {
  private state: EventState = { offer: false, busy: null, said: null };
  private timer: unknown = null;

  constructor(private readonly deps: EventTakeDeps) {}

  private set(change: Partial<EventState>): void {
    this.state = { ...this.state, ...change };
    this.deps.show(this.state);
  }

  private stopTimer(): void {
    if (this.timer !== null) (this.deps.clearTimer ?? clearTimeout)(this.timer as ReturnType<typeof setTimeout>);
    this.timer = null;
  }

  /** The player tapped *Add to …* for app `id`: the page is asked for its tournament now. */
  tap(id: string): void {
    if (this.state.busy) return;
    this.set({ busy: id, said: null });
    this.timer = (this.deps.setTimer ?? setTimeout)(() => {
      this.timer = null;
      if (this.state.busy === id) this.set({ busy: null, said: refusal(this.deps.nameOf(id), 'changed_page') });
    }, TAKE_WAIT_MS);
    try {
      this.deps.inject(takeScript());
    } catch {
      this.stopTimer();
      this.set({ busy: null, said: refusal(this.deps.nameOf(id), 'failed') });
    }
  }

  /** A message of the page script about a tournament's page (already read strictly: `readEventMessage`). */
  async message(m: EventMessage): Promise<void> {
    if ('offer' in m) {
      // Another page, or the same one gone: what the last tap said was about the one before.
      this.set({ offer: m.offer, said: null });
      return;
    }
    const id = this.state.busy;
    if (!id) return; // not asked for: nothing goes anywhere
    this.stopTimer();
    if ('refused' in m) {
      this.set({ busy: null, said: refusal(this.deps.nameOf(id), 'changed_page') });
      return;
    }
    let said: TakeOutcome;
    try {
      said = await this.deps.hcp.takeEvent(id, m.event);
    } catch {
      said = refusal(this.deps.nameOf(id), 'failed');
    }
    this.set({ busy: null, said });
  }

  /** The window goes. */
  stop(): void {
    this.stopTimer();
  }
}
