// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The first sync after pairing or signing in, before the jump back: on the iPhone an app that went to the back is
 * suspended within seconds, so a first sync left running there brought nothing until the player tapped "fetch now".
 */
import { describe, expect, it } from 'vitest';
import { FIRST_SYNC_MS, firstSyncThenBack } from './firstSync.ts';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the first sync, then back', () => {
  it('jumps back only once the first sync is through', async () => {
    const sync = deferred();
    const log: string[] = [];
    const out = firstSyncThenBack({
      sync: () => sync.promise.then(() => void log.push('synced')),
      back: 'target://back',
      open: async (url) => void log.push(`open ${url}`),
      wait: () => new Promise(() => undefined),
    });
    await tick();
    expect(log).toEqual([]);
    sync.resolve();
    expect(await out).toBe('back');
    expect(log).toEqual(['synced', 'open target://back']);
  });

  it('jumps back after a failed sync too (the target shows why)', async () => {
    const opened: string[] = [];
    const out = await firstSyncThenBack({
      sync: () => Promise.reject(new Error('offline')),
      back: 'target://back',
      open: async (url) => void opened.push(url),
    });
    expect(out).toBe('back');
    expect(opened).toEqual(['target://back']);
  });

  it('waits at most FIRST_SYNC_MS, then goes back with the sync still running', async () => {
    const waited: number[] = [];
    const out = await firstSyncThenBack({
      sync: () => new Promise(() => undefined),
      back: 'target://back',
      open: async () => undefined,
      wait: async (ms) => void waited.push(ms),
    });
    expect(out).toBe('back');
    expect(waited).toEqual([FIRST_SYNC_MS]);
  });

  it('goes back at once when the player says so', async () => {
    const skip = deferred();
    const out = firstSyncThenBack({
      sync: () => new Promise(() => undefined),
      back: 'target://back',
      open: async () => undefined,
      skip: skip.promise,
      wait: () => new Promise(() => undefined),
    });
    skip.resolve();
    expect(await out).toBe('back');
  });

  it('stays when the app to go back to is gone, and without a way back waits for the sync alone', async () => {
    expect(await firstSyncThenBack({ sync: async () => undefined, back: 'target://back', open: () => Promise.reject(new Error('gone')) })).toBe('stayed');
    const sync = deferred();
    let done = false;
    const out = firstSyncThenBack({ sync: () => sync.promise, back: null, open: async () => undefined }).then((r) => {
      done = true;
      return r;
    });
    await tick();
    expect(done).toBe(false);
    sync.resolve();
    expect(await out).toBe('here');
  });
});
