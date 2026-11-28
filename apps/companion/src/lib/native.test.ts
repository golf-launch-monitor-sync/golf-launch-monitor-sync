// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The Android sync service (modules/glmsync-sync) can't run here; what it must agree on with the spec
 * and with src/lib/nudge.ts is checked in its files: the action, the extra, the task's name and time,
 * and a manifest a target can find it by (spec/deep-links.md, "Android").
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SYNC_ACTION, SYNC_REASON_EXTRA } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { NUDGE_TASK, NUDGE_TIMEOUT_MS } from './nudge.ts';

const MODULE = new URL('../../modules/glmsync-sync/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, MODULE), 'utf8');
const service = read('android/src/main/java/glmsync/companion/sync/SyncService.kt');
const manifest = read('android/src/main/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
const constant = (name: string) => new RegExp(`const val ${name} = "?([^"\\n]+?)"?L?\\n`).exec(service)?.[1];

describe('the sync service', () => {
  it('agrees with the spec and the task', () => {
    expect(constant('ACTION')).toBe(SYNC_ACTION);
    expect(constant('EXTRA_REASON')).toBe(SYNC_REASON_EXTRA);
    expect(constant('TASK')).toBe(NUDGE_TASK);
    expect(Number(constant('TIMEOUT_MS')?.replace(/_/g, ''))).toBe(NUDGE_TIMEOUT_MS);
  });

  it('is exported, needs no permission, and is found by the action alone', () => {
    const decl = /<service\b([^>]*)>([\s\S]*?)<\/service>/.exec(manifest);
    expect(decl).not.toBeNull();
    const [, attrs = '', body = ''] = decl ?? [];
    expect(attrs).toContain('android:name="glmsync.companion.sync.SyncService"');
    expect(attrs).toContain('android:exported="true"');
    expect(attrs).not.toContain('android:permission');
    expect(body).toContain(`<action android:name="${SYNC_ACTION}" />`);
    // A filter with <data> would not match the lookup, whose intent carries the action only.
    expect(body).not.toContain('<data');
  });

  it('answers onBind and onRebind alike, keeps rebinding, and gives an empty Binder', () => {
    expect(service).toMatch(/override fun onBind\(intent: Intent\): IBinder \{\s*nudge\(intent\)/);
    expect(service).toMatch(/override fun onRebind\(intent: Intent\?\) \{\s*super\.onRebind\(intent\)\s*nudge\(intent\)/);
    expect(service).toMatch(/override fun onUnbind\(intent: Intent\?\): Boolean = true/);
    expect(service).toContain('private val binder = Binder()');
  });
});

describe('the power module (modules/glmsync-power)', () => {
  const POWER = new URL('../../modules/glmsync-power/', import.meta.url);
  const readPower = (path: string) => readFileSync(new URL(path, POWER), 'utf8');

  it('is the iOS module src/power.ts asks for, answering what readPowerState takes', () => {
    const config = JSON.parse(readPower('expo-module.config.json')) as { platforms: string[]; apple?: { modules?: string[] } };
    expect(config.platforms).toEqual(['apple']);
    expect(config.apple?.modules).toEqual(['GlmsyncPowerModule']);
    const swift = readPower('ios/GlmsyncPowerModule.swift');
    const js = readFileSync(new URL('../power.ts', import.meta.url), 'utf8');
    expect(js).toContain("requireOptionalNativeModule<PowerModule>('GlmsyncPower')");
    expect(swift).toContain('Name("GlmsyncPower")');
    expect(swift).toContain('AsyncFunction("getStateAsync")');
    // UIApplication is read on the main thread only.
    expect(swift).toMatch(/\.runOnQueue\(\.main\)/);
    for (const value of ['"available"', '"denied"', '"restricted"', '"refresh"', '"lowPower"']) expect(swift).toContain(value);
    expect(readPower('ios/GlmsyncPower.podspec')).toContain("s.dependency 'ExpoModulesCore'");
  });

  it('passes on iOS ending the background task: the notification expo-background-task posts, the event the engine hears', () => {
    const swift = readPower('ios/GlmsyncPowerModule.swift');
    // src/power.ts hands the module to the engine's rules (packages/engine/src/power.ts), which listen.
    const js = readFileSync(new URL('../../../../packages/engine/src/power.ts', import.meta.url), 'utf8');
    expect(swift).toContain('Events("onTaskExpired")');
    expect(swift).toContain('Notification.Name("onTasksExpired")');
    expect(swift).toContain('self?.sendEvent("onTaskExpired"');
    expect(swift).toMatch(/OnStopObserving\("onTaskExpired"\)[\s\S]*removeObserver/);
    expect(js).toContain("native.addListener('onTaskExpired', listener)");
  });
});

describe('expo-background-task on iOS (what the engine’s longRun.ts counts on)', () => {
  // Read from the installed package: an upgrade that changes any of it fails here, not on a phone at night.
  const pkg = new URL(`file://${realpathSync(fileURLToPath(new URL('../../node_modules/expo-background-task/', import.meta.url)))}/`);
  const readExpo = (path: string) => readFileSync(new URL(path, pkg), 'utf8');

  it('is a BGProcessingTask with the network, not only on power', () => {
    const scheduler = readExpo('ios/BackgroundTaskScheduler.swift');
    expect(scheduler).toContain('BGProcessingTaskRequest(identifier: BackgroundTaskConstants.BackgroundWorkerIdentifier)');
    expect(scheduler).toContain('request.requiresNetworkConnectivity = true');
    expect(readExpo('plugin/build/withBackgroundTask.js')).toContain("UIBackgroundModes.push('processing')");
  });

  it('completes the task only when the JavaScript task has ended (so a long run may take its minutes)', () => {
    const delegate = readExpo('ios/BackgroundTaskAppDelegate.swift');
    expect(delegate).toMatch(/runTasks\(with: EXTaskLaunchReasonBackgroundTask[\s\S]*?completionHandler:[\s\S]*?setTaskCompleted\(success: true\)/);
  });

  it('posts onTasksExpired when iOS ends it - which its own module drops, hence modules/glmsync-power', () => {
    const delegate = readExpo('ios/BackgroundTaskAppDelegate.swift');
    const module = readExpo('ios/BackgroundTaskModule.swift');
    expect(delegate).toMatch(/expirationHandler[\s\S]*?NotificationCenter\.default\.post\(name: onTasksExpiredNotification, object: self, userInfo: \[:\]\)/);
    expect(module).toContain('private let onTasksExpired = "onTasksExpired"');
    expect(module).toContain('public let onTasksExpiredNotification = Notification.Name(onTasksExpired)');
    // The drop: once Expo fixes it, its own listener hears too - harmless, both stop the run the same way.
    expect(module).toContain('guard let url = notification.userInfo?["url"] as? URL else');
  });
});
