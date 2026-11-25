// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script of the app's world ranking window, as it runs inside the site's page (injected before the page's own
 * scripts): it gives the page one function, which the app calls when the player taps *Send* in its bar
 * (src/lib/rankingsPage.ts, `readScript`). Only then does it read - on the player's own page, what the page shows, with
 * the extension's very reading (@glmsync/provider-rankings), its table of tournaments waited for a little - and post
 * the page to the app. It reads nothing before, sends the site nothing and changes nothing the page does.
 * scripts/rankings-page.mjs bundles it into src/lib/rankingsPageScript.ts.
 */

import { hasTable, playerPageOf, readPage, type Doc } from '@glmsync/provider-rankings';
import { callFits, onRankingSite, RANKING_MESSAGE, READ_FUNCTION, TABLE_WAIT_MS } from '../src/lib/rankingsPage.ts';

declare const window: {
  ReactNativeWebView?: { postMessage(data: string): void };
  document: Doc & { title: string };
  location: { href: string };
  setTimeout(fn: () => void, ms: number): unknown;
};

try {
  // Only in the sites' own pages (the window shows no others; the guard is for a page that got there anyway).
  if (onRankingSite(window.location.href)) {
    let reading = false;
    const post = (ask: string, what: object) => {
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: RANKING_MESSAGE, ask, ...what }));
      } catch {
        // never in the page's way
      }
    };
    Object.defineProperty(window, READ_FUNCTION, {
      value: (ask: unknown, day: unknown) => {
        try {
          if (reading || !callFits(ask, day)) return;
          if (!playerPageOf(window.location.href)) {
            post(ask, { why: 'not_player_page' });
            return;
          }
          reading = true;
          const started = Date.now();
          // A page whose table can't even be looked for is read at once (and then says it changed).
          const table = () => {
            try {
              return hasTable(window.document);
            } catch {
              return true;
            }
          };
          const look = () => {
            try {
              if (!table() && Date.now() - started < TABLE_WAIT_MS) {
                window.setTimeout(look, 500);
                return;
              }
              let read: ReturnType<typeof readPage>;
              try {
                read = readPage(window.document, window.location.href, window.document.title, day as string);
              } catch {
                read = { ok: false, why: 'changed_page' };
              }
              reading = false;
              post(ask, read.ok ? { page: read.page } : { why: read.why });
            } catch {
              reading = false; // never in the page's way; the app says the read didn't work after a while
            }
          };
          look();
        } catch {
          reading = false;
        }
      },
    });
  }
} catch {
  // never in the page's way
}
