// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The first sync after pairing or signing in, while the app stays in front: on the iPhone an app that went to the back
 * is suspended within seconds, so a first sync left running there brought nothing until the player tapped "fetch now".
 */
import { describe, expect, it } from 'vitest';
import { FIRST_SYNC_MS, firstSync } from './firstSync.ts';

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('the first sync', () => {
  it('is through once the sync is', async () => {
    const sync = deferred();
    let done = false;
    const out = firstSync({ sync: () => sync.promise, wait: () => new Promise(() => undefined) }).then((r) => {
      done = true;
      return r;
    });
    await tick();
    expect(done).toBe(false);
    sync.resolve();
    expect(await out).toBe('through');
  });

  it('a failed sync is through too (the step says why), also one that throws at once', async () => {
    expect(await firstSync({ sync: () => Promise.reject(new Error('offline')) })).toBe('through');
    expect(
      await firstSync({
        sync: () => {
          throw new Error('broken');
        },
      }),
    ).toBe('through');
  });

  it('waits at most FIRST_SYNC_MS', async () => {
    const waited: number[] = [];
    const out = await firstSync({ sync: () => new Promise(() => undefined), wait: async (ms) => void waited.push(ms) });
    expect(out).toBe('timeout');
    expect(waited).toEqual([FIRST_SYNC_MS]);
  });
});
