// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Where things are: the web app on GitHub Pages, the repository, the extension in the stores. */

export const REPO_URL = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync';
/** The web app (apps/web); its pairing page is `${WEB_APP_URL}/pair#target=…&code=…`. */
export const WEB_APP_URL = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync';
export const WEB_APP_ORIGIN = 'https://golf-launch-monitor-sync.github.io';
export const PAIR_PATH = '/golf-launch-monitor-sync/pair';
/** How to install the extension until it is in the stores (and for testers). */
export const INSTALL_URL = `${REPO_URL}/blob/main/apps/extension/README.md#install`;

/**
 * The extension in the browsers' stores. Null until it is published there: the pages then point to
 * the installation guide.
 */
export const STORES: { chrome: string | null; edge: string | null; firefox: string | null } = {
  chrome: null,
  edge: null,
  firefox: null,
};

/** Which store fits the browser the page runs in. */
export function storeFor(userAgent: string): string | null {
  if (/Firefox\//.test(userAgent)) return STORES.firefox;
  if (/Edg\//.test(userAgent)) return STORES.edge ?? STORES.chrome;
  return STORES.chrome;
}

/**
 * Whether this browser can run the extension at all: Chrome, Edge (and the other Chromium browsers) and Firefox on a
 * computer, Firefox on Android. Safari has no build of it (a Safari extension needs an app of its own), and neither
 * has any browser on an iPhone or iPad, nor Chrome on Android: there the pairing page offers only the way by hand.
 */
export function canHaveExtension(userAgent: string): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return false;
  if (/Firefox\//.test(userAgent)) return true;
  if (/Android/.test(userAgent)) return false;
  return /Chrome\/|Chromium\/|Edg\//.test(userAgent);
}
