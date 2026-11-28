// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the phone's system allows the app, as the spec's `env` (target-api.md, *What a client tells of its system*):
 * from the background task's status (`expo-background-task`), iOS's Background App Refresh and Low Power Mode
 * (`powerOf(...).powerState()`), and whether the app has a push address its targets may wake it at. The app passes
 * `() => systemEnv(...)` to `makeEngine({ env })`. Only what it was told: nothing guessed, never a battery word on
 * Android without a native module that reads it.
 */
import type { Env } from '@glmsync/spec';
import type { PowerState } from './power.ts';

export interface SystemSaid {
  os: string;
  /** `expo-background-task`'s status: whether the system runs the app's task at all; null when unknown. */
  task: 'available' | 'restricted' | null;
  /** iOS's Background App Refresh and Low Power Mode, through `glmsync-power`; null where there is none. */
  power: PowerState | null;
  /** Whether the app holds a push address for a wake; absent when it doesn't keep one. */
  push?: boolean;
}

const REFRESH = new Set(['available', 'denied', 'restricted']);

export function systemEnv(said: SystemSaid): Env {
  const os = said.os === 'ios' || said.os === 'android' ? said.os : 'other';
  const env: Env = { os };
  const refresh = said.power && REFRESH.has(said.power.refresh as string) ? said.power.refresh : null;
  const lowPower = typeof said.power?.lowPower === 'boolean' ? said.power.lowPower : null;
  // The spec's `background`: on iOS Background App Refresh, and Low Power Mode, which stops it whatever the setting.
  if (os === 'ios' && lowPower === true) env.background = 'restricted';
  else if (os === 'ios' && refresh) env.background = refresh;
  else if (said.task === 'available' || said.task === 'restricted') env.background = said.task;
  if (typeof said.push === 'boolean') env.push = said.push ? 'on' : 'off';
  if (lowPower !== null) env.power = lowPower ? 'low' : 'normal';
  return env;
}
