// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* in the app's golf.de window (spec/hcp.md, clicking for the player): the extension's run (`HcpClient`),
 * driven from here one step at a time. A step is taken in golf.de's page by the page script's own step function
 * (scripts/golfde-page.entry.ts: golf.de's pager link, its Scoring Record button), or by opening one of the addresses
 * a run may open; golf.de's page loads what it loads, and the page script reads along as always. Nothing here asks
 * golf.de anything. Pure apart from what it is handed, so it is tested without a phone.
 */

import type { HcpView, RunTurn } from '@glmsync/browser/hcp';
import { mayOpen, type Step } from '@glmsync/provider-golfde/operate';

/** The name the page script gives its step function on golf.de's window. */
export const STEP_FUNCTION = '__glmsyncGolfdeStep';
/** Which page drives the run: the app has one golf.de window. */
export const WINDOW_OWNER = 'window';

/** The script the window injects to take a step; null for a step that isn't taken in the page. */
export function stepScript(step: Step): string | null {
  if (step.do === 'open') return mayOpen(step.url) ? `window.location.assign(${JSON.stringify(step.url)}); true;` : null;
  if (step.do === 'page' || step.do === 'click') {
    const arg = JSON.stringify(JSON.stringify(step));
    return `(function () { try { var f = window[${JSON.stringify(STEP_FUNCTION)}]; if (typeof f === 'function') f(${arg}); } catch (e) {} })(); true;`;
  }
  return null;
}

export interface DriverDeps {
  hcp: { runStep(owner: string): Promise<RunTurn> };
  inject(script: string): void;
  sleep(ms: number): Promise<void>;
  show(v: HcpView): void;
}

/**
 * Asks for the next step until the run is over, and takes it. One loop at a time; `stop` ends it (the run itself is
 * cancelled by whoever stops it). A failure to ask is the end of this loop, not a crash: the run ends by itself
 * (`RUN_LEFT_MS`) and sends what it read.
 */
export class Driver {
  private on = false;

  constructor(private readonly deps: DriverDeps) {}

  get driving(): boolean {
    return this.on;
  }

  stop(): void {
    this.on = false;
  }

  async drive(): Promise<void> {
    if (this.on) return;
    this.on = true;
    try {
      while (this.on) {
        let turn: RunTurn;
        try {
          turn = await this.deps.hcp.runStep(WINDOW_OWNER);
        } catch {
          return;
        }
        if (!this.on) return;
        this.deps.show(turn.view);
        const step = turn.step;
        if (step.do === 'end') return;
        if (step.do === 'wait') {
          await this.deps.sleep(Math.min(Math.max(step.ms, 200), 10_000));
          continue;
        }
        const script = stepScript(step);
        if (script) this.deps.inject(script);
        await this.deps.sleep(500);
      }
    } finally {
      this.on = false;
    }
  }
}
