// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page behind the universal links (spec/deep-links.md, *Universal links*, spec 1.22.0): what it does with the
 * address it was opened at. The phone opens the companion app for such an address when it is installed; this page
 * comes only where it isn't (or where the phone couldn't verify the host yet). Pure, for the tests; `link.ts` draws it.
 */

import { parseUniversal } from '@glmsync/spec';

/** The companion app's Android build (the pre-release `companion-android`, apps/companion/README.md). */
export const COMPANION_APK_URL =
  'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases/download/companion-android/golf-launch-monitor-sync-companion.apk';
/** How to get the companion app on an iPhone while it is in testing (TestFlight). */
export const COMPANION_IOS_URL = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/blob/main/apps/companion/README.md';

export type LinkPage =
  /** Not a link of this page: say so. */
  | { show: 'invalid' }
  /** A pair link on a computer: the pairing page takes over (it has the extension's way and the one by hand). */
  | { show: 'forward'; to: string }
  /** A phone without the companion app (or one whose app didn't take the address): open it by its scheme, or install. */
  | { show: 'phone'; action: 'pair' | 'sync'; open: string; platform: 'ios' | 'android' }
  /** A sync link on a computer: fetching on the phone happens in the companion app. */
  | { show: 'computer-sync' };

const enc = encodeURIComponent;

/** `href`: the page's whole address (the keys are in its fragment); `pairPage`: the pairing page's address. */
export function linkPage(href: string, userAgent: string, pairPage: string): LinkPage {
  const link = parseUniversal(href);
  if (!link.ok || (link.action !== 'pair' && link.action !== 'sync')) return { show: 'invalid' };
  const platform = /iPhone|iPad|iPod/.test(userAgent) ? 'ios' : /Android/.test(userAgent) ? 'android' : null;
  if (platform) {
    // The same keys behind the app's own scheme: what an app installed before its build knew the host still opens.
    const fragment = href.slice(href.indexOf('#') + 1);
    const open = `glmsync://${link.action}${href.includes('#') && fragment ? `?${fragment}` : ''}`;
    return { show: 'phone', action: link.action, open, platform };
  }
  if (link.action === 'sync') return { show: 'computer-sync' };
  // The pairing page's fragment takes no way back: on a computer the page stays where it is.
  const keys = [`target=${enc(link.target)}`, `code=${enc(link.code)}`];
  if (link.provider !== undefined) keys.push(`provider=${enc(link.provider)}`);
  if (link.kind !== undefined) keys.push(`kind=${link.kind}`);
  return { show: 'forward', to: `${pairPage}#${keys.join('&')}` };
}
