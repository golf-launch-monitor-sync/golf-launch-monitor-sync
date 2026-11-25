// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The world rankings' pages this module reads (spec/prores.md, *Sites*): only a player's own page, by its address.
 * Nothing else of the sites - no ranking table, no search, no event page - is ever read.
 */

export type RankingSite = 'owgr' | 'rolex';

export interface SiteInfo {
  site: RankingSite;
  /** What the player calls it. */
  name: string;
  origin: string;
  /** Where the extension's content script runs: a player's page, nothing else of the site. */
  matches: readonly string[];
  /** Where the player finds their page (the site's own ranking, which has a search). */
  start: string;
}

export const SITES: Readonly<Record<RankingSite, SiteInfo>> = {
  owgr: {
    site: 'owgr',
    name: 'Official World Golf Ranking',
    origin: 'https://www.owgr.com',
    matches: ['https://www.owgr.com/playerprofile/*'],
    start: 'https://www.owgr.com/current-world-ranking',
  },
  rolex: {
    site: 'rolex',
    name: 'Rolex Women’s World Golf Rankings',
    origin: 'https://www.rolexrankings.com',
    matches: ['https://www.rolexrankings.com/players/*'],
    start: 'https://www.rolexrankings.com/rankings',
  },
};

/** Every page the extension reads along on, of every site. */
export const PAGE_MATCHES: readonly string[] = Object.values(SITES).flatMap((s) => s.matches);

/** A player's page: which site, the site's id of the player and, where the address carries it, the name it spells. */
export interface PlayerPage {
  site: RankingSite;
  id: string;
  /** OWGR's address spells the name (`/playerprofile/matt-example-17646`): its words, lower case. */
  slug?: string;
}

const OWGR_PATH = /^\/playerprofile\/([a-z0-9.'%-]{1,150})-(\d{1,10})\/?$/i;
const ROLEX_PATH = /^\/players\/(\d{1,10})\/?$/;

/** Which player page an address is, or null (any other page of the sites, any other site). */
export function playerPageOf(url: unknown): PlayerPage | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin === SITES.owgr.origin) {
    const m = OWGR_PATH.exec(u.pathname);
    if (!m?.[1] || !m[2]) return null;
    let slug: string;
    try {
      slug = decodeURIComponent(m[1]);
    } catch {
      return null;
    }
    return { site: 'owgr', id: m[2], slug: slug.toLowerCase().split('-').filter(Boolean).join(' ') };
  }
  if (u.origin === SITES.rolex.origin) {
    const m = ROLEX_PATH.exec(u.pathname);
    return m?.[1] ? { site: 'rolex', id: m[1] } : null;
  }
  return null;
}
