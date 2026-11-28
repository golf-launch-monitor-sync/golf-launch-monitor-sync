// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The first sync after pairing or signing in, while the app is in front (the companion's wizard shows it coming, then
 * offers *Back to …*: the player goes back, the app doesn't jump).
 *
 * On the iPhone an app that goes to the back is suspended within seconds: a first sync left running while the app
 * jumped back to the target got as far as the plan, perhaps one request, and the target saw nothing until the player
 * tapped "fetch now". So the app stays in front (showing that it fetches) until the first sync is through, at most
 * `FIRST_SYNC_MS`. The guard's 40 requests a run, a pause of one to three seconds apart, fit in that.
 */

export const FIRST_SYNC_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * `sync`: the first sync (the plan decides what it brings); one that fails is through too (the step says why).
 * Answers `through`, or `timeout` when it was still running after `maxMs` (it goes on as long as the phone lets it).
 */
export async function firstSync(o: { sync: () => Promise<unknown>; maxMs?: number; wait?: (ms: number) => Promise<void> }): Promise<'through' | 'timeout'> {
  let synced: Promise<'through'>;
  try {
    synced = o
      .sync()
      .catch(() => undefined)
      .then(() => 'through' as const);
  } catch {
    synced = Promise.resolve('through' as const);
  }
  return Promise.race([synced, (o.wait ?? sleep)(o.maxMs ?? FIRST_SYNC_MS).then(() => 'timeout' as const)]);
}
