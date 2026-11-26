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
 * His *Stats* page (`…/stats`, the same pickers) shows the season's statistics as a table *STAT, VALUE, RANK, SUPPORTING
 * STAT, VALUE*: strokes gained in its five parts, driving, greens, proximity (feet and inches), scrambling, putting,
 * scoring. Its values go as the season's statistics of prores/1 (`readStats`); the ranks and supporting figures are not
 * read.
 *
 * Read only on the player's *Send*: what the page shows then, nothing opened, nothing asked.
 */

import { placeOf, type ProRanking, type ProTour, type ProTournament } from '@glmsync/spec';
import { figureNumber, type Wanted } from './figures.ts';
import type { TourPage } from './page.ts';
import { addDays, asOfSeason, dayFrom, isTeamEvent, roundColumns, roundsOf, seasonOf, slugOf, type SeasonRead } from './season.ts';
import { statsAsOf, statsOfTable, type StatRule } from './seasonStats.ts';
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

const STATS = /^https:\/\/www\.pgatour\.com\/(?:(korn-ferry-tour|americas|pgatour-champions)\/)?player\/([0-9]{1,10})\/([a-z0-9-]{1,120})\/stats\/?(?:[?#].*)?$/;

function pageOf(re: RegExp, url: unknown): { id: string; tour: ProTour | null } | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const m = re.exec(url);
  if (!m?.[2]) return null;
  return { id: m[2], tour: BY_PATH[m[1] ?? ''] ?? null };
}

/** A player's *Results* page: his id, and the tour its address names. Null for any other page. */
export const resultsPageOf = (url: unknown): { id: string; tour: ProTour | null } | null => pageOf(RESULTS, url);

/** A player's *Stats* page: his id, and the tour its address names. Null for any other page. */
export const statsPageOf = (url: unknown): { id: string; tour: ProTour | null } | null => pageOf(STATS, url);

/** The tour of the table: the *Tour* picker's (the address may still name another); without a picker, the address's. */
function tourOf(snap: Snapshot, byAddress: ProTour | null): ProTour | null {
  const picked = clean(snap.pairs.Tour ?? '').toLowerCase();
  return picked ? (PICKED[picked] ?? null) : byAddress;
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
  const tour = tourOf(snap, at.tour);
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

/** The *Stats* table's labels (as `statLabel` writes them) and their keys of prores/1. */
export const STAT_RULES: readonly StatRule[] = [
  { key: 'sg_total', labels: ['sg: total'] },
  { key: 'sg_off_tee', labels: ['sg: off the tee'] },
  { key: 'sg_approach', labels: ['sg: approach the green', 'sg: approach to green'] },
  { key: 'sg_around_green', labels: ['sg: around the green'] },
  { key: 'sg_putting', labels: ['sg: putting'] },
  { key: 'driving_distance_m', labels: ['driving distance'], unit: 'yards' },
  { key: 'driving_accuracy_pct', labels: ['driving accuracy percentage'] },
  { key: 'gir_pct', labels: ['greens in regulation percentage'] },
  { key: 'proximity_m', labels: ['proximity to hole'], unit: 'feet' },
  { key: 'scrambling_pct', labels: ['scrambling'] },
  { key: 'sand_saves_pct', labels: ['sand save percentage'] },
  // "Putting Average" is the putts per green hit in regulation (its supporting figures say so).
  { key: 'putts_per_gir', labels: ['putting average'] },
  { key: 'putts_per_round', labels: ['putts per round'] },
  { key: 'scoring_average', labels: ['scoring average (actual)'] },
  { key: 'birdies_per_round', labels: ['birdie average'] },
  { key: 'par3_average', labels: ['par 3 scoring average'] },
  { key: 'par4_average', labels: ['par 4 scoring average'] },
  { key: 'par5_average', labels: ['par 5 scoring average'] },
];

/** His season's statistics as the *Stats* page shows them now: the tour and season of its pickers. */
export function readStats(snap: Snapshot, figures: Readonly<Record<string, string>>, today: string): SeasonRead {
  const at = statsPageOf(snap.url);
  if (!at) return { kind: 'unread', why: 'changed_page' };
  const tour = tourOf(snap, at.tour);
  if (!tour) return { kind: 'unread', why: 'other_tour' };
  const name = clean(snap.title);
  const table = snap.tables.find((t) => column(t.head, 'Stat') >= 0 && column(t.head, 'Value') >= 0);
  // The season is the statistics' key: a page that doesn't say it isn't guessed.
  const season = seasonOf(snap.pairs.Season);
  if (!name || name.length < 2 || !table || season === undefined) return { kind: 'unread', why: 'changed_page' };
  const values = statsOfTable(table, { label: column(table.head, 'Stat'), value: column(table.head, 'Value') }, STAT_RULES);
  if (Object.keys(values).length === 0) return { kind: 'unread', why: 'nothing' };
  const as_of = statsAsOf(season, today);
  const ranking: ProRanking = { source: `tour:${tour}`, as_of };
  // The standing, where the page shows it beside its label as on Results; it is today's, so only for the running season.
  if (as_of === today) {
    const rank = figureNumber(figures.rank);
    if (rank !== undefined && Number.isInteger(rank) && rank >= 1) ranking.rank = rank;
    const points = figureNumber(figures.points);
    if (points !== undefined) ranking.points = points;
  }
  const page: TourPage = { site: `tour:${tour}`, id: at.id, name: name.slice(0, 120), ranking, tournaments: [], stats: [{ tour, season, as_of, values }] };
  return { kind: 'page', page };
}
