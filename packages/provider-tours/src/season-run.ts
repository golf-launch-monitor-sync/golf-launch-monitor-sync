// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the season pages (PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour; `run.ts`): on his *Results* page
 * each season of the reach picked in the page's own *Season* picker (on pgatour.com for each of its two tours, picked
 * in its *Tour* picker), then the same on his *Stats* page, opened by the address of the page's own tab. The pickers
 * are drawn by the sites (pgatour.com a menu, lpga.com and epsontour.com a list box): `operate.ts` opens them and picks
 * the entry. A season he didn't play isn't offered and is skipped.
 */

import * as lpga from './lpga.ts';
import * as pgatour from './pgatour.ts';
import { seasonsOf, type PickStep } from './run.ts';

export type SeasonFamily = 'pgatour' | 'lpga' | 'epson';

const PGA = /^https:\/\/www\.pgatour\.com\/(?:(?:korn-ferry-tour|americas|pgatour-champions)\/)?player\/([0-9]{1,10})\/([a-z0-9-]{1,120})\/(?:results|stats)\/?(?:[?#].*)?$/;
const LPGA = /^https:\/\/www\.(lpga|epsontour)\.com\/athletes\/([a-z0-9-]{1,120})\/([0-9]{1,10})\/(?:results|stats)\/?(?:[?#].*)?$/;
/** pgatour.com's *Tour* picker: the two tours prores/1 has. */
const PGA_TOURS = ['PGA Tour', 'Korn Ferry Tour'] as const;

function seasonPicks(page: string, picker: string, today: string, tour?: string): PickStep[] {
  const steps: PickStep[] = [];
  if (tour) steps.push({ key: `${page}:${tour}`, do: 'pick', picker: 'Tour', value: tour });
  for (const s of seasonsOf(today)) steps.push({ key: `${page}:${tour ?? ''}:${s}`, do: 'pick', picker, value: String(s) });
  return steps;
}

/** The run on his results or stats page at `url` (`today`: the player's day); none on any other page. */
export function planOf(url: string, today: string): { family: SeasonFamily; player_id: string; steps: PickStep[] } | null {
  const p = PGA.exec(url);
  if (p?.[1] && p[2]) {
    const base = `${pgatour.ORIGIN}/player/${p[1]}/${p[2]}`;
    const steps: PickStep[] = [{ key: 'results', do: 'open', url: `${base}/results` }];
    for (const tour of PGA_TOURS) steps.push(...seasonPicks('results', 'Season', today, tour));
    steps.push({ key: 'stats', do: 'open', url: `${base}/stats` });
    for (const tour of PGA_TOURS) steps.push(...seasonPicks('stats', 'Season', today, tour));
    return { family: 'pgatour', player_id: p[1], steps };
  }
  const l = LPGA.exec(url);
  if (l?.[1] && l[2] && l[3]) {
    const family: SeasonFamily = l[1] === 'lpga' ? 'lpga' : 'epson';
    const base = `${lpga.SITES[family].origin}/athletes/${l[2]}/${l[3]}`;
    return {
      family,
      player_id: l[3],
      steps: [
        { key: 'results', do: 'open', url: `${base}/results` },
        ...seasonPicks('results', 'Seasons', today),
        { key: 'stats', do: 'open', url: `${base}/stats` },
        ...seasonPicks('stats', 'Seasons', today),
      ],
    };
  }
  return null;
}

/** The player of a results or stats page on these sites, by its address. */
export function playerOf(url: string): string | null {
  return PGA.exec(url)?.[1] ?? LPGA.exec(url)?.[3] ?? null;
}

/** A run opens only his own results and stats pages on that site. */
export function mayOpen(family: SeasonFamily, playerId: string, url: string): boolean {
  if (family === 'pgatour') {
    const at = pgatour.resultsPageOf(url) ?? pgatour.statsPageOf(url);
    return at?.id === playerId;
  }
  const at = lpga.resultsPageOf(url) ?? lpga.statsPageOf(url);
  return !!at && at.site === family && at.id === playerId;
}
