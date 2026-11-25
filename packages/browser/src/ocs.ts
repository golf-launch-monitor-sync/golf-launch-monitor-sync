// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a client keeps of a player's own pages of the Ladies European Tour and the LET Access Series
 * (`ocs` of `@glmsync/provider-tours`), between the pages she opens: per tour her profile as last read and her line of
 * that tour's Order of Merit. Kept in the client's own storage (no web page reaches it: the extension's storage, the
 * companion app's), only of the profile she opened herself: a profile of another player replaces it, and her Order of
 * Merit line with it. The extension's background holds one, the companion app's tour window another.
 *
 * Everything arrives from a page's script and is read again strictly (`checkProfile`, `checkOom`). Pure apart from the
 * storage it is handed, so it is tested without a browser.
 */

import type { Storage } from '@glmsync/core';
import { ocs, type TourPage } from '@glmsync/provider-tours';

type Site = ocs.OcsTourSite;

interface Kept {
  profile: ocs.Profile | null;
  oom: ocs.OomLine | null;
}

/** What the line on the site's pages shows of it. */
export interface OcsView {
  /** Whose profile was read last on this tour: the Order of Merit page looks for her line by this id. */
  who: { id: string; name: string; season: number } | null;
  /** Her rank of that season's Order of Merit, when its page was read. */
  rank: number | null;
  /** Tournaments of the profile with rounds. */
  read: number;
}

export type OcsSeen = { profile: unknown } | { oom: unknown };

const keyOf = (site: Site) => `tours:${ocs.SITES[site].tour}`;
const empty = (): Kept => ({ profile: null, oom: null });

export class OcsKeeper {
  constructor(private readonly storage: Storage) {}

  private async load(site: Site): Promise<Kept> {
    try {
      const raw = await this.storage.get(keyOf(site));
      const v = raw ? (JSON.parse(raw) as Partial<Kept>) : null;
      if (!v || typeof v !== 'object') return empty();
      const profile = ocs.checkProfile(v.profile);
      const oom = ocs.checkOom(v.oom);
      // Only what belongs to this tour and to her profile.
      return {
        profile: profile?.site === site ? profile : null,
        oom: oom?.site === site && profile && oom.player_id === profile.player_id ? oom : null,
      };
    } catch {
      // Unreadable (another version wrote it): start afresh rather than fail every page.
      return empty();
    }
  }

  private async save(site: Site, k: Kept): Promise<void> {
    await this.storage.set(keyOf(site), JSON.stringify(k));
  }

  private viewOf(k: Kept): OcsView {
    const p = k.profile;
    const rank = k.oom && p && k.oom.season === p.season ? (k.oom.rank ?? null) : null;
    return { who: p ? { id: p.player_id, name: p.player_name, season: p.season } : null, rank, read: p?.entries.length ?? 0 };
  }

  async view(site: Site): Promise<OcsView> {
    return this.viewOf(await this.load(site));
  }

  /** What a page of the tour showed. A profile of someone else replaces hers, and her Order of Merit line goes with it. */
  async seen(site: Site, s: OcsSeen): Promise<OcsView> {
    const k = await this.load(site);
    if ('profile' in s) {
      const p = ocs.checkProfile(s.profile);
      if (!p || p.site !== site) return this.viewOf(k);
      if (k.profile?.player_id !== p.player_id) k.oom = null;
      k.profile = p;
    } else {
      const l = ocs.checkOom(s.oom);
      // Only her line, of the profile read last on this tour.
      if (!l || l.site !== site || !k.profile || l.player_id !== k.profile.player_id) return this.viewOf(k);
      k.oom = l;
    }
    await this.save(site, k);
    return this.viewOf(k);
  }

  /** The page to send now: her profile with every finished tournament, and her rank when that season's line was read. */
  async page(site: Site, today: string): Promise<TourPage | null> {
    const k = await this.load(site);
    return k.profile ? ocs.siteRead(k.profile, k.oom, today) : null;
  }
}
