// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The wake on the phone (spec/wake.md; the rules in src/lib/wake.ts). iOS only: there the system wakes
 * the app when it likes, and a target that can push to it may wake it when a plan is due. Android has its
 * timer every half hour and the sync service a target app binds to, so it registers no address.
 *
 * The task is defined at the top of index.ts, like the background task: iOS may start the app only to
 * run it. A silent push needs no permission to show notifications - this app shows none - so none is
 * asked for.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import type { Services } from './lib/services';
import { runWake, WAKE_TASK, WakeGate } from './lib/wake';
import { services, storage } from './platform';

const gate = new WakeGate(storage);

TaskManager.defineTask(WAKE_TASK, async ({ data, error }) => {
  if (error) return Notifications.BackgroundNotificationTaskResult.Failed;
  const out = await runWake(data, { services, gate });
  if (out.status === 'failed') return Notifications.BackgroundNotificationTaskResult.Failed;
  return out.status === 'ran' ? Notifications.BackgroundNotificationTaskResult.NewData : Notifications.BackgroundNotificationTaskResult.NoData;
});

if (Platform.OS === 'ios') {
  Notifications.registerTaskAsync(WAKE_TASK).catch(() => {
    // Without the task a push is simply not acted on; the timer and the screen still sync.
  });
}

/**
 * Tell each paired target this phone's push address (where it is due; src/lib/wake.ts decides). Called when
 * the pairings change and when the app comes to the front. Never throws.
 */
export async function keepWake(svc: Services): Promise<void> {
  if (Platform.OS !== 'ios' || !svc.pairings.list().length) return;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined)?.eas?.projectId;
  if (typeof projectId !== 'string' || !projectId) return; // a fork without an EAS project has no push address
  let address: string | null = null;
  try {
    address = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    address = null; // no address now (no network, push not set up for this build): nothing is sent
  }
  await svc.wakes.keep(address).catch(() => undefined);
}
