// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Fetching without a visible switch on Android (spec/deep-links.md, "Android"): a target app binds to
 * this app's sync service while it is in front, and the service runs this as a headless JS task
 * (modules/glmsync-sync). Everything here is the part without a phone, tested with vitest.
 *
 * A binding comes from another app - any app may bind to an exported service - so it can make this app
 * do no more than a sync link would:
 * - only a target this phone is paired with (the link names it), only its pairings;
 * - the target's plan first, through the same runner (and so the same queue and guard) as the screen
 *   and the background task;
 * - one at a time per target, and not again within a few seconds: an app that binds in a loop costs a
 *   target a plan request now and then, and the provider nothing the plan doesn't allow.
 */

import { parseSyncIntent, type SyncIntentReason } from '@glmsync/spec';
import type { KeyedPairing, LastRun } from '@glmsync/engine';

/** The name the headless task is registered under; the native service starts it by this name. */
export const NUDGE_TASK = 'glmsync-nudge';
/** A target holds its binding at most two minutes: the task gets as long, then it's cut off. */
export const NUDGE_TIMEOUT_MS = 120_000;
/** A second nudge for the same target this soon after one was let in is dropped. */
export const NUDGE_MIN_GAP_MS = 10_000;

export interface Nudge {
  /** The target's base URL as the pairing holds it (without trailing slashes). */
  target: string;
  reason: SyncIntentReason;
}

export type NudgeRead = { ok: true; nudge: Nudge } | { ok: false; error: string };

const base = (url: string) => url.replace(/\/+$/, '');

/**
 * What the native service passed on: `{ link, reason }`, the intent's data and its extra, as they came.
 * `unpaired`: a well-formed link to a target this phone isn't paired with.
 */
export function readNudge(data: unknown, pairings: readonly KeyedPairing[]): NudgeRead {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'invalid:data' };
  const { link, reason } = data as { link?: unknown; reason?: unknown };
  const intent = parseSyncIntent(link, reason);
  if (!intent.ok) return intent;
  const target = base(intent.target);
  if (!pairings.some((p) => base(p.base) === target)) return { ok: false, error: 'unpaired' };
  return { ok: true, nudge: { target, reason: intent.reason } };
}

/** Lets one nudge per target through at a time, and not again within `gapMs` of the last one let in. */
export class NudgeGate {
  private readonly running = new Set<string>();
  private readonly last = new Map<string, number>();

  constructor(private readonly gapMs = NUDGE_MIN_GAP_MS) {}

  admit(target: string, now: number): boolean {
    if (this.running.has(target)) return false;
    const at = this.last.get(target);
    if (at !== undefined && now >= at && now - at < this.gapMs) return false;
    this.running.add(target);
    this.last.set(target, now);
    return true;
  }

  done(target: string): void {
    this.running.delete(target);
  }
}

export type NudgeOutcome =
  | { status: 'ran'; runs: { key: string; run: LastRun }[] }
  | { status: 'ignored'; why: string }
  | { status: 'failed'; why: string };

export interface NudgeDeps {
  services: () => Promise<{
    pairings: { list(): readonly KeyedPairing[] };
    runner: { syncAll(reason: SyncIntentReason, only: { target?: string }): Promise<{ key: string; run: LastRun }[]> };
  }>;
  gate: NudgeGate;
  now?: () => number;
  /** Once a sync of the nudge ran (or broke): the over-the-air update (otaUpdate.ts). What it throws changes nothing. */
  afterwards?: () => Promise<unknown>;
}

/**
 * The headless task: read, admit, sync the target's pairings. Never throws - a nudge that can't run is
 * answered with why, for the tests; the target sees the result in its own import.
 */
export async function runNudge(data: unknown, deps: NudgeDeps): Promise<NudgeOutcome> {
  let s: Awaited<ReturnType<NudgeDeps['services']>>;
  try {
    s = await deps.services();
  } catch (e) {
    return { status: 'failed', why: e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error' };
  }
  const read = readNudge(data, s.pairings.list());
  if (!read.ok) return { status: 'ignored', why: read.error };
  const { target, reason } = read.nudge;
  if (!deps.gate.admit(target, (deps.now ?? Date.now)())) return { status: 'ignored', why: 'busy' };
  let out: NudgeOutcome;
  try {
    out = { status: 'ran', runs: await s.runner.syncAll(reason, { target }) };
  } catch (e) {
    // syncAll records every way a run ends; this is only what slipped past (a broken store, say).
    out = { status: 'failed', why: e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error' };
  } finally {
    deps.gate.done(target);
  }
  if (deps.afterwards) {
    try {
      await deps.afterwards();
    } catch {
      // the nudge's answer stands
    }
  }
  return out;
}
