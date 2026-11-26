// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a client keeps of a player's own pages of the Ladies European Tour and the LET Access Series
 * (`ocs` of `@glmsync/provider-tours`), between the pages she opens: per tour her profile of each season read and her
 * line of each season's Order of Merit. Kept in the client's own storage (no web page reaches it: the extension's
 * storage, the companion app's), only of the profile she opened herself: a profile of another player replaces it all.
 * The extension's background holds one, the companion app's tour window another.
 *
 * A season picked on her profile (by her, or by *Fetch all*: `ocs-run` of `@glmsync/provider-tours`) is kept beside
 * the others, so a send has every season read: their tournaments, and the ranking of the newest.
 *
 * Everything arrives from a page's script and is read again strictly (`checkProfile`, `checkOom`). Pure apart from the
 * storage it is handed, so it is tested without a browser.
 */

import type { Storage } from '@glmsync/core';
import { ocs, type TourPage } from '@glmsync/provider-tours';
import type { ProTournament } from '@glmsync/spec';

type Site = ocs.OcsTourSite;

/** Seasons kept at most (the reach of *Fetch all* is three, a few more picked by hand). */
const MOST_SEASONS = 6;

interface Kept {
  /** Her profile per season, newest season first. */
  profiles: ocs.Profile[];
  /** Her line of each season's Order of Merit, of the same player. */
  ooms: ocs.OomLine[];
  /** The season of the profile read last: whose line the Order of Merit page looks for, what the line speaks of. */
  last: number | null;
}

/** What the line on the site's pages shows of it. */
export interface OcsView {
  /** Whose profile was read last on this tour: the Order of Merit page looks for her line by this id. */
  who: { id: string; name: string; season: number } | null;
  /** Her rank of that season's Order of Merit, when its page was read. */
  rank: number | null;
  /** Tournaments of that profile with rounds. */
  read: number;
}

export type OcsSeen = { profile: unknown } | { oom: unknown };

const keyOf = (site: Site) => `tours:${ocs.SITES[site].tour}`;
const empty = (): Kept => ({ profiles: [], ooms: [], last: null });

export class OcsKeeper {
  constructor(private readonly storage: Storage) {}

  private async load(site: Site): Promise<Kept> {
    try {
      const raw = await this.storage.get(keyOf(site));
      const v = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
      if (!v || typeof v !== 'object') return empty();
      // Until extension 0.20.0 one profile and one line were kept (`profile`, `oom`): read as one season.
      const rawProfiles = Array.isArray(v.profiles) ? v.profiles.slice(0, MOST_SEASONS) : v.profile ? [v.profile] : [];
      const rawOoms = Array.isArray(v.ooms) ? v.ooms.slice(0, MOST_SEASONS) : v.oom ? [v.oom] : [];
      // Only what belongs to this tour and to one player: hers of the newest profile.
      const profiles = rawProfiles.map((x) => ocs.checkProfile(x)).filter((p): p is ocs.Profile => p?.site === site);
      const id = profiles[0]?.player_id;
      const mine = profiles.filter((p) => p.player_id === id);
      const ooms = rawOoms.map((x) => ocs.checkOom(x)).filter((l): l is ocs.OomLine => l?.site === site && l.player_id === id);
      const last = typeof v.last === 'number' && mine.some((p) => p.season === v.last) ? v.last : (mine[0]?.season ?? null);
      return { profiles: mine, ooms, last };
    } catch {
      // Unreadable (another version wrote it): start afresh rather than fail every page.
      return empty();
    }
  }

  private async save(site: Site, k: Kept): Promise<void> {
    await this.storage.set(keyOf(site), JSON.stringify(k));
  }

  private viewOf(k: Kept): OcsView {
    const p = k.profiles.find((x) => x.season === k.last) ?? k.profiles[0];
    if (!p) return { who: null, rank: null, read: 0 };
    const rank = k.ooms.find((l) => l.season === p.season)?.rank ?? null;
    return { who: { id: p.player_id, name: p.player_name, season: p.season }, rank, read: p.entries.length };
  }

  async view(site: Site): Promise<OcsView> {
    return this.viewOf(await this.load(site));
  }

  /** What a page of the tour showed. A profile of someone else replaces hers, and her Order of Merit lines go with it. */
  async seen(site: Site, s: OcsSeen): Promise<OcsView> {
    const k = await this.load(site);
    if ('profile' in s) {
      const p = ocs.checkProfile(s.profile);
      if (!p || p.site !== site) return this.viewOf(k);
      if (k.profiles[0] && k.profiles[0].player_id !== p.player_id) {
        k.profiles = [];
        k.ooms = [];
      }
      k.profiles = [p, ...k.profiles.filter((x) => x.season !== p.season)].sort((a, b) => b.season - a.season).slice(0, MOST_SEASONS);
      k.last = p.season;
    } else {
      const l = ocs.checkOom(s.oom);
      // Only her line, of the profile read last on this tour.
      if (!l || l.site !== site || !k.profiles[0] || l.player_id !== k.profiles[0].player_id) return this.viewOf(k);
      k.ooms = [l, ...k.ooms.filter((x) => x.season !== l.season)].sort((a, b) => b.season - a.season).slice(0, MOST_SEASONS);
    }
    await this.save(site, k);
    return this.viewOf(k);
  }

  /**
   * The page to send now: every finished tournament of the seasons read, and the ranking of the newest season (with
   * her rank once that season's line was read).
   */
  async page(site: Site, today: string): Promise<TourPage | null> {
    const k = await this.load(site);
    const [newest] = k.profiles;
    if (!newest) return null;
    const oomOf = (season: number) => k.ooms.find((l) => l.season === season) ?? null;
    const page = ocs.siteRead(newest, oomOf(newest.season), today);
    // The newest season first, each in the order her profile shows it; a tournament once.
    const byRef = new Map<string, ProTournament>();
    for (const p of k.profiles) for (const t of ocs.siteRead(p, oomOf(p.season), today).tournaments) if (!byRef.has(t.ref)) byRef.set(t.ref, t);
    return { ...page, tournaments: [...byRef.values()] };
  }
}
