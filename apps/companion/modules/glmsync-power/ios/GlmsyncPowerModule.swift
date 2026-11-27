// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
//
// What keeps iOS from waking the app: its Background App Refresh (the app's own switch, the one for all
// apps, or a restriction) and Low Power Mode. `expo-background-task`'s status can't tell: on a phone it
// answers "available" whatever the switch says. Read only, nothing kept; the rules are in
// src/lib/wakeHints.ts.

import ExpoModulesCore
import UIKit

public class GlmsyncPowerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("GlmsyncPower")

    // UIApplication wants the main thread.
    AsyncFunction("getStateAsync") { () -> [String: Any] in
      let refresh: String
      switch UIApplication.shared.backgroundRefreshStatus {
      case .available: refresh = "available"
      case .denied: refresh = "denied"
      case .restricted: refresh = "restricted"
      @unknown default: refresh = "unknown"
      }
      return ["refresh": refresh, "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled]
    }.runOnQueue(.main)
  }
}
