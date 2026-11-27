// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
//
// What keeps iOS from waking the app: its Background App Refresh (the app's own switch, the one for all
// apps, or a restriction) and Low Power Mode. `expo-background-task`'s status can't tell: on a phone it
// answers "available" whatever the switch says. Read only, nothing kept; the rules are in
// src/lib/wakeHints.ts.
//
// And when iOS ends the background task's time (src/background.ts, src/lib/longRun.ts): `expo-background-task` posts
// its notification `onTasksExpired` in the task's expiration handler, but its own module drops it before JavaScript
// hears (it looks for a `url` the handler never sends). This module passes it on as `onTaskExpired`, so a long run
// stops cleanly instead of being frozen in the middle of a request.

import ExpoModulesCore
import UIKit

public class GlmsyncPowerModule: Module {
  private var expiry: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("GlmsyncPower")

    Events("onTaskExpired")

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

    OnStartObserving("onTaskExpired") {
      guard self.expiry == nil else { return }
      // Delivered on the thread that posts it, inside iOS's expiration handler: only hand it on.
      self.expiry = NotificationCenter.default.addObserver(
        forName: Notification.Name("onTasksExpired"), object: nil, queue: nil
      ) { [weak self] _ in
        self?.sendEvent("onTaskExpired", [:])
      }
    }

    OnStopObserving("onTaskExpired") {
      if let expiry = self.expiry {
        NotificationCenter.default.removeObserver(expiry)
        self.expiry = nil
      }
    }
  }
}
