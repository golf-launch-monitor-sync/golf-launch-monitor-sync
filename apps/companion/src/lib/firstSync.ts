// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The first sync after pairing or signing in, and only then the jump back to the target app.
 *
 * On the iPhone an app that goes to the back is suspended within seconds: a first sync left running while the app
 * jumped back to the target got as far as the plan, perhaps one request, and the target saw nothing until the player
 * tapped "fetch now". So the app stays in front (showing that it fetches) until the first sync is through, at most
 * `FIRST_SYNC_MS` or until the player goes back by hand. The guard's 40 requests a run, a pause of one to three seconds
 * apart, fit in that.
 */

export const FIRST_SYNC_MS = 120_000;

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * `sync`: the first sync (the plan decides what it brings); a failed one goes back as well, the target shows why.
 * `back`: where to jump then (already checked against the prefixes the target named), null to stay.
 * Answers `back`, `stayed` (the app to go back to is gone) or `here` (no way back: after the sync).
 */
export async function firstSyncThenBack(o: {
  sync: () => Promise<unknown>;
  back: string | null;
  open: (url: string) => Promise<unknown>;
  skip?: Promise<void>;
  maxMs?: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<'back' | 'stayed' | 'here'> {
  let synced: Promise<unknown>;
  try {
    synced = o.sync().catch(() => undefined);
  } catch {
    synced = Promise.resolve();
  }
  await Promise.race([synced, (o.wait ?? sleep)(o.maxMs ?? FIRST_SYNC_MS), ...(o.skip ? [o.skip] : [])]);
  if (!o.back) return 'here';
  try {
    await o.open(o.back);
    return 'back';
  } catch {
    return 'stayed';
  }
}
