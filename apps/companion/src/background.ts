// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The sync in the background: Android's WorkManager about every 30 minutes, iOS's BGTaskScheduler as
 * often as iOS wakes the app (nothing is guaranteed there). Each wake only asks: the targets' plans
 * first, the provider only where one says "due", through the same guard as everything else - so a
 * wake every few minutes would cost Trackman nothing more than the plans allow.
 *
 * Defined at the top of index.ts: the system may start the app only to run it.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { services } from './platform';

export const TASK = 'glmsync-sync';
/** Minutes; Android won't go below 15, iOS decides itself. */
const EVERY_MIN = 30;

TaskManager.defineTask(TASK, async () => {
  let stop: { remove(): void } | null = null;
  try {
    const s = await services();
    // iOS ends the task when it likes: what runs is stopped cleanly (the guard's in-flight mark
    // covers a request cut off halfway).
    try {
      stop = BackgroundTask.addExpirationListener(() => s.runner.stop());
    } catch {
      stop = null; // Android has no such listener
    }
    await s.runner.syncAll('timer');
    // One chunk of the older history per wake at most: the target spaces them anyway.
    await s.runner.backfill();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    stop?.remove();
  }
});

/** The task runs while there is something to sync for: registered with the first pairing, gone with the last. */
export async function keepScheduled(wanted: boolean): Promise<void> {
  try {
    const registered = await TaskManager.isTaskRegisteredAsync(TASK);
    if (wanted && !registered) {
      const status = await BackgroundTask.getStatusAsync();
      if (status !== BackgroundTask.BackgroundTaskStatus.Available) return; // switched off for this app: the screen still syncs
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: EVERY_MIN });
    } else if (!wanted && registered) {
      await BackgroundTask.unregisterTaskAsync(TASK);
    }
  } catch {
    // Without the background the app still syncs while it is open and when a target app asks.
  }
}
