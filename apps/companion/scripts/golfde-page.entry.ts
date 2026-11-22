// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script of the app's golf.de window, as it runs inside golf.de's page (injected before the page's own
 * scripts, `injectedJavaScriptBeforeContentLoaded`): the extension's page script (@glmsync/provider-golfde/page),
 * only on the pages the extension reads too, posting what it saw - no names, no numbers - to the app. It sends
 * golf.de nothing and changes nothing the page does. scripts/golfde-page.mjs bundles it into
 * src/lib/golfdePageScript.ts.
 */

import { watchPage, type PageWindow } from '@glmsync/provider-golfde/page';
import { GOLFDE_MESSAGE, onReadPage, pageId } from '../src/lib/golfdePage.ts';

declare const window: PageWindow & { ReactNativeWebView?: { postMessage(data: string): void } };

try {
  if (onReadPage(window.location.href)) {
    const random = (n: number) => {
      const out = new Uint8Array(n);
      const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
      if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(out);
      for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
      return out;
    };
    const page = pageId(random);
    watchPage(window, (seen) => {
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: GOLFDE_MESSAGE, page, seen }));
      } catch {
        // never in the page's way
      }
    });
  }
} catch {
  // never in the page's way
}
