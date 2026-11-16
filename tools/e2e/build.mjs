// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Builds what the click checks load: the web app and the extension's test build. */

import { buildFor } from '../../apps/extension/build.mjs';
import { buildWeb } from '../../apps/web/build.mjs';

console.log(await buildWeb());
console.log(await buildFor('chrome', { e2e: true }));
