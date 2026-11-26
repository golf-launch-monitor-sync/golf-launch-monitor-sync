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
 * - the LET and the LET Access Series (once her page has loaded, on *Send*): on her profile her results of the season
 *   shown with every round, on the tour's Order of Merit only her own line (by the profile's id the app hands in). The
 *   sites change their address without loading a page: the script looks at it every second and tells the app only that
 *   it changed (nothing read); the app asks for the read of the new page.
 * - PGA Tour and Korn Ferry Tour, LPGA Tour and Epson Tour (on the player's tap on *Send*): on his *Results* page the
 *   season it shows, with its rounds and the standing beside it - the leaderboard of others that runs along the top
 *   stays in here. These sites move between their pages without loading them too: watched as the LET's.
 * - the Alps Tour (once his profile has loaded, after a pick, on *Send*): the report his profile shows now (*This Season
 *   record*, *Results*, *Order of Merit*), with his name. When he picks another report in the page's own select, it only
 *   tells the app that he picked; the app asks for the read a moment later. The site moves without loading pages too:
 *   watched as the LET's.
 *
 * It reads nothing before it is asked, sends the site nothing and changes nothing the page does.
 * scripts/tours-page.mjs bundles it into src/lib/toursPageScript.ts.
 */

import { alps, europeantour, figuresOf, ocs, progolftour, readSeasonPage, seasonShows, seasonSiteOf, seasonTakes, snapshotOf, type DomDocument, type FigureDocument, type Snapshot } from '@glmsync/provider-tours';
import { callFits, isAlps, isOcs, isSeason, onTourSite, READ_FUNCTION, TABLE_WAIT_MS, tourSiteOf, TOUR_MESSAGE, watchedSite, WATCH_MS } from '../src/lib/toursPage.ts';

declare const window: {
  ReactNativeWebView?: { postMessage(data: string): void };
  document: DomDocument & { title?: unknown; addEventListener?(type: string, fn: (e: { target?: unknown }) => void, capture?: boolean): void };
  location: { href: string };
  setTimeout(fn: () => void, ms: number): unknown;
  setInterval?(fn: () => void, ms: number): unknown;
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
    /**
     * Her page on the LET's sites as it shows now, waited for a little until `ready` (the site draws it after the page,
     * or after a change of its address). Only what is hers goes: her profile, or her line of the Order of Merit.
     */
    const readOcs = (ask: string, href: string, who: unknown) => {
      const oomOf = typeof who === 'string' && /^[0-9]{3,10}$/.test(who) ? who : null;
      const profile = ocs.profileIdOf(href) !== null;
      if (!profile && !(ocs.isOomPage(href) && oomOf)) {
        post(ask, { why: 'not_player_page' });
        return;
      }
      const readOf = (snap: Snapshot) => (profile ? ocs.readProfile(snap) : ocs.readOom(snap, oomOf as string));
      reading = true;
      const started = Date.now();
      const look = () => {
        try {
          let snap: Snapshot | null = null;
          try {
            snap = snapshotOf(window.document, href);
          } catch {
            snap = null;
          }
          const r = snap ? readOf(snap) : null;
          if (snap && r?.kind !== 'profile' && r?.kind !== 'oom' && Date.now() - started < TABLE_WAIT_MS) {
            window.setTimeout(look, 500);
            return;
          }
          reading = false;
          // The snapshot, with everyone else's names on the Order of Merit, stays here.
          post(ask, r?.kind === 'profile' || r?.kind === 'oom' ? { ocs: r } : r?.kind === 'unread' && r.why !== 'changed_page' ? { ocsUnread: r.why } : { why: 'changed_page' });
        } catch {
          reading = false; // never in the page's way; the app takes the read as failed after a while
        }
      };
      look();
    };
    /**
     * His *Results* or *Stats* page on a season page's tour as it shows now, its table waited for a little (the site
     * puts it in a moment after the page): the season the page shows (its tournaments, or its statistics), with the
     * standing beside it. Only his page goes.
     */
    const readSeason = (ask: string, href: string, today: string) => {
      if (!seasonSiteOf(href)) {
        post(ask, { why: 'not_player_page' });
        return;
      }
      const takes = seasonTakes(href);
      reading = true;
      const started = Date.now();
      const look = () => {
        try {
          let snap: Snapshot | null = null;
          try {
            snap = snapshotOf(window.document, href, takes.labels);
          } catch {
            snap = null;
          }
          if (snap && !seasonShows(snap) && Date.now() - started < TABLE_WAIT_MS) {
            window.setTimeout(look, 500);
            return;
          }
          reading = false;
          let r: ReturnType<typeof readSeasonPage> | null = null;
          if (snap) {
            let figures: Record<string, string> = {};
            try {
              figures = figuresOf(window.document as unknown as FigureDocument, takes.figures);
            } catch {
              figures = {}; // the standing is an addition: the season goes without it
            }
            r = readSeasonPage(snap, figures, today);
          }
          // The snapshot, with the leaderboard's names, stays here.
          post(ask, r?.kind === 'page' ? { season: r.page } : r?.kind === 'unread' && r.why !== 'changed_page' ? { seasonUnread: r.why } : { why: 'changed_page' });
        } catch {
          reading = false; // never in the page's way; the app takes the read as failed after a while
        }
      };
      look();
    };
    /**
     * His profile on the Alps Tour as it shows now, waited for a little until it shows his name and a report (the site
     * draws it after the page, or after a change of its address): the report picked there. Only his profile goes.
     */
    const readAlps = (ask: string, href: string) => {
      if (!alps.profileIdOf(href)) {
        post(ask, { why: 'not_player_page' });
        return;
      }
      reading = true;
      const started = Date.now();
      const look = () => {
        try {
          let snap: Snapshot | null = null;
          try {
            snap = alps.snapshotAt(window.document, href);
          } catch {
            snap = null;
          }
          if (snap && !alps.shows(snap) && Date.now() - started < TABLE_WAIT_MS) {
            window.setTimeout(look, 500);
            return;
          }
          reading = false;
          // He went on meanwhile (the site moves without loading a page): that page is read when the app asks for it.
          if (window.location.href !== href) {
            post(ask, { why: 'not_player_page' });
            return;
          }
          const r = snap ? alps.readPage(snap) : null;
          post(ask, r?.kind === 'alps' ? { alps: r } : { why: 'changed_page' });
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
          if (isOcs(tourSiteOf(href))) {
            readOcs(ask, href, who);
            return;
          }
          if (isSeason(tourSiteOf(href))) {
            readSeason(ask, href, typeof today === 'string' ? today : localDay());
            return;
          }
          if (isAlps(tourSiteOf(href))) {
            readAlps(ask, href);
            return;
          }
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
    // europeantour.com: another season or tour picked in the page's own select; the Alps Tour: another report. Only that
    // he picked goes to the app (nothing read, nothing of his); the app asks for the read a moment later, once the site
    // shows the new table.
    window.document.addEventListener?.(
      'change',
      (e) => {
        try {
          const tag = (e?.target as { tagName?: unknown } | undefined)?.tagName;
          const at = window.location.href;
          if (typeof tag !== 'string' || tag.toLowerCase() !== 'select' || !(europeantour.playerPageOf(at) || (isAlps(tourSiteOf(at)) && alps.profileIdOf(at)))) return;
          window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: TOUR_MESSAGE, picked: true }));
        } catch {
          // never in the page's way
        }
      },
      true,
    );
    // The LET's sites, the season pages' and the Alps Tour's change their address without loading a page, which the web view doesn't
    // always tell the app: only that it changed goes (nothing read, nothing of the player's); the app takes the new page.
    if (watchedSite(window.location.href)) {
      let here = window.location.href;
      window.setInterval?.(() => {
        try {
          if (window.location.href === here) return;
          here = window.location.href;
          window.ReactNativeWebView?.postMessage(JSON.stringify({ glmsync: TOUR_MESSAGE, moved: true }));
        } catch {
          // never in the page's way
        }
      }, WATCH_MS);
    }
  }
} catch {
  // never in the page's way
}
