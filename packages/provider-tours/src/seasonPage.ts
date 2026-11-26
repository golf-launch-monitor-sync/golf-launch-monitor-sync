// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The tours whose player page shows a whole season with its rounds (`season.ts`), as one: where a client's script
 * runs, which page is a player's, what to take from it, and the read. A client (the extension's
 * `season-content.ts`, the companion app's page script) asks only this; a tour of the same kind is one more line in `READERS`.
 */

import type { Wanted } from './figures.ts';
import * as lpga from './lpga.ts';
import type { TourSite } from './page.ts';
import * as pgatour from './pgatour.ts';
import type { SeasonRead } from './season.ts';
import type { Snapshot } from './snapshot.ts';

interface Reader {
  origins: readonly string[];
  matches: readonly string[];
  labels: readonly string[];
  figures: readonly Wanted[];
  /** The tour of a player's results page (before it is read: by its address), null for any other page. */
  siteOf(url: string): TourSite | null;
  read(snap: Snapshot, figures: Readonly<Record<string, string>>, today: string): SeasonRead;
}

const READERS: readonly Reader[] = [
  {
    origins: [pgatour.ORIGIN],
    matches: pgatour.PAGE_MATCHES,
    labels: pgatour.LABELS,
    figures: pgatour.FIGURES,
    siteOf: (url) => {
      const at = pgatour.resultsPageOf(url);
      return at?.tour ? `tour:${at.tour}` : null;
    },
    read: pgatour.readResults,
  },
  {
    origins: [lpga.SITES.lpga.origin, lpga.SITES.epson.origin],
    matches: lpga.PAGE_MATCHES,
    labels: lpga.LABELS,
    figures: lpga.FIGURES,
    siteOf: (url) => {
      const at = lpga.resultsPageOf(url);
      return at ? `tour:${lpga.SITES[at.site].tour}` : null;
    },
    read: lpga.readResults,
  },
];

/** Their tours: read from the *Results* page on *Send* (the extension's `season-content.ts`, the companion app's `seasonSession.ts`). */
export const SEASON_SITES: readonly TourSite[] = ['tour:pga_tour', 'tour:korn_ferry', 'tour:lpga', 'tour:epson'];
export const isSeasonSite = (site: unknown): boolean => typeof site === 'string' && (SEASON_SITES as readonly string[]).includes(site);

/** Where a client's script runs for them. */
export const SEASON_PAGE_MATCHES: readonly string[] = READERS.flatMap((r) => r.matches);

const originOf = (url: unknown): string | null => {
  if (typeof url !== 'string' || url.length > 4096) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
const readerOf = (url: unknown): Reader | null => {
  const o = originOf(url);
  return o ? (READERS.find((r) => r.origins.includes(o)) ?? null) : null;
};

/** Whether an address is on one of these sites (any page of it). */
export const onSeasonSite = (url: unknown): boolean => readerOf(url) !== null;

/** The tour of a player's results page on these sites, null for any other page. */
export function seasonSiteOf(url: unknown): TourSite | null {
  const r = readerOf(url);
  return r && typeof url === 'string' ? r.siteOf(url) : null;
}

/** What to take from the page at `url` before the read: the labels whose values follow them, the figures. */
export function seasonTakes(url: unknown): { labels: readonly string[]; figures: readonly Wanted[] } {
  const r = readerOf(url);
  return r ? { labels: r.labels, figures: r.figures } : { labels: [], figures: [] };
}

/** The read of a player's results page (by the snapshot's address). */
export function readSeasonPage(snap: Snapshot, figures: Readonly<Record<string, string>>, today: string): SeasonRead {
  const r = readerOf(snap.url);
  return r ? r.read(snap, figures, today) : { kind: 'unread', why: 'changed_page' };
}
