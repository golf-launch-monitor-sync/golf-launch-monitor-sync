// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Over-the-air updates in the background. The app checks for one when it starts (`checkAutomatically: 'ON_LOAD'`), and a
 * downloaded one applies at the next start - so a player who never opens the app would run an old version for weeks,
 * and a target that needs a newer one (`outdated`, spec 1.22.0) would get nothing from it meanwhile. Expo documents
 * checking and downloading inside a background task (`expo-background-task`) with the same calls as in the foreground,
 * and calls the download there safe; reloading there it calls experimental, so this never reloads (the API below has no
 * `reloadAsync` to call): the update applies at the next start, whether the system's or the player's.
 *
 * Run after the background task's sync and after a target's nudge, never before them (the sync is what the time is
 * for), at most every UPDATE_EVERY_MS. A new native version (an APK, TestFlight) can't come this way; the home screen's
 * notice says that one (newBuild.ts).
 */

import type { Storage } from '@glmsync/core';

/** At most this often: the update server is asked once in six hours, whatever the last answer. */
export const UPDATE_EVERY_MS = 6 * 3_600_000;
export const UPDATE_CHECK_KEY = 'glmsync/companion/update-check';

/** What of `expo-updates` this needs - and nothing that reloads. */
export interface UpdatesApi {
  /** False in a development build, Expo Go or a build without an update server. */
  readonly isEnabled: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew: boolean }>;
}

export type UpdateOutcome = 'off' | 'recent' | 'expired' | 'none' | 'fetched' | 'failed';

export interface UpdateDeps {
  updates: UpdatesApi;
  storage: Storage;
  now: () => number;
  /** Goes when the system ends the background time: no download starts after it. */
  signal?: AbortSignal;
  everyMs?: number;
}

async function lastCheck(storage: Storage): Promise<number | null> {
  try {
    const v = Number(await storage.get(UPDATE_CHECK_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Check, and download what is there for the next start. Never throws, never reloads; says what it did. */
export async function fetchUpdateQuietly(deps: UpdateDeps): Promise<UpdateOutcome> {
  try {
    if (!deps.updates.isEnabled) return 'off';
    if (deps.signal?.aborted) return 'expired';
    const now = deps.now();
    const last = await lastCheck(deps.storage);
    // A clock set back is no reason to wait.
    if (last !== null && last <= now && now - last < (deps.everyMs ?? UPDATE_EVERY_MS)) return 'recent';
    const found = await deps.updates.checkForUpdateAsync();
    // Only an answer counts as asked: an update server out of reach is asked again at the next run.
    try {
      await deps.storage.set(UPDATE_CHECK_KEY, String(now));
    } catch {
      // the next run asks again: no harm
    }
    if (!found || found.isAvailable !== true) return 'none';
    if (deps.signal?.aborted) return 'expired';
    await deps.updates.fetchUpdateAsync();
    return 'fetched';
  } catch {
    return 'failed';
  }
}
