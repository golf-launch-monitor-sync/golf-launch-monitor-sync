// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the tours whose pages show a part at a time (Alps Tour, europeantour.com, the LET's, the season pages;
 * `run` and `tour-runs` of `@glmsync/provider-tours`), the content scripts' shared part: the tap, the steps of the
 * background's run for this tab, a pick done in the page as a person does it (`operate`), and what the page showed
 * after it. The background plans the run from the page's address and opens nothing it may not; this side only takes
 * the step it is told, in the tab it runs in.
 *
 * Each tour's content script hands in its own reading (`look`): after a step the page is read as it is read whenever
 * the player opens or picks it himself, and handed on as always.
 */

import type { RunView } from '@glmsync/browser/runs';
import { operate, type run } from '@glmsync/provider-tours';
import type { Reply } from './messages.ts';

export type RunAsk =
  | { type: 'trun-view' }
  | { type: 'trun-start'; url: string }
  | { type: 'trun-step' }
  | { type: 'trun-seen'; url: string; key?: string; player?: string; outcome: run.PickOutcome }
  | { type: 'trun-stop' };

export interface RunHooks {
  /** Reads the page as it shows now and hands it on (the tour's own message): `read`, or `unread` when it showed nothing. */
  look(): Promise<'read' | 'unread'>;
  /** Whose page this is, where its address says it. */
  player(): string | null;
  /** The background's answer to anything: its view of the run (and of a pro's pages) for the line. */
  answer(r: Extract<Reply, { ok: true }>): void;
  /** While a pick is being done: the page's own `change` isn't the player's. */
  picking(on: boolean): void;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A person's press and the browser's own way to set a select: events the page's scripts listen for. */
export const pageEnv: operate.OpEnv = {
  press(el) {
    const e = el as unknown as HTMLElement;
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const init = { bubbles: true, cancelable: true, composed: true, button: 0, buttons: type.endsWith('down') ? 1 : 0 };
      e.dispatchEvent(type.startsWith('pointer') && typeof PointerEvent === 'function' ? new PointerEvent(type, init) : new MouseEvent(type, init));
    }
    e.click();
  },
  choose(select, value) {
    const s = select as unknown as HTMLSelectElement;
    // The element's own setter, so a page that watches the property sees the change as from a person.
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    if (set) set.call(s, value);
    else s.value = value;
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
  },
  escape(el) {
    (el as unknown as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  },
  sleep,
};

export async function runAsk(m: RunAsk): Promise<Extract<Reply, { ok: true }> | null> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    return r?.ok ? r : null;
  } catch {
    // The extension was updated or reloaded meanwhile: the page goes on without the run.
    return null;
  }
}

async function tell(h: RunHooks, m: RunAsk): Promise<Extract<Reply, { ok: true }> | null> {
  const r = await runAsk(m);
  if (r) h.answer(r);
  return r;
}

/** A pick done in the page, waited for until the page shows it and its table, then read. */
async function doPick(h: RunHooks, step: Extract<run.PickStep, { do: 'pick' }>): Promise<run.PickOutcome> {
  h.picking(true);
  try {
    // Waited for as a person would: a picker still being drawn, then the new table (`operate.pickSettled`).
    const done = await operate.pickSettled(document as unknown as operate.OpRoot, step, pageEnv);
    if (done === 'absent') return 'absent';
    if (done === 'missing') return 'unread';
    return await h.look();
  } catch {
    // A page whose pickers we can't work: nothing read, the run goes on.
    return 'unread';
  } finally {
    h.picking(false);
  }
}

/** Whether this page already follows the run's steps (one loop a page, however often *Fetch all* is tapped). */
let looping = false;

/** The run's steps for this tab, one at a time, until it ends or the page is left (another tab gets none). */
export async function runSteps(h: RunHooks): Promise<void> {
  if (looping) return;
  looping = true;
  try {
    await steps(h);
  } finally {
    looping = false;
  }
}

async function steps(h: RunHooks): Promise<void> {
  for (;;) {
    const r = await tell(h, { type: 'trun-step' });
    const step = r?.runStep;
    if (!step) return;
    if (step.do === 'wait') await sleep(step.ms);
    else if (step.do === 'open') {
      // The background checked the address is one of his pages there; the page that opens answers the step.
      location.assign(step.url);
      return;
    } else if (step.do === 'pick') {
      const outcome = await doPick(h, step);
      const player = h.player();
      await tell(h, { type: 'trun-seen', url: location.href, key: step.key, outcome, ...(player ? { player } : {}) });
    } else return;
  }
}

/** *Fetch all* tapped: the run starts on this page and its steps follow. */
export async function startRun(h: RunHooks): Promise<Extract<Reply, { ok: true }> | null> {
  const r = await tell(h, { type: 'trun-start', url: location.href });
  if (r?.start === 'started') void runSteps(h);
  return r;
}

/** *Stop* tapped. */
export const stopRun = (h: RunHooks) => tell(h, { type: 'trun-stop' });

/**
 * A page loaded: if the run going on is this tab's, it is the page a step opened - read (`read`: the tour's own reading;
 * called only then), said so, and the steps go on. Returns the run's view.
 */
export async function resumeRun(h: RunHooks, read: () => Promise<'read' | 'unread' | null>): Promise<RunView | undefined> {
  const r = await tell(h, { type: 'trun-view' });
  if (!r?.run?.running || !r.runHere) return r?.run;
  let outcome: 'read' | 'unread' | null;
  try {
    outcome = await read();
  } catch {
    outcome = 'unread';
  }
  const player = h.player();
  await tell(h, { type: 'trun-seen', url: location.href, outcome: outcome ?? 'unread', ...(player ? { player } : {}) });
  void runSteps(h);
  return r.run;
}
