// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the iPhone says about waking this app: its *Background App Refresh* and Low Power Mode
 * (modules/glmsync-power; the rules in src/lib/wakeHints.ts). `expo-background-task`'s status can't tell: on a
 * phone it answers *available* whatever the switch says.
 *
 * A build without the module (older ones, Android, a development build in Expo Go) answers null: then nothing is said.
 */

import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { readPowerState, type PowerState } from './lib/wakeHints';

interface PowerModule {
  getStateAsync(): Promise<unknown>;
}

const native: PowerModule | null = Platform.OS === 'ios' ? requireOptionalNativeModule<PowerModule>('GlmsyncPower') : null;

/** The phone's state now, or null when this build can't tell. Never throws. */
export async function powerState(): Promise<PowerState | null> {
  if (!native) return null;
  try {
    return readPowerState(await native.getStateAsync());
  } catch {
    return null;
  }
}
