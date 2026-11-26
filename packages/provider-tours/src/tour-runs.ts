// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The tours' runs of *Fetch all* together (`run.ts`): which tour's run a page starts (its family: the client keeps
 * three runs a day of each), its plan, and the addresses it may open. Each tour's own steps are in its own file.
 */

import * as alpsRun from './alps-run.ts';
import { onSite as onAlps } from './alps.ts';
import * as europeantourRun from './europeantour-run.ts';
import { ORIGIN as ET_ORIGIN } from './europeantour.ts';
import * as lpga from './lpga.ts';
import { isOcsSite, siteAt } from './ocs.ts';
import * as ocsRun from './ocs-run.ts';
import type { TourSite } from './page.ts';
import * as pgatour from './pgatour.ts';
import type { PickStep } from './run.ts';
import * as seasonRun from './season-run.ts';

export { playerOf as seasonPlayerOf } from './season-run.ts';

export type RunFamily = 'alps' | 'europeantour' | 'tour:let' | 'tour:let_access' | seasonRun.SeasonFamily;
export const RUN_FAMILIES: readonly RunFamily[] = ['alps', 'europeantour', 'tour:let', 'tour:let_access', 'pgatour', 'lpga', 'epson'];
export const isRunFamily = (v: unknown): v is RunFamily => typeof v === 'string' && (RUN_FAMILIES as readonly string[]).includes(v);

/** The sites a family's run sends (one page each, where something was read). */
export const SITES_OF: Readonly<Record<RunFamily, readonly TourSite[]>> = {
  alps: ['tour:alps'],
  europeantour: ['tour:dp_world', 'tour:hotelplanner'],
  'tour:let': ['tour:let'],
  'tour:let_access': ['tour:let_access'],
  pgatour: ['tour:pga_tour', 'tour:korn_ferry'],
  lpga: ['tour:lpga'],
  epson: ['tour:epson'],
};

export interface RunPlan {
  family: RunFamily;
  player_id: string;
  steps: PickStep[];
}

/** The run a page of his at `url` would start (`today`: the player's day); none where there is none. */
export function runPlanOf(url: string, today: string): RunPlan | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const alps = alpsRun.planOf(url);
    if (alps) return { family: 'alps', ...alps };
    const et = europeantourRun.planOf(url, today);
    if (et) return { family: 'europeantour', ...et };
    const ocs = ocsRun.planOf(url, today);
    if (ocs) return ocs;
    return seasonRun.planOf(url, today);
  } catch {
    return null;
  }
}

/** The tour whose run a page of that site belongs to (any page of it), or none. */
export function runFamilyOf(url: string): RunFamily | null {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return null;
  }
  if (onAlps(url)) return 'alps';
  if (origin === ET_ORIGIN) return 'europeantour';
  const ocs = siteAt(url);
  if (ocs) return ocs.site;
  if (origin === pgatour.ORIGIN) return 'pgatour';
  if (origin === lpga.SITES.lpga.origin) return 'lpga';
  if (origin === lpga.SITES.epson.origin) return 'epson';
  return null;
}

/** Whether a family's run, started on `playerId`'s page, may open `url`. */
export function runMayOpen(family: RunFamily, playerId: string, url: string): boolean {
  if (typeof url !== 'string' || url.length > 2048) return false;
  switch (family) {
    case 'alps':
      return alpsRun.mayOpen();
    case 'europeantour':
      return europeantourRun.mayOpen(playerId, url);
    case 'tour:let':
    case 'tour:let_access':
      return isOcsSite(family) && ocsRun.mayOpen(family, playerId, url);
    default:
      return seasonRun.mayOpen(family, playerId, url);
  }
}
