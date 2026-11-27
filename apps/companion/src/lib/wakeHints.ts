// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What keeps iOS from waking this app (spec/wake.md), said on the iPhone in one sentence - the part without a phone.
 *
 * iOS delivers no silent push to an app whose *Background App Refresh* is off (the app's own switch, or the one for
 * all apps), restricted (Screen Time, a managed phone), or while Low Power Mode is on; nor to an app swiped away in
 * the app switcher, until it is opened again. The first three the phone can tell (`modules/glmsync-power`); the
 * last it can't, so that is said once, as a hint, after the first pairing.
 *
 * The cause's sentence closes with ×; closed, it stays away a day, then comes back while the cause stays. Another
 * cause is said at once, and once all is well the closing is forgotten. Nothing of this goes to a target (the spec
 * has no field for it, and a target can't change it). Nothing here throws: storage failing still says the cause,
 * and a closing then holds while the app runs.
 */

import type { Storage } from '@glmsync/core';

export type Refresh = 'available' | 'denied' | 'restricted';
export interface PowerState {
  /** iOS's `backgroundRefreshStatus` for this app; null when unknown. */
  refresh: Refresh | null;
  /** Low Power Mode; null when unknown. */
  lowPower: boolean | null;
}
export type Block = 'refresh_off' | 'refresh_restricted' | 'low_power';
export interface WakeHintView {
  block: Block | null;
  swipe: boolean;
}

/** A closed cause comes back after this long while it stays. */
export const BLOCK_AGAIN_MS = 86_400_000;

const CLOSED = 'glmsync/companion/wake-hint';
const SWIPE = 'glmsync/companion/wake-swipe-hint';
const REFRESH: readonly Refresh[] = ['available', 'denied', 'restricted'];
const BLOCKS: readonly Block[] = ['refresh_off', 'refresh_restricted', 'low_power'];

interface Closed {
  block: Block;
  at: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The native module's answer, taken value by value: anything else is unknown. */
export function readPowerState(raw: unknown): PowerState | null {
  if (!isRecord(raw)) return null;
  const refresh = REFRESH.includes(raw.refresh as Refresh) ? (raw.refresh as Refresh) : null;
  const lowPower = typeof raw.lowPower === 'boolean' ? raw.lowPower : null;
  return { refresh, lowPower };
}

/**
 * Why iOS won't wake the app, or null. Only on the iPhone, only with a pairing to wake for. Low Power Mode first: it
 * turns background refresh off for every app, so the app's own switch is not the way then.
 */
export function blockOf(os: string, paired: boolean, state: PowerState | null): Block | null {
  if (os !== 'ios' || !paired || !state) return null;
  if (state.lowPower === true) return 'low_power';
  if (state.refresh === 'denied') return 'refresh_off';
  if (state.refresh === 'restricted') return 'refresh_restricted';
  return null;
}

/** Whether the cause's sentence shows, and whether a closing is to be forgotten (all is well again). */
export function blockLine(block: Block | null, closed: Closed | null, now: number): { show: Block | null; forget: boolean } {
  if (!block) return { show: null, forget: !!closed };
  const hidden = !!closed && closed.block === block && now - closed.at < BLOCK_AGAIN_MS && now >= closed.at;
  return { show: hidden ? null : block, forget: false };
}

/** The hint not to swipe the app away: on the iPhone, once there is a pairing, until it is closed. */
export function swipeShown(os: string, paired: boolean, closed: boolean): boolean {
  return os === 'ios' && paired && !closed;
}

/** The text key of a cause's sentence. */
export function wakeHintKey(block: Block): 'wakeHint.refreshOff' | 'wakeHint.refreshRestricted' | 'wakeHint.lowPower' {
  return block === 'refresh_off' ? 'wakeHint.refreshOff' : block === 'refresh_restricted' ? 'wakeHint.refreshRestricted' : 'wakeHint.lowPower';
}

function parseClosed(raw: string | null): Closed | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v) || !BLOCKS.includes(v.block as Block) || typeof v.at !== 'number' || !Number.isFinite(v.at)) return null;
    return { block: v.block as Block, at: v.at };
  } catch {
    return null;
  }
}

async function quietly<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** The two hints with their closing, kept in the phone's storage (and in memory, should storage fail). */
export class WakeHints {
  private closed: Closed | null | undefined;
  private swipeClosed: boolean | undefined;

  constructor(
    private readonly storage: Storage,
    private readonly now: () => number = Date.now,
  ) {}

  async view(os: string, paired: boolean, state: PowerState | null): Promise<WakeHintView> {
    if (this.closed === undefined) this.closed = parseClosed(await quietly(() => this.storage.get(CLOSED), null));
    if (this.swipeClosed === undefined) this.swipeClosed = (await quietly(() => this.storage.get(SWIPE), null)) === 'closed';
    const line = blockLine(blockOf(os, paired, state), this.closed, this.now());
    if (line.forget) {
      this.closed = null;
      await quietly(() => this.storage.remove(CLOSED), undefined);
    }
    return { block: line.show, swipe: swipeShown(os, paired, this.swipeClosed) };
  }

  async closeBlock(block: Block): Promise<void> {
    this.closed = { block, at: this.now() };
    await quietly(() => this.storage.set(CLOSED, JSON.stringify(this.closed)), undefined);
  }

  async closeSwipe(): Promise<void> {
    this.swipeClosed = true;
    await quietly(() => this.storage.set(SWIPE, 'closed'), undefined);
  }
}
