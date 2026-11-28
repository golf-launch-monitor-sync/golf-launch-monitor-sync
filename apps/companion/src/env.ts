// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What this phone's system allows the app, told to each target with every plan and status (spec `env`; the mapping in
 * @glmsync/engine's env.ts): the background task's status, iOS's Background App Refresh and Low Power Mode
 * (modules/glmsync-power, src/power.ts), and on Android that the app keeps no push address (it is woken by its timer
 * and the target app's nudge). On iOS whether a push address is kept differs per pairing, so it says nothing of it.
 * Never throws: what can't be read is left out.
 */

import { systemEnv } from '@glmsync/engine';
import type { Env } from '@glmsync/spec';
import * as BackgroundTask from 'expo-background-task';
import { Platform } from 'react-native';
import { powerState } from './power';

export async function phoneEnv(): Promise<Env> {
  let task: 'available' | 'restricted' | null = null;
  try {
    task = (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available ? 'available' : 'restricted';
  } catch {
    task = null;
  }
  return systemEnv({ os: Platform.OS, task, power: await powerState(), ...(Platform.OS === 'android' ? { push: false } : {}) });
}
