// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
// The native module GlmsyncPower (iOS only): Background App Refresh, Low Power Mode, and the end of a background
// task's time. Null where there is none (Android, a build without it, Expo Go). The rules around it are the engine's
// (`powerOf` of glmsync-engine).
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export const GlmsyncPower = Platform.OS === 'ios' ? requireOptionalNativeModule('GlmsyncPower') : null;
