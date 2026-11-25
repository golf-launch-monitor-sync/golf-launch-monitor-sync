// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script of the app's golf.de window, as it runs inside golf.de's page (injected before the page's own
 * scripts, `injectedJavaScriptBeforeContentLoaded`): the extension's page script (@glmsync/provider-golfde/page),
 * only on the pages the extension reads too, posting what it saw - no names, no numbers - to the app. It sends
 * golf.de nothing and changes nothing the page does. scripts/golfde-page.mjs bundles it into
 * src/lib/golfdePageScript.ts.
 *
 * For *Fetch all* (spec/hcp.md, clicking for the player) it also gives the page a step function the app calls
 * (src/lib/fetchAll.ts): golf.de's own pager link or Scoring Record button, clicked as the player would. It reads no
 * value and asks golf.de nothing; whoever calls it can only make golf.de's own page do what its own links do.
 */

import { operate, type Place, type Root, type Step } from '@glmsync/provider-golfde/operate';
import { watchPage, type PageWindow } from '@glmsync/provider-golfde/page';
import { STEP_FUNCTION } from '../src/lib/fetchAll.ts';
import { GOLFDE_MESSAGE, onReadPage, pageId } from '../src/lib/golfdePage.ts';

declare const window: PageWindow & {
  ReactNativeWebView?: { postMessage(data: string): void };
  document: Root;
  location: { hash: string; assign(url: string): void };
};

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
    const post = (seen: unknown) => {
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: GOLFDE_MESSAGE, page, seen }));
      } catch {
        // never in the page's way
      }
    };
    watchPage(window, post);
    const place: Place = {
      get hash() {
        return window.location.hash;
      },
      set hash(h: string) {
        window.location.hash = h;
      },
      assign: (url: string) => window.location.assign(url),
    };
    Object.defineProperty(window, STEP_FUNCTION, {
      value: (text: unknown) => {
        try {
          const step = JSON.parse(String(text)) as Step;
          // Only the steps taken in the page; opening an address is the app's own (it checks it).
          if (step?.do !== 'page' && step?.do !== 'click') return;
          if (step.do === 'page' && (typeof step.cursor !== 'string' || step.cursor.length > 300)) return;
          const seen = operate(step, window.document, place);
          if (seen) post(seen);
        } catch {
          // never in the page's way
        }
      },
    });
  }
} catch {
  // never in the page's way
}
