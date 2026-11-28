// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * SR-8b: a target whose plan says it needs a newer version of this app (spec 1.22.0, the plan's `outdated`). The engine
 * keeps it as a run of its own (`status: 'outdated'`, with the version it was said of); here is what follows from it:
 * whether it still holds (only while that version runs), what the sync link's way back tells the target (`result`),
 * and *Update now* - an over-the-air update downloaded and applied at once (in the foreground a restart is safe, unlike
 * in the background: otaUpdate.ts), else the new build (the APK, TestFlight: newBuild.ts), else that nothing newer is
 * out yet. Pure, or with what it needs passed in, so it is tested without a phone.
 */

import type { LastRun } from '@glmsync/engine';
import { withResult, type SyncResult } from '@glmsync/spec';
import { checkNewBuild } from './newBuild.ts';

/** A run the target called too old, while the version it said it of still runs (one kept without a version: until the next plan). */
export function isOutdated(run: LastRun | null | undefined, version: string): boolean {
  return run?.status === 'outdated' && (!run.version || run.version === version);
}

/** The apps that need the newer version, each once. */
export function outdatedTargets(pairings: readonly { key: string; target: { name: string } }[], lastRun: (key: string) => LastRun | null, version: string): string[] {
  return [...new Set(pairings.filter((p) => isOutdated(lastRun(p.key), version)).map((p) => p.target.name))];
}

/** One run as the spec's results name it (deep-links.md, *The result in the way back*). */
function resultOf(run: LastRun): SyncResult {
  switch (run.status) {
    case 'outdated':
      return 'outdated';
    case 'synced': {
      const r = run.result;
      if (r && r.sessions + r.rounds + r.round_shots > 0) return 'new';
      if (run.notice === 'auth_expired') return 'signin';
      // The guard or the provider's pause held it back.
      if (run.notice === 'guard_limit' || run.notice === 'provider_unavailable' || run.notice === 'provider_blocked') return 'not_due';
      return 'nothing';
    }
    case 'not_due':
    case 'busy':
      return 'not_due';
    case 'signed_out':
    case 'other_account':
      return 'signin';
    default:
      return 'failed';
  }
}

/** What the player has to do comes first: an update, then a sign-in, then what failed; then what came. */
const RANK: readonly SyncResult[] = ['outdated', 'signin', 'failed', 'new', 'nothing', 'not_due'];

/** What a sync link's runs came to, for its way back; null when nothing ran (then the way back carries no result). */
export function syncResult(runs: readonly { run: LastRun }[]): SyncResult | null {
  const got = new Set(runs.map((r) => resultOf(r.run)));
  return RANK.find((r) => got.has(r)) ?? null;
}

/**
 * The sync link's way back with its result (`back` already checked against the target's prefixes): an address the
 * result would make too long, or no result, goes as it was.
 */
export function wayBack(back: string, runs: readonly { run: LastRun }[]): string {
  const result = syncResult(runs);
  return (result && withResult(back, result)) || back;
}

/** What of `expo-updates` *Update now* needs: in the foreground it may restart. */
export interface ForegroundUpdates {
  /** False in a development build, Expo Go or a build without an update server. */
  readonly isEnabled: boolean;
  checkForUpdateAsync(): Promise<{ isAvailable: boolean }>;
  fetchUpdateAsync(): Promise<{ isNew: boolean }>;
  reloadAsync(): Promise<void>;
}

export interface UpdateNowDeps {
  updates: ForegroundUpdates;
  platform: string;
  /** The running build's runtime (`Updates.runtimeVersion`). */
  runtime: string | null | undefined;
  fetch?: typeof fetch;
}

export type UpdateNow =
  /** Downloaded, the app restarts with it now. */
  | { step: 'reloading' }
  /** Downloaded, but the restart was refused: it applies at the next start. */
  | { step: 'next_start' }
  /** A new native build is out (its native part changed): this address gets it (the APK, TestFlight). */
  | { step: 'build'; url: string }
  /** Nothing newer is out yet (the target is ahead of the releases). */
  | { step: 'latest' }
  /** The update server and the releases both out of reach: try again. */
  | { step: 'failed' };

/** The button: never throws. Not held back by the background's six hours - the player asked. */
export async function updateNow(deps: UpdateNowDeps): Promise<UpdateNow> {
  let reached = !deps.updates.isEnabled; // without an update server there is nothing to reach
  if (deps.updates.isEnabled) {
    try {
      const found = await deps.updates.checkForUpdateAsync();
      reached = true;
      if (found?.isAvailable === true) {
        await deps.updates.fetchUpdateAsync();
        try {
          await deps.updates.reloadAsync();
          return { step: 'reloading' };
        } catch {
          return { step: 'next_start' };
        }
      }
    } catch {
      // Out of reach, or the download broke (not "nothing newer"): perhaps a new build is known.
      reached = false;
    }
  }
  const build = await checkNewBuild(deps.platform, deps.runtime, deps.fetch ?? fetch);
  if (build) return { step: 'build', url: build.url };
  return reached ? { step: 'latest' } : { step: 'failed' };
}
