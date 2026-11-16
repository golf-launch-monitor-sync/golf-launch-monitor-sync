// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The Android sync service (modules/glmsync-sync) can't run here; what it must agree on with the spec
 * and with src/lib/nudge.ts is checked in its files: the action, the extra, the task's name and time,
 * and a manifest a target can find it by (spec/deep-links.md, "Android").
 */
import { readFileSync } from 'node:fs';
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
