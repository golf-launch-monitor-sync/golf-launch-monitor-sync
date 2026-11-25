// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The tours, read along (spec/prores.md): the player opens his own pages of a tour in his browser, and the module of
 * that tour reads what the page shows there. One module per tour; each asks its site nothing of its own.
 *
 * - `snapshot`         a page as text (headings, labelled values, tables, links), taken in the page's script
 * - `page`             a tour's page as a client hands it on: read again strictly, one prores/1 batch of it
 * - `progolftour`      Pro Golf Tour: the profile (ranking, tournaments) and his line of a tournament's final result
 * - `progolftour-run`  *Fetch all* there: his finished tournaments' pages, one by one, on his tap
 * - `europeantour`     DP World Tour and HotelPlanner Tour: his pages on europeantour.com (ranks, results with
 *                      rounds, season statistics), each tour a page of its own
 * - `seasonPage`       the tours whose *Results* page shows the whole season with rounds, read on *Send*:
 *                      `pgatour` (PGA Tour, Korn Ferry Tour), `lpga` (LPGA Tour, Epson Tour); `figures` the standing
 */

export * from './page.ts';
export * from './snapshot.ts';
export * as progolftour from './progolftour.ts';
export * as progolftourRun from './progolftour-run.ts';
export * as europeantour from './europeantour.ts';
export * from './figures.ts';
export * from './seasonPage.ts';
export type { SeasonRead, SeasonUnread } from './season.ts';
export * as pgatour from './pgatour.ts';
export * as lpga from './lpga.ts';
