# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
#
# What the iPhone says about waking the companion app (src/power.ts, src/lib/wakeHints.ts).
Pod::Spec.new do |s|
  s.name           = 'GlmsyncPower'
  s.version        = '1.0.0'
  s.summary        = 'Background App Refresh and Low Power Mode, for the companion app.'
  s.description    = 'Background App Refresh and Low Power Mode, for the companion app.'
  s.license        = 'MIT'
  s.author         = 'Reginald Stadlbauer'
  s.homepage       = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
