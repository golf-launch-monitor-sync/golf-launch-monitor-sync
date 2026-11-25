// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * PGA Tour and Korn Ferry Tour (pgatour.com), the player's own *Results* page, as he opens it. Unofficial: not
 * affiliated with, endorsed by or supported by the PGA Tour.
 *
 * One page holds the season: `pgatour.com/player/<id>/<name>/results` (the Korn Ferry Tour's under
 * `/korn-ferry-tour/…`) with a *Tour* and a *Season* picker, the season's standing ("83", "PTS: 494": FedExCup, Points
 * List) and the table *Results & Scorecards*: Date (the last day), Tournament, Pos, R1-R4, Total, To Par, the standing's
 * Rank and Pts, Winnings (never read). The tour is the picker's; one this module doesn't read (PGA Tour Champions, PGA
 * Tour Americas) gives nothing.
 *
 * Read only on the player's *Send*: what the page shows then, nothing opened, nothing asked.
 */

import { placeOf, type ProRanking, type ProTour, type ProTournament } from '@glmsync/spec';
import { figureNumber, type Wanted } from './figures.ts';
import type { TourPage } from './page.ts';
import { addDays, asOfSeason, dayFrom, isTeamEvent, roundColumns, roundsOf, seasonOf, slugOf, type SeasonRead } from './season.ts';
import { clean, column, type Snapshot } from './snapshot.ts';

export const ORIGIN = 'https://www.pgatour.com';
/** The whole site: it moves between its pages without loading them, so the script must be there before his page. */
export const PAGE_MATCHES = ['https://www.pgatour.com/*'];
/** The pickers' values (`snapshotOf`'s `labels`). */
export const LABELS = ['Tour', 'Season'] as const;
const PTS = /^PTS:\s*[0-9][0-9,.]*$/;
/** The season's standing: the rank just before "PTS: n" (the first such pair: FedExCup, not FedExCup Fall). */
export const FIGURES: readonly Wanted[] = [
  { key: 'rank', label: PTS, take: 'before' },
  { key: 'points', label: PTS, take: 'self' },
];

const RESULTS = /^https:\/\/www\.pgatour\.com\/(?:(korn-ferry-tour|americas|pgatour-champions)\/)?player\/([0-9]{1,10})\/([a-z0-9-]{1,120})\/results\/?(?:[?#].*)?$/;
const PICKED: Readonly<Record<string, ProTour>> = { 'pga tour': 'pga_tour', 'korn ferry tour': 'korn_ferry' };
const BY_PATH: Readonly<Record<string, ProTour | null>> = { '': 'pga_tour', 'korn-ferry-tour': 'korn_ferry', americas: null, 'pgatour-champions': null };

/** A player's *Results* page: his id, and the tour its address names. Null for any other page. */
export function resultsPageOf(url: unknown): { id: string; tour: ProTour | null } | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const m = RESULTS.exec(url);
  if (!m?.[2]) return null;
  return { id: m[2], tour: BY_PATH[m[1] ?? ''] ?? null };
}

// "11.15.2026" → "2026-11-15" (month first)
function dayOf(s: string): string | undefined {
  const m = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})$/.exec(s.trim());
  return m ? dayFrom(Number(m[3]), Number(m[1]), Number(m[2])) : undefined;
}

// The site's id of the tournament, from the row's link to its shot tracker ("…tourcast.html?id=R2026002…").
const EVENT_ID = /[?&]id=([A-Z][0-9]{7})(?:[&#]|$)/;

/** His season as the page shows it now. `today`: the player's day; a tournament not over yet isn't sent. */
export function readResults(snap: Snapshot, figures: Readonly<Record<string, string>>, today: string): SeasonRead {
  const at = resultsPageOf(snap.url);
  if (!at) return { kind: 'unread', why: 'changed_page' };
  const picked = clean(snap.pairs.Tour ?? '').toLowerCase();
  // The picker says which tour the table is (the address may still name another); without it, the address.
  const tour = picked ? (PICKED[picked] ?? null) : at.tour;
  if (!tour) return { kind: 'unread', why: 'other_tour' };
  const name = clean(snap.title);
  const table = snap.tables.find((t) => column(t.head, 'Tournament') >= 0 && column(t.head, 'Date') >= 0 && column(t.head, 'R1') >= 0);
  if (!name || name.length < 2 || !table) return { kind: 'unread', why: 'changed_page' };
  const col = { date: column(table.head, 'Date'), name: column(table.head, 'Tournament'), pos: column(table.head, 'Pos', 'Position'), pts: column(table.head, 'Pts', 'Points') };
  const rounds = roundColumns(table.head);
  if (col.pos < 0 || rounds.length === 0) return { kind: 'unread', why: 'changed_page' };
  const tournaments: ProTournament[] = [];
  const ends: string[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const end = dayOf(row[col.date]?.text ?? '');
    const title = clean(row[col.name]?.text ?? '').slice(0, 200);
    if (!end || !title) continue; // a line that isn't a tournament (a total, a note)
    ends.push(end);
    // The date is the last day; the first is counted back by the rounds the table has room for (Thursday to Sunday).
    if (end >= today || isTeamEvent(title)) continue;
    const played = roundsOf(row, rounds);
    if (played.length === 0) continue;
    const id = row.map((c) => EVENT_ID.exec(c.href ?? '')?.[1]).find(Boolean);
    const ref = (id ? `pga-${id}` : `pga-${end}-${slugOf(title)}`).slice(0, 100);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const t: ProTournament = { ref, tour, name: title, start: addDays(end, -(rounds.length - 1)), end, rounds: played };
    const f = placeOf(clean(row[col.pos]?.text ?? '').replace(/^W\/D$/i, 'WD'));
    if (f && 'result' in f) t.result = f.result;
    else if (f) {
      t.place = f.place;
      if (f.tied) t.tied = true;
    }
    const pts = col.pts >= 0 ? figureNumber(clean(row[col.pts]?.text ?? '')) : undefined;
    if (pts !== undefined) t.points = pts;
    tournaments.push(t);
  }
  const ranking: ProRanking = { source: `tour:${tour}`, as_of: asOfSeason(seasonOf(snap.pairs.Season), ends.sort().at(-1), today) };
  const rank = figureNumber(figures.rank);
  if (rank !== undefined && Number.isInteger(rank) && rank >= 1) ranking.rank = rank;
  const points = figureNumber(figures.points);
  if (points !== undefined) ranking.points = points;
  ranking.events = ends.length;
  if (ranking.rank === undefined && ranking.points === undefined && tournaments.length === 0) return { kind: 'unread', why: 'nothing' };
  const page: TourPage = { site: `tour:${tour}`, id: at.id, name: name.slice(0, 120), ranking, tournaments, stats: [] };
  return { kind: 'page', page };
}
