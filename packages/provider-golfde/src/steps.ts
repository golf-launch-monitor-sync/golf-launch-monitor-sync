// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The steps of *Fetch all* (clicks.ts) and the addresses a run may open: apart, so the page script of the companion
 * app bundles them without the run's rules.
 */

import { HISTORY_SHEET_URL, PAGE_ORIGIN } from './observe.ts';

/** golf.de's page of a club tournament; its result list is the address `#/<tournament>/ergebnisse` on it. */
export const RESULTS_PAGE = `${PAGE_ORIGIN}/sport/turnierkalender/clubturniere.html`;
export const resultsUrl = (tournament: string): string => `${RESULTS_PAGE}#/${tournament}/ergebnisse`;
const RESULTS_URL = /^https:\/\/www\.golf\.de\/sport\/turnierkalender\/clubturniere\.html#\/[0-9]{1,12}\/ergebnisse$/;

/** Whether an address is one a run may open: the History Sheet or a result list, nothing else. */
export function mayOpen(url: unknown): boolean {
  return typeof url === 'string' && (url === HISTORY_SHEET_URL || RESULTS_URL.test(url));
}

/** The one thing to do now. */
export type Step =
  /** Nothing yet: ask again in `ms` (the pause between pages, or the page's answer still on its way). */
  | { do: 'wait'; ms: number }
  /** Open one of golf.de's pages, as its own links do (`mayOpen`). */
  | { do: 'open'; url: string }
  /** The History Sheet's next page: golf.de's own link to it, by the cursor golf.de's page got. */
  | { do: 'page'; cursor: string }
  /** The Scoring Record: golf.de's button next to the History Sheet. */
  | { do: 'click'; what: 'scoring' }
  /** The run is over (`phase` says how). */
  | { do: 'end' };

