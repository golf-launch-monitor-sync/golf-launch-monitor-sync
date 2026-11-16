// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
package glmsync.companion.sync

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Nothing for JavaScript to call: the module exists so that Expo's autolinking builds this library,
 * whose manifest brings the sync service (SyncService) into the app.
 */
class GlmsyncSyncModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("GlmsyncSync")
    }
}
