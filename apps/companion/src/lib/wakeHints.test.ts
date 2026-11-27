// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** What keeps iOS from waking the app, said in one closable sentence; and the hint not to swipe it away. */

import type { Storage } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import { blockLine, blockOf, BLOCK_AGAIN_MS, readPowerState, swipeShown, WakeHints, wakeHintKey } from './wakeHints.ts';

function memory(fail = false): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => {
      if (fail) throw new Error('storage');
      return data.get(k) ?? null;
    },
    set: async (k, v) => {
      if (fail) throw new Error('storage');
      data.set(k, v);
    },
    remove: async (k) => {
      if (fail) throw new Error('storage');
      data.delete(k);
    },
  };
}

const ON = { refresh: 'available', lowPower: false } as const;

describe('readPowerState', () => {
  it('takes only the values the module can answer', () => {
    expect(readPowerState({ refresh: 'denied', lowPower: false })).toEqual({ refresh: 'denied', lowPower: false });
    expect(readPowerState({ refresh: 'restricted', lowPower: true })).toEqual({ refresh: 'restricted', lowPower: true });
    expect(readPowerState({ refresh: 'something', lowPower: 'yes' })).toEqual({ refresh: null, lowPower: null });
    expect(readPowerState(null)).toBeNull();
    expect(readPowerState('denied')).toBeNull();
  });
});

describe('blockOf', () => {
  it('iPhone: background refresh off, restricted, or Low Power Mode', () => {
    expect(blockOf('ios', true, { refresh: 'denied', lowPower: false })).toBe('refresh_off');
    expect(blockOf('ios', true, { refresh: 'restricted', lowPower: false })).toBe('refresh_restricted');
    expect(blockOf('ios', true, { refresh: 'available', lowPower: true })).toBe('low_power');
  });

  it('Low Power Mode first: it switches background refresh off for every app, the app\'s own switch is not the way', () => {
    expect(blockOf('ios', true, { refresh: 'denied', lowPower: true })).toBe('low_power');
  });

  it('nothing when all is well, unknown, on Android, or without a pairing to wake for', () => {
    expect(blockOf('ios', true, ON)).toBeNull();
    expect(blockOf('ios', true, null)).toBeNull();
    expect(blockOf('ios', true, { refresh: null, lowPower: null })).toBeNull();
    expect(blockOf('android', true, { refresh: 'denied', lowPower: true })).toBeNull();
    expect(blockOf('ios', false, { refresh: 'denied', lowPower: false })).toBeNull();
  });
});

describe('blockLine', () => {
  const now = 1_800_000_000_000;

  it('closed, it stays away a day, then comes back while it stays so', () => {
    const closed = { block: 'refresh_off', at: now } as const;
    expect(blockLine('refresh_off', closed, now + 60_000)).toEqual({ show: null, forget: false });
    expect(blockLine('refresh_off', closed, now + BLOCK_AGAIN_MS)).toEqual({ show: 'refresh_off', forget: false });
  });

  it('another cause is said at once', () => {
    expect(blockLine('low_power', { block: 'refresh_off', at: now }, now + 1)).toEqual({ show: 'low_power', forget: false });
  });

  it('once all is well the closing is forgotten, so the cause coming back is said again', () => {
    expect(blockLine(null, { block: 'refresh_off', at: now }, now + 1)).toEqual({ show: null, forget: true });
    expect(blockLine(null, null, now)).toEqual({ show: null, forget: false });
    expect(blockLine('refresh_off', null, now)).toEqual({ show: 'refresh_off', forget: false });
  });
});

describe('swipeShown', () => {
  it('on the iPhone once there is a pairing, until closed', () => {
    expect(swipeShown('ios', true, false)).toBe(true);
    expect(swipeShown('ios', true, true)).toBe(false);
    expect(swipeShown('ios', false, false)).toBe(false);
    expect(swipeShown('android', true, false)).toBe(false);
  });
});

describe('wakeHintKey', () => {
  it('a sentence per cause', () => {
    expect(wakeHintKey('refresh_off')).toBe('wakeHint.refreshOff');
    expect(wakeHintKey('refresh_restricted')).toBe('wakeHint.refreshRestricted');
    expect(wakeHintKey('low_power')).toBe('wakeHint.lowPower');
  });
});

describe('WakeHints', () => {
  it('says the cause and the swipe hint, and keeps their closing on the phone', async () => {
    let now = 1_800_000_000_000;
    const store = memory();
    const hints = new WakeHints(store, () => now);
    const off = { refresh: 'denied', lowPower: false } as const;
    expect(await hints.view('ios', true, off)).toEqual({ block: 'refresh_off', swipe: true });
    await hints.closeBlock('refresh_off');
    await hints.closeSwipe();
    expect(await hints.view('ios', true, off)).toEqual({ block: null, swipe: false });
    // Another instance reads the same storage (the app started again).
    const again = new WakeHints(store, () => now);
    now += BLOCK_AGAIN_MS;
    expect(await again.view('ios', true, off)).toEqual({ block: 'refresh_off', swipe: false });
  });

  it('forgets the closing once all is well', async () => {
    const now = 1_800_000_000_000;
    const store = memory();
    const hints = new WakeHints(store, () => now);
    await hints.closeBlock('low_power');
    await hints.view('ios', true, ON);
    expect(await hints.view('ios', true, { refresh: 'available', lowPower: true })).toEqual({ block: 'low_power', swipe: true });
  });

  it('a stored value it can\'t read counts as not closed', async () => {
    const store = memory();
    store.data.set('glmsync/companion/wake-hint', '{not json');
    const hints = new WakeHints(store, () => 1);
    expect(await hints.view('ios', true, { refresh: 'denied', lowPower: false })).toEqual({ block: 'refresh_off', swipe: true });
  });

  it('never throws: storage failing still says the cause, and a closing holds while the app runs', async () => {
    const hints = new WakeHints(memory(true), () => 1);
    const off = { refresh: 'denied', lowPower: false } as const;
    expect(await hints.view('ios', true, off)).toEqual({ block: 'refresh_off', swipe: true });
    await expect(hints.closeBlock('refresh_off')).resolves.toBeUndefined();
    await expect(hints.closeSwipe()).resolves.toBeUndefined();
    expect(await hints.view('ios', true, off)).toEqual({ block: null, swipe: false });
  });
});
