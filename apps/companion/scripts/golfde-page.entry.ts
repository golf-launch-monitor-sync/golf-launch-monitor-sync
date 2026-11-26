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
 *
 * On golf.de's tournament calendar (spec 1.19.0, *Taking one tournament*) it tells the app whether the page is a
 * tournament's it may offer to take (once a second it looks; a message only when that changes), and gives the page a
 * function the app calls on the player's tap: it reads the page's lines under *Turnierinformationen* then, by their
 * label, and posts that one tournament (or why it can't). Nothing without the tap; it asks golf.de nothing.
 */

import { eventOnPage, eventPageOf, offerEvent, type PageDoc } from '@glmsync/provider-golfde/event';
import { operate, type Place, type Root, type Step } from '@glmsync/provider-golfde/operate';
import { watchPage, type PageWindow } from '@glmsync/provider-golfde/page';
import { STEP_FUNCTION } from '../src/lib/fetchAll.ts';
import { EVENT_MESSAGE, GOLFDE_MESSAGE, onCalendarPage, onReadPage, pageId, TAKE_FUNCTION } from '../src/lib/golfdePage.ts';

declare const window: PageWindow & {
  ReactNativeWebView?: { postMessage(data: string): void };
  document: Root & PageDoc;
  location: { href: string; hash: string; assign(url: string): void };
  setInterval(fn: () => void, ms: number): unknown;
};

const random = (n: number) => {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(out);
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
};

try {
  if (onReadPage(window.location.href)) {
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

try {
  if (onCalendarPage(window.location.href)) {
    const page = pageId(random);
    const tell = (what: Record<string, unknown>) => {
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: EVENT_MESSAGE, page, ...what }));
      } catch {
        // never in the page's way
      }
    };
    // golf.de's calendar changes its address without loading and fills a tournament's lines in a moment later.
    let at: string | null = null;
    let since = 0;
    let offered: boolean | null = null;
    const look = () => {
      try {
        const href = window.location.href;
        const id = eventPageOf(href)?.id ?? null;
        if (id !== at) {
          // Another tournament (or none): the app hears afresh, and forgets what the last tap said.
          at = id;
          since = Date.now();
          offered = null;
        }
        const offer = offerEvent(href, window.document, since, Date.now());
        if (offer !== offered) {
          offered = offer;
          tell({ offer });
        }
      } catch {
        // never in the page's way
      }
    };
    Object.defineProperty(window, TAKE_FUNCTION, {
      value: () => {
        try {
          const read = eventOnPage(window.location.href, window.document);
          tell('event' in read ? { event: read.event } : { refused: read.refused === 'not_a_tournament' && eventPageOf(window.location.href) ? 'changed_page' : read.refused });
        } catch {
          tell({ refused: 'changed_page' });
        }
      },
    });
    look();
    if (typeof window.setInterval === 'function') window.setInterval(look, 1000);
  }
} catch {
  // never in the page's way
}
