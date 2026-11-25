// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the extension keeps of a player's own pages on europeantour.com (DP World Tour, HotelPlanner Tour;
 * `@glmsync/provider-tours`), between the pages he opens: what each of his pages showed (his ranks, his results with
 * their rounds of the seasons he picked, his season statistics), merged. Kept in the extension's own storage (no web
 * page reaches it), only of the player whose page he opened: another player's page replaces it all.
 *
 * Everything arrives from a content script and is read again strictly (`checkRead`). Pure apart from the storage it is
 * handed, so it is tested without a browser. Unlike the Pro Golf Tour there is nothing to fetch: his results page
 * has the rounds, a season at a time, as he picks it.
 */

import type { Storage } from '@glmsync/core';
import { europeantour, type TourPage, type TourSite } from '@glmsync/provider-tours';

const KEY = 'tours:europeantour';

/** What the line on the site's page shows of it. */
export interface EtView {
  /** The name of the page read last: whose tournaments are kept. */
  who: string | null;
  /** His tournaments with their rounds kept, per tour. */
  tournaments: Partial<Record<TourSite, number>>;
  /** The tours a *Send* just sent (each a page of its own); only in the answer to it. */
  sent?: TourSite[];
}

export class EtKeeper {
  constructor(private readonly storage: Storage) {}

  private async load(): Promise<europeantour.EtRead | null> {
    try {
      const raw = await this.storage.get(KEY);
      return raw ? europeantour.checkRead(JSON.parse(raw)) : null;
    } catch {
      // Unreadable (another version wrote it): start afresh rather than fail every page.
      return null;
    }
  }

  private viewOf(k: europeantour.EtRead | null): EtView {
    const tournaments: Partial<Record<TourSite, number>> = {};
    for (const t of k?.tournaments ?? []) {
      const site = t.tour === 'dp_world' || t.tour === 'hotelplanner' ? europeantour.SITE[t.tour] : null;
      if (site) tournaments[site] = (tournaments[site] ?? 0) + 1;
    }
    return { who: k?.player_name ?? null, tournaments };
  }

  async view(): Promise<EtView> {
    return this.viewOf(await this.load());
  }

  /** What a page of his showed; a read that doesn't hold is ignored. */
  async seen(raw: unknown): Promise<EtView> {
    const read = europeantour.checkRead(raw);
    const kept = await this.load();
    if (!read) return this.viewOf(kept);
    const next = europeantour.mergeRead(kept, read);
    await this.storage.set(KEY, JSON.stringify(next));
    return this.viewOf(next);
  }

  /** The pages to send now: one per tour with something of it. */
  async pages(today: string): Promise<TourPage[]> {
    const k = await this.load();
    return k ? europeantour.pagesOf(k, today) : [];
  }
}
