// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's manifest, for Chrome/Edge and for Firefox (they differ in how the background runs
 * and in Firefox's own settings). Kept as small as it can be:
 *
 * - **Trackman**: the portal (to read the player's own sign-in there, as the bookmark did) and its API
 *   (to fetch). Nothing else of anyone's.
 * - **The web app's pairing page**: to pick up a pairing code from its fragment.
 * - **A target**: asked for when the player connects one (`optional_host_permissions`), one address
 *   at a time - never every site up front.
 * - No `tabs`, no `webRequest`, no `<all_urls>`. `scripting` only to reach a pairing page that was
 *   already open when the extension was installed.
 */

export type Browser = 'chrome' | 'firefox';

export const PORTAL_MATCH = 'https://portal.trackmangolf.com/*';
export const API_MATCH = 'https://api.trackmangolf.com/*';
export const PAIR_MATCHES = [
  'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair',
  'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair?*',
  'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair/*',
  'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair.html*',
];
/** Targets: any https address, and this machine for development - each only once the player allows it. */
export const TARGET_MATCHES = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];
export const GECKO_ID = 'sync@golf-launch-monitor-sync.github.io';
/**
 * Where a self-distributed Firefox build asks for its updates (the web app's site; tools/firefox-updates.mjs writes
 * it from the releases that carry a signed .xpi). The Chrome Web Store and Edge Add-ons update their own; Firefox,
 * signed by Mozilla but not listed, updates only through this. It must be in the manifest before Mozilla signs it.
 */
export const FIREFOX_UPDATE_URL = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/firefox/updates.json';

/** Content security policy of the extension's own pages: its own scripts only, no eval. */
export const CSP = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

/**
 * `testHosts`: addresses granted at install, only for the click checks' build - there no one can
 * answer the browser's own prompt for a target. A release build never has any.
 */
export function manifest(browser: Browser, version: string, testHosts: string[] = []): Record<string, unknown> {
  const m: Record<string, unknown> = {
    manifest_version: 3,
    name: '__MSG_name__',
    short_name: 'GLM Sync',
    description: '__MSG_description__',
    version,
    default_locale: 'en',
    homepage_url: 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync',
    icons: { '16': 'icons/16.png', '32': 'icons/32.png', '48': 'icons/48.png', '128': 'icons/128.png' },
    action: {
      default_title: '__MSG_name__',
      default_popup: 'popup.html',
      default_icon: { '16': 'icons/16.png', '32': 'icons/32.png' },
    },
    permissions: ['storage', 'alarms', 'scripting'],
    host_permissions: [PORTAL_MATCH, API_MATCH, ...PAIR_MATCHES, ...testHosts],
    optional_host_permissions: TARGET_MATCHES,
    content_scripts: [
      // Before the portal's own scripts, so its first call with the key is seen.
      { matches: [PORTAL_MATCH], js: ['portal-main.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
      { matches: [PORTAL_MATCH], js: ['portal-relay.js'], run_at: 'document_start', all_frames: false },
      // Before the page's script, which takes the code out of the address once it was read.
      { matches: PAIR_MATCHES, js: ['pair-content.js'], run_at: 'document_start', all_frames: false },
    ],
    content_security_policy: { extension_pages: CSP },
  };
  if (browser === 'chrome') {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '120';
  } else {
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        update_url: FIREFOX_UPDATE_URL,
        // Content scripts in the page's world (128), the data consent below (140, an ESR).
        strict_min_version: '140.0',
        // What leaves the browser: launch monitor data the player fetches from their own account,
        // to the app they connect. Nothing goes to the project or anyone else.
        data_collection_permissions: { required: ['websiteContent'] },
      },
      // Firefox for Android knows the data consent from 142.
      gecko_android: { strict_min_version: '142.0' },
    };
  }
  return m;
}

/**
 * The store package's file name. The Chrome build is the same package for Chrome and Edge (Edge Add-ons takes the
 * Chrome Web Store's package), and its name says so: on 17 Nov a tester with Edge looked for an Edge file.
 */
export function packageName(browser: Browser, version: string): string {
  return `golf-launch-monitor-sync-${browser === 'chrome' ? 'chrome-edge' : browser}-${version}.zip`;
}
