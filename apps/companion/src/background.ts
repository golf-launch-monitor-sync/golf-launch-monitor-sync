// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The sync in the background: Android's WorkManager about every 30 minutes, iOS's BGTaskScheduler as
 * often as iOS starts the app (nothing is guaranteed there). Each run only asks: the targets' plans
 * first, the provider only where one says "due", through the same guard as everything else - so a
 * run every few minutes would cost Trackman nothing more than the plans allow.
 *
 * On the iPhone the task is a `BGProcessingTask` (`expo-background-task`), which iOS gives minutes, mostly while the
 * phone charges at night: there the older history goes on chunk after chunk until it is through, the time is up or iOS
 * ends it (src/lib/longRun.ts has the rules). On Android one chunk per run.
 *
 * Defined at the top of index.ts: the system may start the app only to run it.
 */

import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { AppState, Platform } from 'react-native';
import { backgroundWork, pauseFor } from './lib/longRun';
import { services } from './platform';
import { onTaskExpired } from './power';

export const TASK = 'glmsync-sync';
/** Minutes; Android won't go below 15, iOS decides itself. */
const EVERY_MIN = 30;

TaskManager.defineTask(TASK, async () => {
  const ended = new AbortController();
  const end = () => ended.abort();
  const listeners: { remove(): void }[] = [];
  try {
    // iOS ends the task when it likes. `expo-background-task`'s own listener doesn't hear it in this SDK (its module drops
    // the notification), modules/glmsync-power does; both stop the run the same way, whichever speaks.
    try {
      listeners.push(BackgroundTask.addExpirationListener(end));
    } catch {
      // Android has no such listener
    }
    const own = onTaskExpired(end);
    if (own) listeners.push(own);
    const s = await services();
    const run = await backgroundWork({
      os: Platform.OS === 'ios' ? 'ios' : 'android',
      runner: s.runner,
      now: Date.now,
      sleep: pauseFor,
      signal: ended.signal,
      inFront: () => AppState.currentState === 'active',
    });
    await s.background.add(run);
    return run.ended === 'failed' ? BackgroundTask.BackgroundTaskResult.Failed : BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  } finally {
    for (const l of listeners) {
      try {
        l.remove();
      } catch {
        // gone already
      }
    }
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
