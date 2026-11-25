// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIREFOX_UPDATE_URL, GECKO_ID, manifest, packageName, PAIR_MATCHES } from './manifest.ts';

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

    it(`${browser}: reads along on golf.de only on the player's own pages and a result list, never golf.de's API`, () => {
      const golf = (m.content_scripts as { matches: string[]; js: string[]; world?: string }[]).filter((c) => c.matches.some((x) => x.includes('golf.de')));
      expect(golf.map((c) => c.js[0])).toEqual(['golfde-main.js', 'golfde-relay.js']);
      for (const c of golf) {
        expect(c.matches).toEqual(['https://www.golf.de/mein-bereich.html*', 'https://www.golf.de/mein-bereich/*', 'https://www.golf.de/sport/turnierkalender/clubturniere.html*']);
      }
      expect(JSON.stringify(m)).not.toMatch(/api-v2\.golf\.de|membership-card-api|login\.golf\.de/);
    });

    it(`${browser}: reads a world ranking only on a player's own page, nothing else of the sites`, () => {
      const pages = (m.content_scripts as { matches: string[]; js: string[]; world?: string }[]).filter((c) => c.js.includes('rankings-content.js'));
      expect(pages).toHaveLength(1);
      expect(pages[0]?.matches).toEqual(['https://www.owgr.com/playerprofile/*', 'https://www.rolexrankings.com/players/*']);
      expect(pages[0]?.world).toBeUndefined();
      expect(JSON.stringify(m.host_permissions)).not.toMatch(/owgr|rolex/);
    });

    it(`${browser}: reads europeantour.com only on a player's pages`, () => {
      const pages = (m.content_scripts as { matches: string[]; js: string[]; world?: string }[]).filter((c) => c.js.includes('europeantour-content.js'));
      expect(pages).toHaveLength(1);
      expect(pages[0]?.matches).toEqual(['https://www.europeantour.com/players/*']);
      expect(pages[0]?.world).toBeUndefined();
      expect(JSON.stringify(m.host_permissions)).not.toMatch(/europeantour/);
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

  // 17 Nov (LMS-W3-N-b): loaded by hand nothing updates itself; signed by Mozilla, Firefox asks this address.
  it("Firefox asks the web app's site for its updates, over https; Chrome has no such field", () => {
    const ff = manifest('firefox', '1.0.0') as any;
    expect(ff.browser_specific_settings.gecko.id).toBe(GECKO_ID);
    expect(ff.browser_specific_settings.gecko.update_url).toBe(FIREFOX_UPDATE_URL);
    expect(FIREFOX_UPDATE_URL).toMatch(/^https:\/\/golf-launch-monitor-sync\.github\.io\/golf-launch-monitor-sync\/firefox\/updates\.json$/);
    expect(JSON.stringify(manifest('chrome', '1.0.0'))).not.toContain('update_url');
  });
});

describe('the store packages', () => {
  it('say which browsers they are for: one for Chrome and Edge, one for Firefox', () => {
    expect(packageName('chrome', '0.1.0')).toBe('golf-launch-monitor-sync-chrome-edge-0.1.0.zip');
    expect(packageName('firefox', '0.1.0')).toBe('golf-launch-monitor-sync-firefox-0.1.0.zip');
  });
});
