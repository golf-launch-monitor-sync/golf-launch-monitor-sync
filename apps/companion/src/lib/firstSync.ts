// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The wizard's last step after the first sync (the sync itself and how long the app stays in front for it:
 * `firstSync` of @glmsync/engine): *Back to …* - the player goes back, the app doesn't jump.
 */

/**
 * *Back to …*: the address the target named for it (already checked against its prefixes). `stayed` when the app to go
 * back to is gone.
 */
export async function goBack(url: string, open: (url: string) => Promise<unknown>): Promise<'back' | 'stayed'> {
  try {
    await open(url);
    return 'back';
  } catch {
    return 'stayed';
  }
}
