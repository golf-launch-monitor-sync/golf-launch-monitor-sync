// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the Ladies European Tour and the LET Access Series (`run.ts`): on her profile, each season of the reach
 * picked in its select (her rounds), then the tour's Order of Merit of each of those seasons, by the address the site
 * writes for it, where only her own line is read (by the link to her profile). Nothing else is opened.
 */

import { isOomPage, profileIdOf, siteAt, SITES, type OcsTourSite } from './ocs.ts';
import { seasonsOf, type PickStep } from './run.ts';

/** The Order of Merit's own name in its address (`oom=`), per tour. */
const OOM_CODE: Readonly<Record<OcsTourSite, string>> = { 'tour:let': 'PT', 'tour:let_access': 'LO' };

/** The run on her profile at `url` (`today`: the player's day); none on any other page. Its family is the tour. */
export function planOf(url: string, today: string): { family: OcsTourSite; player_id: string; steps: PickStep[] } | null {
  const site = siteAt(url);
  const id = profileIdOf(url);
  if (!site || !id) return null;
  const seasons = seasonsOf(today);
  const steps: PickStep[] = seasons.map((s) => ({ key: `profile:${s}`, do: 'pick', picker: null, value: `${s} Season` }));
  for (const s of seasons) steps.push({ key: `oom:${s}`, do: 'open', url: `${site.origin}${site.oom}?id=${s}&oom=${OOM_CODE[site.site]}` });
  return { family: site.site, player_id: id, steps };
}

/** A run opens only that tour's Order of Merit and her own profile. */
export function mayOpen(family: OcsTourSite, playerId: string, url: string): boolean {
  if (siteAt(url)?.site !== family || !Object.hasOwn(SITES, family)) return false;
  return isOomPage(url) || profileIdOf(url) === playerId;
}
