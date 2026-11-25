// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script of the app's tour window, as it runs inside the site's page (injected before the page's own scripts):
 * it gives the page one function, which the app calls when it wants a read (src/lib/toursPage.ts, `readScript`) - on
 * the player's tap on *Send* or *Fetch all*, and on each page a *Fetch all* run opened. Only then does it read, with the
 * extension's very reading (@glmsync/provider-tours): on his profile his ranking and his season's tournaments, on a
 * tournament's page only his own line (by the name the app hands in) and the field's size. The snapshot of the page,
 * with everyone else's names, stays in here. It reads nothing before, sends the site nothing and changes nothing the
 * page does. scripts/tours-page.mjs bundles it into src/lib/toursPageScript.ts.
 */

import { progolftour, snapshotOf, type DomDocument } from '@glmsync/provider-tours';
import { callFits, onTourSite, READ_FUNCTION, TABLE_WAIT_MS, TOUR_MESSAGE } from '../src/lib/toursPage.ts';

declare const window: {
  ReactNativeWebView?: { postMessage(data: string): void };
  document: DomDocument;
  location: { href: string };
  setTimeout(fn: () => void, ms: number): unknown;
};

try {
  // Only in the tours' own pages (the window shows no others; the guard is for a page that got there anyway).
  if (onTourSite(window.location.href)) {
    let reading = false;
    const post = (ask: string, what: object) => {
      try {
        window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: TOUR_MESSAGE, ask, ...what }));
      } catch {
        // never in the page's way
      }
    };
    Object.defineProperty(window, READ_FUNCTION, {
      value: (ask: unknown, who: unknown) => {
        try {
          if (reading || !callFits(ask, who)) return;
          const href = window.location.href;
          const profile = progolftour.profileOf(href) !== null;
          const key = progolftour.resultKey(href);
          // His line is looked for only by his profile's name; any other page isn't one to read.
          if (!profile && !(key && typeof who === 'string')) {
            post(ask, { why: 'not_player_page' });
            return;
          }
          reading = true;
          const started = Date.now();
          const look = () => {
            try {
              let snap: ReturnType<typeof snapshotOf> | null = null;
              try {
                snap = snapshotOf(window.document, href, progolftour.LABELS);
              } catch {
                snap = null;
              }
              if (snap && snap.tables.length === 0 && Date.now() - started < TABLE_WAIT_MS) {
                window.setTimeout(look, 500);
                return;
              }
              reading = false;
              if (!snap) {
                post(ask, { why: 'changed_page' });
              } else if (profile) {
                const p = progolftour.readProfile(snap);
                post(ask, p?.kind === 'profile' ? { profile: p } : { why: 'changed_page' });
              } else {
                const l = progolftour.ownLine(snap, who as string);
                // Only his line goes (or why there is none); the snapshot with the field's names stays here.
                post(ask, l?.kind === 'result' ? { key, line: l } : l?.kind === 'unread' ? { key, unread: l.why } : { why: 'not_player_page' });
              }
            } catch {
              reading = false; // never in the page's way; the app takes the read as failed after a while
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
