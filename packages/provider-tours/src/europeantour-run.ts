// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on europeantour.com (DP World Tour, HotelPlanner Tour; `run.ts`): what he would open and pick on his own
 * pages - the overview of each tour (its rank, points and tournaments played), *Wins & Results* with each season of the
 * reach picked in its select (the rounds), and *Stats* with each tour picked in its select (the season statistics).
 * Only his own pages, by the addresses the site's own tabs use; a season he didn't play isn't offered and is skipped.
 */

import { ORIGIN, playerPageOf } from './europeantour.ts';
import { seasonsOf, type PickStep } from './run.ts';

export const FAMILY = 'europeantour';
/** The address's name of each tour, and the name its select on *Stats* writes. */
const TOURS = [
  { path: 'dpworld-tour', name: 'DP World Tour' },
  { path: 'hotelplanner-tour', name: 'HotelPlanner Tour' },
] as const;

const PLAYER = /^\/players\/([a-z0-9-]{1,150}?-[0-9]{1,10})\/?/;

/** The run on a page of his at `url` (`today`: the player's day); none on any other page. */
export function planOf(url: string, today: string): { player_id: string; steps: PickStep[] } | null {
  const at = playerPageOf(url);
  const slug = at ? PLAYER.exec(new URL(url).pathname)?.[1] : undefined;
  if (!at || !slug) return null;
  const base = `${ORIGIN}/players/${slug}/`;
  const steps: PickStep[] = [];
  for (const t of TOURS) steps.push({ key: `overview:${t.path}`, do: 'open', url: `${base}?tour=${t.path}` });
  steps.push({ key: 'results', do: 'open', url: `${base}results/?tour=${TOURS[0].path}` });
  // The DP World Tour's season starts in November: next year's may already be there.
  for (const season of seasonsOf(today, true)) steps.push({ key: `results:${season}`, do: 'pick', picker: null, value: String(season) });
  steps.push({ key: 'stats', do: 'open', url: `${base}stats/?tour=${TOURS[0].path}` });
  for (const t of TOURS) steps.push({ key: `stats:${t.path}`, do: 'pick', picker: null, value: t.name });
  return { player_id: at.id, steps };
}

/** A run opens only his own pages on the site. */
export function mayOpen(playerId: string, url: string): boolean {
  return playerPageOf(url)?.id === playerId;
}
