// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The pages of a pro a client sends (spec/prores.md): a world ranking's (`@glmsync/provider-rankings`) or a tour's
 * (`@glmsync/provider-tours`), each read again strictly by its own module and made into a batch by it. One subject
 * rule for both: `<site>:<the site's id of the player>`.
 */

import { batchOf, checkPage, SITES, type BatchOptions, type ProPage } from '@glmsync/provider-rankings';
import { checkTourPage, isTourSite, TOUR_SITES, tourBatchOf, type TourPage } from '@glmsync/provider-tours';
import type { ProresBatch, ProSite } from '@glmsync/spec';

export type AnyProPage = ProPage | TourPage;

const siteOf = (v: unknown): unknown => (v && typeof v === 'object' ? (v as { site?: unknown }).site : undefined);

/** A page as it arrives, read again by the module of its site; none if it isn't one. */
export function checkProPage(v: unknown): AnyProPage | null {
  return isTourSite(siteOf(v)) ? checkTourPage(v) : checkPage(v);
}

export const proSubjectOf = (page: Pick<AnyProPage, 'site' | 'id'>): string => `${page.site}:${page.id}`;

export function proBatchOf(page: AnyProPage, o: BatchOptions): ProresBatch {
  return isTourSite(page.site) ? tourBatchOf(page as TourPage, o) : batchOf(page as ProPage, o);
}

/** What the player calls a site. */
export function siteNameOf(site: ProSite): string {
  if (isTourSite(site)) return TOUR_SITES[site]?.name ?? site;
  return site === 'owgr' || site === 'rolex' ? SITES[site].name : site;
}
