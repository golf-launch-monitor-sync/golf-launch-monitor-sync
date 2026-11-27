// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's manifest, for Chrome/Edge and for Firefox (they differ in how the background runs
 * and in Firefox's own settings). Kept as small as it can be:
 *
 * - **Trackman**: the portal (to read the player's own sign-in there, as the bookmark did) and its API
 *   (to fetch). Nothing else of anyone's.
 * - **The web app's pairing page**: to pick up a pairing code from its fragment.
 * - **golf.de**: the player's *Mein Bereich* and a tournament's result list, to read along with what golf.de's own page
 *   loaded there (spec/hcp.md). Not golf.de's API: the extension sends golf.de nothing of its own. A run by itself opens
 *   *Mein Bereich* in a tab of its own (`chrome.tabs.create`, `chrome.windows.getAll`): neither needs a permission.
 *   And the tournament calendar's pages (spec 1.19.0): on a tournament's page the player may take that one tournament
 *   into a connected app with a tap; the script reads the page's lines only then, and asks golf.de nothing.
 * - **The world rankings** (OWGR, Rolex Rankings): only a player's own page, to read what it shows when the player taps
 *   *Send* there (spec/prores.md). Nothing else of the sites, and no request to them.
 * - **A tour's site**: on the Pro Golf Tour the player's profile and his tournaments' pages, to read his ranking and his
 *   own line of a final result (spec/prores.md), and on his *Fetch all* to open those pages as their links do. On
 *   europeantour.com (DP World Tour, HotelPlanner Tour) only a player's pages, read as they show; on the Ladies European
 *   Tour and the LET Access Series her profile (results with rounds) and her own line of the Order of Merit. No request
 *   to the sites of its own.
 * - **The tours whose player page shows the season** (pgatour.com, lpga.com, epsontour.com): the whole site, because it
 *   moves to the player's *Results* page without loading it; the line shows only there, and the page is read only when
 *   the player taps *Send*. No request to the sites.
 * - **A target**: asked for when the player connects one (`optional_host_permissions`), one address
 *   at a time - never every site up front.
 * - **The shape recorder** (the options page, `shape.html`, for adding another launch monitor): a portal of its fixed
 *   list (`@glmsync/shape`), asked for on the page's *Start* the same way (the targets' optional pattern covers it),
 *   its two scripts on that portal's pages only while it records (`registerContentScripts`, never across a restart).
 * - No `tabs`, no `webRequest`, no `<all_urls>`. `scripting` to reach a pairing page that was already open when the
 *   extension was installed, and for the scripts registered at run time (the bridge, the shape recorder).
 */

import { EVENT_PAGE_MATCHES, PAGE_MATCHES as GOLFDE_MATCHES } from '@glmsync/provider-golfde';
import { PAGE_MATCHES as RANKING_MATCHES } from '@glmsync/provider-rankings';
import { alps, europeantour, ocs, progolftour, SEASON_PAGE_MATCHES } from '@glmsync/provider-tours';

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
    // The developer page (the shape recorder): not in the popup, the player's own way to it is the extension's options.
    options_ui: { page: 'shape.html', open_in_tab: true },
    permissions: ['storage', 'alarms', 'scripting'],
    host_permissions: [PORTAL_MATCH, API_MATCH, ...PAIR_MATCHES, ...testHosts],
    optional_host_permissions: TARGET_MATCHES,
    content_scripts: [
      // Before the portal's own scripts, so its first call with the key is seen.
      { matches: [PORTAL_MATCH], js: ['portal-main.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
      { matches: [PORTAL_MATCH], js: ['portal-relay.js'], run_at: 'document_start', all_frames: false },
      // Before the page's script, which takes the code out of the address once it was read.
      { matches: PAIR_MATCHES, js: ['pair-content.js'], run_at: 'document_start', all_frames: false },
      // golf.de: before the page's own scripts, so their first answers are seen; reads along, sends nothing.
      { matches: GOLFDE_MATCHES, js: ['golfde-main.js'], run_at: 'document_start', world: 'MAIN', all_frames: false },
      { matches: GOLFDE_MATCHES, js: ['golfde-relay.js'], run_at: 'document_start', all_frames: false },
      // A tournament's page of golf.de's calendar: *Add to …* by its heading; reads the page's lines on that tap only.
      { matches: EVENT_PAGE_MATCHES, js: ['golfde-event.js'], run_at: 'document_idle', all_frames: false },
      // A player's own page of a world ranking: the line with *Send*; it reads the page only on that tap.
      { matches: [...RANKING_MATCHES], js: ['rankings-content.js'], run_at: 'document_idle', all_frames: false },
      { matches: [...progolftour.PAGE_MATCHES], js: ['tours-content.js'], run_at: 'document_idle', all_frames: false },
      // europeantour.com: only a player's pages (DP World Tour, HotelPlanner Tour); the line with *Send*.
      { matches: [...europeantour.PAGE_MATCHES], js: ['europeantour-content.js'], run_at: 'document_idle', all_frames: false },
      // The tours whose player page shows the season (PGA Tour, Korn Ferry, LPGA, Epson): the line on his Results and Stats pages.
      { matches: [...SEASON_PAGE_MATCHES], js: ['season-content.js'], run_at: 'document_idle', all_frames: false },
      // The LET's and LET Access Series' pages: every page, because each site is one app that changes its address
      // without loading a page; the script reads only her profile and her line of the Order of Merit.
      { matches: [...ocs.PAGE_MATCHES], js: ['ocs-content.js'], run_at: 'document_idle', all_frames: false },
      // The Alps Tour: every page (the site changes its address without loading one); it reads only his profile.
      { matches: [...alps.PAGE_MATCHES], js: ['alps-content.js'], run_at: 'document_idle', all_frames: false },
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
        // What leaves the browser: launch monitor data the player fetches from their own account, the handicap
        // record golf.de's page showed them, a tournament's page of golf.de when they tap to take it, and their own
        // world ranking page when they tap Send there - to the app they connect. Nothing goes to the project or anyone
        // else.
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
