// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the iPhone says about waking this app: its *Background App Refresh* and Low Power Mode (modules/glmsync-power;
 * how its answer is read in @glmsync/engine's power.ts, what the app says in src/lib/wakeHints.ts).
 * `expo-background-task`'s status can't tell: on a phone it answers *available* whatever the switch says. And when iOS
 * ends the background task's time, which `expo-background-task`'s own listener never hears (@glmsync/engine,
 * longRun.ts).
 *
 * A build without the module (older ones, Android, a development build in Expo Go) answers null: then nothing is said,
 * and a long run ends by its own time.
 */

import { powerOf, type PowerModule } from '@glmsync/engine';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

const native: PowerModule | null = Platform.OS === 'ios' ? requireOptionalNativeModule<PowerModule>('GlmsyncPower') : null;
const power = powerOf(native);

/** The phone's state now, or null when this build can't tell. Never throws. */
export const powerState = power.powerState;

/** Calls `listener` when iOS ends the background task's time; null when this build can't tell. Never throws. */
export const onTaskExpired = power.onTaskExpired;
