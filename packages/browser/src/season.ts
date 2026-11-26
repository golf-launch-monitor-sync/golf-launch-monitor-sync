// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a client keeps of the season pages (PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour; `seasonPage` of
 * `@glmsync/provider-tours`) while *Fetch all* picks its way through them: each page it read, merged into one page per
 * tour - every season's tournaments, every season's statistics, the newest standing - which goes out once when the run
 * ends, and is then forgotten (`take`). By hand, *Send* sends the page as it shows and keeps nothing.
 *
 * Everything arrives from a page's script and is read again strictly (`checkTourPage`). Pure apart from the storage it
 * is handed, so it is tested without a browser.
 */

import type { Storage } from '@glmsync/core';
import { checkTourPage, isSeasonSite, type TourPage, type TourSite } from '@glmsync/provider-tours';
import { PRORES_MAX, type ProStats, type ProTournament } from '@glmsync/spec';

const KEY = 'tours:season-run';

const newestFirst = (a: ProTournament, b: ProTournament) => ((a.start ?? '') < (b.start ?? '') ? 1 : (a.start ?? '') > (b.start ?? '') ? -1 : 0);

/** `read` over `kept`: another player's page replaces it; a tournament (by its ref) and a season's statistics the newer read. */
export function mergeSeasonPage(kept: TourPage | undefined, read: TourPage): TourPage {
  if (!kept || kept.id !== read.id || kept.site !== read.site) return read;
  const byRef = new Map(kept.tournaments.map((t) => [t.ref, t]));
  for (const t of read.tournaments) byRef.set(t.ref, t);
  const stats = new Map<string, ProStats>(kept.stats.map((s) => [`${s.tour}:${s.season}`, s]));
  for (const s of read.stats) stats.set(`${s.tour}:${s.season}`, s);
  // The standing of the newest day (the running season's is today's); on the same day the newer read, field by field.
  const ranking = read.ranking.as_of > kept.ranking.as_of ? read.ranking : read.ranking.as_of < kept.ranking.as_of ? kept.ranking : { ...kept.ranking, ...read.ranking };
  return {
    ...read,
    ranking,
    tournaments: [...byRef.values()].sort(newestFirst).slice(0, PRORES_MAX.tournaments),
    stats: [...stats.values()].sort((a, b) => b.season - a.season).slice(0, PRORES_MAX.stats),
  };
}

export class SeasonKeeper {
  constructor(private readonly storage: Storage) {}

  private async load(): Promise<TourPage[]> {
    try {
      const raw = await this.storage.get(KEY);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.slice(0, 8).map(checkTourPage).filter((p): p is TourPage => p !== null && isSeasonSite(p.site)) : [];
    } catch {
      // Unreadable (another version wrote it): start afresh.
      return [];
    }
  }

  /** A page of a season site as read; one that doesn't hold, or of another site, is ignored. */
  async seen(raw: unknown): Promise<number> {
    const page = checkTourPage(raw);
    const kept = await this.load();
    if (!page || !isSeasonSite(page.site)) return kept.length;
    const next = [...kept.filter((p) => p.site !== page.site), mergeSeasonPage(kept.find((p) => p.site === page.site), page)];
    await this.storage.set(KEY, JSON.stringify(next));
    return next.length;
  }

  /** The pages kept of `sites`, forgotten as they are handed out. */
  async take(sites: readonly TourSite[]): Promise<TourPage[]> {
    const kept = await this.load();
    const out = kept.filter((p) => sites.includes(p.site));
    await this.storage.set(KEY, JSON.stringify(kept.filter((p) => !sites.includes(p.site))));
    return out;
  }
}
