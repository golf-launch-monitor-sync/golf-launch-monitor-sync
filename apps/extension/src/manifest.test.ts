// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest, packageName, PAIR_MATCHES } from './manifest.ts';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string;

describe('the manifest', () => {
  for (const browser of ['chrome', 'firefox'] as const) {
    const m = manifest(browser, VERSION) as Record<string, any>;

    it(`${browser}: asks for no more than it needs`, () => {
      expect(m.manifest_version).toBe(3);
      expect(m.permissions).toEqual(['storage', 'alarms', 'scripting']);
      const hosts = JSON.stringify([m.host_permissions, m.content_scripts]);
      expect(hosts).not.toMatch(/<all_urls>|\*:\/\/\*\/|https:\/\/\*\/\*/);
      // Every site only on request, one at a time.
      expect(m.optional_host_permissions).toContain('https://*/*');
      expect(m.host_permissions.filter((h: string) => !PAIR_MATCHES.includes(h))).toEqual(['https://portal.trackmangolf.com/*', 'https://api.trackmangolf.com/*']);
      expect(m.content_security_policy.extension_pages).not.toMatch(/unsafe-eval|unsafe-inline|wasm/);
    });

    it(`${browser}: has its version and names from the locales`, () => {
      expect(m.version).toBe(VERSION);
      expect(m.name).toBe('__MSG_name__');
    });
  }

  it('runs the background as Chrome and Firefox each want it', () => {
    expect((manifest('chrome', '1.0.0') as any).background).toEqual({ service_worker: 'background.js' });
    const ff = manifest('firefox', '1.0.0') as any;
    expect(ff.background).toEqual({ scripts: ['background.js'] });
    expect(ff.browser_specific_settings.gecko).toMatchObject({ id: expect.stringContaining('@'), strict_min_version: '140.0' });
    expect(ff.browser_specific_settings.gecko.data_collection_permissions.required.length).toBeGreaterThan(0);
  });
});

describe('the store packages', () => {
  it('say which browsers they are for: one for Chrome and Edge, one for Firefox', () => {
    expect(packageName('chrome', '0.1.0')).toBe('golf-launch-monitor-sync-chrome-edge-0.1.0.zip');
    expect(packageName('firefox', '0.1.0')).toBe('golf-launch-monitor-sync-firefox-0.1.0.zip');
  });
});
