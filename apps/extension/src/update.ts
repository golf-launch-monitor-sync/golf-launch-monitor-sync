// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Update now* (SR-8b): an app's plan said it needs a newer version of this extension (spec 1.22.0). The browser updates
 * an extension from its store by itself, but only every few hours (Firefox about once a day), and a store page has no
 * button for an extension already installed. So the browser is asked first (`runtime.requestUpdateCheck`, which
 * Chrome's documentation names for exactly this: a backend found the extension far out of date and the user is to be
 * prompted); an update it has is applied at once (`runtime.reload`). Otherwise the extension's page in the store it came
 * from opens - found by the browser's own word (`management.getSelf`: how it was installed, from which update address,
 * under which id), never by an address from outside -, and for one loaded by hand, the releases.
 */

export const RELEASES_URL = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases';
/** Firefox's signed add-on, from the project's site (apps/extension/README.md, *Install*): a click installs the newest. */
export const FIREFOX_XPI = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/firefox/golf-launch-monitor-sync.xpi';

/** The update addresses of the two stores (an extension's `updateUrl` when installed from there). */
const STORES: readonly { update: string; page: string }[] = [
  { update: 'https://clients2.google.com/service/update2/crx', page: 'https://chromewebstore.google.com/detail/' },
  { update: 'https://edge.microsoft.com/extensionwebstorebase/v1/crx', page: 'https://microsoftedge.microsoft.com/addons/detail/' },
];
/** An extension id of Chrome and Edge: 32 letters a–p. */
const STORE_ID = /^[a-p]{32}$/;

export type Browser = 'chrome' | 'firefox';

/** Where the extension's own page is, from what the browser says of it (`management.getSelf`). */
export function storePage(self: unknown, browser: Browser): string {
  if (!self || typeof self !== 'object') return RELEASES_URL;
  const { id, installType, updateUrl } = self as Record<string, unknown>;
  if (installType !== 'normal') return RELEASES_URL;
  if (browser === 'firefox') return FIREFOX_XPI;
  const store = typeof updateUrl === 'string' ? STORES.find((s) => updateUrl === s.update || updateUrl.startsWith(`${s.update}?`)) : undefined;
  return store && typeof id === 'string' && STORE_ID.test(id) ? store.page + id : RELEASES_URL;
}

export interface UpdateApi {
  browser: Browser;
  /** Absent where the browser has none. Chrome answers `{ status }`, Firefox `[status, details]`. */
  requestUpdateCheck?: () => Promise<unknown>;
  reload(): void;
  self(): Promise<unknown>;
  open(url: string): Promise<void>;
}

export type UpdateResult = 'reloading' | 'page' | 'failed';

function statusOf(answer: unknown): string | null {
  if (Array.isArray(answer)) return typeof answer[0] === 'string' ? answer[0] : null;
  if (answer && typeof answer === 'object') {
    const s = (answer as Record<string, unknown>).status;
    return typeof s === 'string' ? s : null;
  }
  return null;
}

/** Never throws: says whether it reloads, opened the page, or couldn't. */
export async function updateExtension(api: UpdateApi): Promise<UpdateResult> {
  let status: string | null = null;
  try {
    status = api.requestUpdateCheck ? statusOf(await api.requestUpdateCheck()) : null;
  } catch {
    status = null; // asked too often, or not allowed here: the page then
  }
  if (status === 'update_available') {
    try {
      api.reload();
      return 'reloading';
    } catch {
      // the page then
    }
  }
  let self: unknown = null;
  try {
    self = await api.self();
  } catch {
    self = null;
  }
  try {
    await api.open(storePage(self, api.browser));
    return 'page';
  } catch {
    return 'failed';
  }
}
