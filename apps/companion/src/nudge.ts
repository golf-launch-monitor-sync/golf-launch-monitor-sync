// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The headless task behind the Android sync service (modules/glmsync-sync, spec/deep-links.md
 * "Android"): a target app bound to the service, the service started this. When the app is open it
 * runs in the screen's runtime (same runner, same queue); when it isn't, Android starts the JavaScript
 * without a screen. The rules are in src/lib/nudge.ts.
 *
 * Registered at the top of index.ts, like the background task: the service may start the app only to
 * run it. iOS never calls it.
 */

import { AppRegistry } from 'react-native';
import { NUDGE_TASK, NudgeGate, runNudge } from './lib/nudge';
import { services } from './platform';

const gate = new NudgeGate();

AppRegistry.registerHeadlessTask(NUDGE_TASK, () => async (data: unknown) => {
  await runNudge(data, { services, gate });
});
