// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The over-the-air update after a background run and after a target's nudge (the rules in src/lib/otaUpdate.ts): checked
 * at most every six hours, downloaded for the next start, never applied here. Never throws.
 *
 * And *Update now* (SR-8b, src/lib/outdated.ts), when a target said it needs a newer version: in the foreground, at the
 * player's tap, downloaded and applied at once, else the new build.
 */

import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { fetchUpdateQuietly, type UpdateOutcome } from './lib/otaUpdate';
import { updateNow, type UpdateNow } from './lib/outdated';
import { storage } from './platform';

export function quietUpdate(signal?: AbortSignal): Promise<UpdateOutcome> {
  return fetchUpdateQuietly({
    updates: {
      isEnabled: Updates.isEnabled,
      checkForUpdateAsync: () => Updates.checkForUpdateAsync(),
      fetchUpdateAsync: () => Updates.fetchUpdateAsync(),
    },
    storage,
    now: Date.now,
    ...(signal ? { signal } : {}),
  });
}

export function updateNowHere(): Promise<UpdateNow> {
  return updateNow({
    updates: {
      isEnabled: Updates.isEnabled,
      checkForUpdateAsync: () => Updates.checkForUpdateAsync(),
      fetchUpdateAsync: () => Updates.fetchUpdateAsync(),
      reloadAsync: () => Updates.reloadAsync(),
    },
    platform: Platform.OS,
    runtime: Updates.runtimeVersion,
  });
}
