// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the Alps Tour (`run.ts`): on his profile, the three reports he would pick under *Select Report*, one
 * after the other - *This Season record* (his rounds), *Results* (the totals to par, for the par) and *Order of Merit*
 * (his rank) - each read as the page shows it and kept merged (`mergeRead`). Nothing is opened: the profile shows the
 * running season only (decision 51's two years reach no further here; earlier seasons have no rounds on the profile).
 */

import { FAMILY, profileIdOf } from './alps.ts';
import type { PickStep } from './run.ts';

export { FAMILY };
/** The reports, as the site's select writes them. */
export const REPORTS = ['This Season record', 'Results', 'Order of Merit'] as const;

/** The run on his profile at `url`; none on any other page. */
export function planOf(url: string): { player_id: string; steps: PickStep[] } | null {
  const id = profileIdOf(url);
  if (!id) return null;
  return { player_id: id, steps: REPORTS.map((value) => ({ key: `report:${value}`, do: 'pick', picker: null, value })) };
}

/** A run here opens nothing. */
export const mayOpen = (): boolean => false;
