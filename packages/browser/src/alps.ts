// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a client keeps of a player's own profile on the Alps Tour (`alps` of `@glmsync/provider-tours`), between the
 * reports he picks there: *This Season record* (his rounds), *Results* (the totals to par, for the par) and *Order of
 * Merit* (his rank), merged. Kept in the client's own storage (no web page reaches it), only of the profile he opened:
 * another player's profile replaces it all.
 *
 * Everything arrives from a page's script and is read again strictly (`checkRead`). Pure apart from the storage it is
 * handed, so it is tested without a browser.
 */

import type { Storage } from '@glmsync/core';
import { alps, type TourPage } from '@glmsync/provider-tours';
import type { T } from './i18n.ts';

const KEY = 'tours:alps';

/** What the line on his profile shows of it. */
export interface AlpsView {
  /** Whose profile was read last. */
  who: string | null;
  /** Tournaments of *This Season record* with their rounds; null while that report wasn't read. */
  read: number | null;
  /** Whether *Results* gave the totals (for the par). */
  totals: boolean;
  /** His rank of the season read, once *Order of Merit* was. */
  rank: number | null;
}

export class AlpsKeeper {
  constructor(private readonly storage: Storage) {}

  private async load(): Promise<alps.AlpsRead | null> {
    try {
      const raw = await this.storage.get(KEY);
      return raw ? alps.checkRead(JSON.parse(raw)) : null;
    } catch {
      // Unreadable (another version wrote it): start afresh rather than fail every page.
      return null;
    }
  }

  private viewOf(k: alps.AlpsRead | null): AlpsView {
    const season = k ? alps.seasonOf(k) : undefined;
    const rank = k?.oom.find((l) => l.season === season)?.rank ?? null;
    return { who: k?.player_name ?? null, read: k?.record?.length ?? null, totals: (k?.totals.length ?? 0) > 0, rank };
  }

  async view(): Promise<AlpsView> {
    return this.viewOf(await this.load());
  }

  /** What a report of his profile showed; a read that doesn't hold is ignored. */
  async seen(raw: unknown): Promise<AlpsView> {
    const read = alps.checkRead(raw);
    const kept = await this.load();
    if (!read) return this.viewOf(kept);
    const next = alps.mergeRead(kept, read);
    await this.storage.set(KEY, JSON.stringify(next));
    return this.viewOf(next);
  }

  /** The page to send now, or none when nothing was read that could go. */
  async page(today: string): Promise<TourPage | null> {
    const k = await this.load();
    return k ? alps.pageOf(k, today) : null;
  }
}

/**
 * What the line on his profile says while nothing is being sent: which report to pick while his rounds weren't read
 * (or *Fetch all*, where the client offers it), else how many tournaments go and what came with them (the par, his rank).
 */
export function alpsNote(v: AlpsView, t: T, fetchAll = false): string {
  // Where the client offers *Fetch all* (the extension since 0.21.0), the line points to it first.
  if (v.read === null) return t(fetchAll ? 'alpsLine.fetchAll' : 'alpsLine.pickRecord');
  const more = (v.totals ? t('alpsLine.withPar') : '') + (v.rank !== null ? t('alpsLine.withRank', { rank: v.rank }) : '');
  return t('alpsLine.read', { count: v.read, more });
}
