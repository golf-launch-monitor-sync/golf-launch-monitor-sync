// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script of the app's tour window, as it runs inside the site's page (injected before the page's own scripts):
 * it gives the page one function, which the app calls when it wants a read (src/lib/toursPage.ts, `readScript`). Only
 * then does it read, with the extension's very reading (@glmsync/provider-tours):
 *
 * - the Pro Golf Tour (on the player's tap on *Send* or *Fetch all*, and on each page a *Fetch all* run opened): on his
 *   profile his ranking and his season's tournaments, on a tournament's page only his own line (by the name the app
 *   hands in) and the field's size. The snapshot of the page, with everyone else's names, stays in here.
 * - europeantour.com (DP World Tour, HotelPlanner Tour; once his page has loaded, after a pick, on *Send*): what his
 *   page shows now - his ranks, his results with their rounds, the season statistics. When he picks another season or
 *   tour in the page's own select, it only tells the app that he picked; the app asks for the read a moment later.
 *
 * It reads nothing before it is asked, sends the site nothing and changes nothing the page does.
 * scripts/tours-page.mjs bundles it into src/lib/toursPageScript.ts.
 */

import { europeantour, progolftour, snapshotOf, type DomDocument } from '@glmsync/provider-tours';
import { callFits, onTourSite, READ_FUNCTION, TABLE_WAIT_MS, TOUR_MESSAGE } from '../src/lib/toursPage.ts';

declare const window: {
  ReactNativeWebView?: { postMessage(data: string): void };
  document: DomDocument & { title?: unknown; addEventListener?(type: string, fn: (e: { target?: unknown }) => void, capture?: boolean): void };
  location: { href: string };
  setTimeout(fn: () => void, ms: number): unknown;
};

/** The phone's day, should the app's ask not name it (an older app's call): europeantour.com's results need it. */
function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

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
    /** His page on europeantour.com as it shows now, the table waited for a little (the site builds it after the page). */
    const readEt = (ask: string, href: string, today: string) => {
      reading = true;
      const started = Date.now();
      const look = () => {
        try {
          let snap: ReturnType<typeof snapshotOf> | null = null;
          try {
            snap = snapshotOf(window.document, href, [], europeantour.BEFORE);
          } catch {
            snap = null;
          }
          if (snap && !europeantour.shows(snap) && Date.now() - started < TABLE_WAIT_MS) {
            window.setTimeout(look, 500);
            return;
          }
          reading = false;
          const title = typeof window.document.title === 'string' ? window.document.title : '';
          const r = snap ? europeantour.readPage(snap, title, today) : null;
          post(ask, r?.kind === 'page' ? { read: r } : snap && !r ? { why: 'not_player_page' } : { why: 'changed_page' });
        } catch {
          reading = false; // never in the page's way; the app takes the read as failed after a while
        }
      };
      look();
    };
    Object.defineProperty(window, READ_FUNCTION, {
      value: (ask: unknown, who: unknown, today?: unknown) => {
        try {
          if (reading || !callFits(ask, who, today)) return;
          const href = window.location.href;
          if (europeantour.playerPageOf(href)) {
            readEt(ask, href, typeof today === 'string' ? today : localDay());
            return;
          }
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
    // europeantour.com: another season or tour picked in the page's own select. Only that he picked goes to the app
    // (nothing read, nothing of his); the app asks for the read a moment later, once the site shows the new table.
    window.document.addEventListener?.(
      'change',
      (e) => {
        try {
          const tag = (e?.target as { tagName?: unknown } | undefined)?.tagName;
          if (typeof tag !== 'string' || tag.toLowerCase() !== 'select' || !europeantour.playerPageOf(window.location.href)) return;
          window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: TOUR_MESSAGE, picked: true }));
        } catch {
          // never in the page's way
        }
      },
      true,
    );
  }
} catch {
  // never in the page's way
}
