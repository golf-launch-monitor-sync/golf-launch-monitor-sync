// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The over-the-air update after a background run and after a target's nudge (the rules in src/lib/otaUpdate.ts): checked
 * at most every six hours, downloaded for the next start, never applied here. Never throws.
 */

import * as Updates from 'expo-updates';
import { fetchUpdateQuietly, type UpdateOutcome } from './lib/otaUpdate';
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
