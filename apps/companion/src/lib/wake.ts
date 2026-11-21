// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The wake (spec/wake.md, since spec 1.9.0), the part without a phone. On iOS the system wakes this app
 * when it likes, and the older history stands still while the app isn't in front; a target that can push
 * to this phone may wake it when a plan is due, with a silent push that says only "ask for the plan".
 *
 * - Registering: each pairing's target hears this phone's push address (`PUT /wake`), again when the
 *   address changes and now and then (a target may have forgotten it). A target without a wake answers
 *   404 and is left be for a week. Nothing here throws: what went wrong is kept for the screen and the
 *   next try.
 * - A wake: read strictly (nothing in a push is followed but "it is one"), at most one run per wake and
 *   not again within five minutes, then exactly what the background timer does - the plans first,
 *   through the same runner, queue and guard. A wake can't make this app fetch more than a plan allows.
 */

import { readJson, TargetError, type Storage } from '@glmsync/core';
import { isWake, readWake, type Reason, type WakeRegistration } from '@glmsync/spec';
import type { KeyedPairing } from './pairings.ts';

/** The name the task for a push is registered under (expo-notifications runs it for a push in the background). */
export const WAKE_TASK = 'glmsync-wake';
/** A wake this soon after the last one that ran is dropped (pushes can come twice). */
export const WAKE_RUN_GAP_MS = 5 * 60_000;
const DAY_MS = 86_400_000;
/** A registration a target kept is sent again after this long: it may have forgotten it. */
export const WAKE_REFRESH_MS = 7 * DAY_MS;
/** A target that offers no wake is asked again after this long (it may have got one since). */
export const WAKE_NONE_RETRY_MS = 7 * DAY_MS;
/** A registration that failed is tried again at the next chance after this long. */
export const WAKE_FAIL_RETRY_MS = 15 * 60_000;

const STATE = 'glmsync/companion/wake';
const LAST_RUN = 'glmsync/companion/wake-run';
/** A push's data is small (4 KiB at most); a longer string inside it is no wake's. */
const MAX_TEXT = 4096;

export type WakeStatus = 'kept' | 'none' | 'failed';

export interface WakeEntry {
  address: string;
  at: number;
  status: WakeStatus;
  /** A failure's kind (a target error code, or the error's name); never a message from outside. */
  error?: string;
}

const errorKind = (e: unknown) =>
  e instanceof TargetError ? e.code : e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error';

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function parsed(v: unknown): unknown {
  if (typeof v !== 'string' || v.length > MAX_TEXT) return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}

/**
 * Whether a push, as expo-notifications hands it to the background task, is a wake. Where the push's data
 * sits differs by platform and version (the payload itself, `data`, `data.body` - on iOS the push
 * service's data, sometimes as text - `data.dataString` on Android, or a notification's content), so each
 * of those places is looked at; the data itself is read by the spec's rule only.
 */
export function isWakePush(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const data = parsed(payload.data);
  const places: unknown[] = [payload, data];
  if (isRecord(data)) places.push(parsed(data.body), parsed(data.dataString));
  places.push(parsed(payload.body));
  const content = (x: unknown) => (isRecord(x) && isRecord(x.request) && isRecord(x.request.content) ? x.request.content.data : undefined);
  places.push(content(payload), isRecord(payload.notification) ? content(payload.notification) : undefined);
  return places.some((p) => isWake(p));
}

/** One wake run at a time, and none within WAKE_RUN_GAP_MS of the last one let in - also across starts. */
export class WakeGate {
  private running = false;

  constructor(
    private readonly storage: Storage,
    private readonly gapMs = WAKE_RUN_GAP_MS,
  ) {}

  async admit(now: number): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      let last: unknown = null;
      try {
        last = await readJson(this.storage, LAST_RUN);
      } catch {
        last = null; // nothing readable kept: let it in, the plans and the guard decide the rest
      }
      if (typeof last === 'number' && now >= last && now - last < this.gapMs) {
        this.running = false;
        return false;
      }
      try {
        await this.storage.set(LAST_RUN, JSON.stringify(now));
      } catch {
        // kept in memory only: the run goes ahead
      }
      return true;
    } catch {
      this.running = false;
      return false;
    }
  }

  done(): void {
    this.running = false;
  }
}

export type WakeOutcome = { status: 'ran' } | { status: 'ignored'; why: string } | { status: 'failed'; why: string };

export interface WakeDeps {
  services: () => Promise<{ runner: { syncAll(reason: Reason): Promise<unknown>; backfill(): Promise<unknown> } }>;
  gate: WakeGate;
  now?: () => number;
}

/** The task for a push: is it a wake, may it run, then what the timer does. Never throws. */
export async function runWake(payload: unknown, deps: WakeDeps): Promise<WakeOutcome> {
  if (!isWakePush(payload)) return { status: 'ignored', why: 'not_a_wake' };
  if (!(await deps.gate.admit((deps.now ?? Date.now)()))) return { status: 'ignored', why: 'busy' };
  try {
    const s = await deps.services();
    // A wake is the regular look arriving on time (spec/wake.md): reason `timer`, then one history chunk.
    await s.runner.syncAll('timer');
    await s.runner.backfill();
    return { status: 'ran' };
  } catch (e) {
    // The runner records every way a run ends; this is only what slipped past (a broken store, say).
    return { status: 'failed', why: errorKind(e) };
  } finally {
    deps.gate.done();
  }
}

export interface WakeTarget {
  wake(registration: WakeRegistration): Promise<boolean>;
}

export interface WakesOptions {
  storage: Storage;
  pairings: { list(): readonly KeyedPairing[] };
  target: (p: KeyedPairing) => WakeTarget;
  now?: () => number;
}

function readState(v: unknown): Record<string, WakeEntry> {
  if (!isRecord(v)) return {};
  const out: Record<string, WakeEntry> = {};
  for (const [k, e] of Object.entries(v)) {
    if (!isRecord(e) || typeof e.address !== 'string' || typeof e.at !== 'number') continue;
    if (e.status !== 'kept' && e.status !== 'none' && e.status !== 'failed') continue;
    out[k] = { address: e.address, at: e.at, status: e.status, ...(typeof e.error === 'string' ? { error: e.error } : {}) };
  }
  return out;
}

/** This phone's push address at each pairing's target. */
export class Wakes {
  private readonly now: () => number;
  private state: Record<string, WakeEntry> = {};
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: WakesOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** What each pairing's target last heard (for the screen and the tests). */
  entry(key: string): WakeEntry | null {
    return this.state[key] ?? null;
  }

  private due(e: WakeEntry | undefined, address: string, now: number): boolean {
    if (!e || e.address !== address || now < e.at) return true;
    const wait = e.status === 'kept' ? WAKE_REFRESH_MS : e.status === 'none' ? WAKE_NONE_RETRY_MS : WAKE_FAIL_RETRY_MS;
    return now - e.at >= wait;
  }

  /**
   * Tell each pairing's target the address, where it is due. `null`: this phone has no address now (no
   * push on this platform, or the system gave none) - nothing is sent, and what targets heard stays.
   * One call at a time; never throws.
   */
  keep(address: string | null): Promise<void> {
    const run = async () => {
      try {
        this.state = readState(await readJson(this.opts.storage, STATE));
      } catch {
        this.state = {}; // unreadable: every target hears it again, which costs a request each
      }
      const pairings = this.opts.pairings.list();
      const keys = new Set(pairings.map((p) => p.key));
      for (const k of Object.keys(this.state)) if (!keys.has(k)) delete this.state[k];
      const reg = address === null ? null : readWake({ service: 'expo', address });
      if (reg) {
        for (const p of pairings) {
          const now = this.now();
          if (!this.due(this.state[p.key], reg.address, now)) continue;
          let entry: WakeEntry;
          try {
            entry = { address: reg.address, at: now, status: (await this.opts.target(p).wake(reg)) ? 'kept' : 'none' };
          } catch (e) {
            // The target having a moment, a revoked token (the next sync ends that pairing): tried again later.
            entry = { address: reg.address, at: now, status: 'failed', error: errorKind(e) };
          }
          this.state[p.key] = entry;
        }
      }
      try {
        await this.opts.storage.set(STATE, JSON.stringify(this.state));
      } catch {
        // kept in memory: the next start asks again
      }
    };
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => undefined);
    return next;
  }
}
