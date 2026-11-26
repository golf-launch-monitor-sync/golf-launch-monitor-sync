// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * LPGA Tour (lpga.com) and Epson Tour (epsontour.com), the player's own *Results* page, as she opens it. Both sites
 * are the LPGA's and built alike. Unofficial: not affiliated with, endorsed by or supported by the LPGA or the Epson
 * Tour.
 *
 * One page holds the season: `<site>/athletes/<name>/<id>/results` with a *Seasons* picker, the season's standing
 * ("134" over "CME Points Rank", "63.688" over "CME Points"; on the Epson Tour *Race for the Card*) and a table:
 * TOURNAMENT (the first day and the tournament's link), POS, TO PAR, OFFICIAL MONEY (never read), R1-R4, TOTAL and the
 * standing's points.
 *
 * Her *Stats* page (`…/stats`, the same picker) shows the strokes gained of the season as cards (a label, its value
 * after it) and a table *PERFORMANCE, YEAR TO DATE, RANKING*: driving, greens, putting, scoring, par 3/4/5, rounds,
 * events, cuts, top 10s, wins and the standing's points with their rank. Its values go as the season's statistics of
 * prores/1, the standing's row as the ranking (`readStats`).
 *
 * Read only on the player's *Send*: what the page shows then, nothing opened, nothing asked.
 */

import { placeOf, type ProRanking, type ProTour, type ProTournament } from '@glmsync/spec';
import { figureNumber, type Wanted } from './figures.ts';
import type { TourPage } from './page.ts';
import { addDays, asOfSeason, dayFrom, isTeamEvent, roundColumns, roundsOf, seasonOf, slugOf, type SeasonRead } from './season.ts';
import { statLabel, statsAsOf, statsOfPairs, statsOfTable, statValue, type StatRule } from './seasonStats.ts';
import { clean, column, type Snapshot } from './snapshot.ts';

export const SITES = {
  lpga: { tour: 'lpga', origin: 'https://www.lpga.com', prefix: 'lpga' },
  epson: { tour: 'epson', origin: 'https://www.epsontour.com', prefix: 'epson' },
} as const satisfies Record<string, { tour: ProTour; origin: string; prefix: string }>;
/** The whole sites: they move between their pages without loading them, so the script must be there before her page. */
export const PAGE_MATCHES = ['https://www.lpga.com/*', 'https://www.epsontour.com/*'];
/** The strokes gained cards of her *Stats* page: a label, its value written after it. */
const SG_LABELS = ['SG Total', 'SG Off the Tee', 'SG Approach', 'SG Around Green', 'SG Putting'] as const;
/** The season picker's value and the strokes gained cards' (`snapshotOf`'s `labels`). */
export const LABELS = ['Seasons', ...SG_LABELS] as const;
/** The season's standing: the values written above their labels. */
export const FIGURES: readonly Wanted[] = [
  { key: 'rank', label: /^(?:CME|Race for the Card) Points Rank$/i, take: 'before' },
  { key: 'points', label: /^(?:CME|Race for the Card) Points$/i, take: 'before' },
];

const RESULTS = /^https:\/\/www\.(lpga|epsontour)\.com\/athletes\/([a-z0-9-]{1,120})\/([0-9]{1,10})\/results\/?(?:[?#].*)?$/;
const STATS = /^https:\/\/www\.(lpga|epsontour)\.com\/athletes\/([a-z0-9-]{1,120})\/([0-9]{1,10})\/stats\/?(?:[?#].*)?$/;

function pageOf(re: RegExp, url: unknown): { site: keyof typeof SITES; id: string } | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  const m = re.exec(url);
  if (!m?.[1] || !m[3]) return null;
  return { site: m[1] === 'lpga' ? 'lpga' : 'epson', id: m[3] };
}

/** A player's *Results* page: which site, her id. Null for any other page. */
export const resultsPageOf = (url: unknown): { site: keyof typeof SITES; id: string } | null => pageOf(RESULTS, url);

/** A player's *Stats* page: which site, her id. Null for any other page. */
export const statsPageOf = (url: unknown): { site: keyof typeof SITES; id: string } | null => pageOf(STATS, url);

// "10/01/2026 LOTTE Championship" → the first day and the tournament's name (month first).
function lineOf(s: string): { start: string; name: string } | null {
  const m = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})\s+(.{1,200})$/.exec(clean(s));
  const start = m ? dayFrom(Number(m[3]), Number(m[1]), Number(m[2])) : undefined;
  return m?.[4] && start ? { start, name: m[4] } : null;
}

// The tournament's page: "/tournaments/<slug>/overview".
const EVENT = /\/tournaments\/([a-z0-9-]{1,120})(?:\/|$)/;

/** Her season as the page shows it now. `today`: the player's day; a tournament not over yet isn't sent. */
export function readResults(snap: Snapshot, figures: Readonly<Record<string, string>>, today: string): SeasonRead {
  const at = resultsPageOf(snap.url);
  if (!at) return { kind: 'unread', why: 'changed_page' };
  const site = SITES[at.site];
  const name = clean(snap.title);
  const table = snap.tables.find((t) => column(t.head, 'Tournament') >= 0 && column(t.head, 'R1') >= 0);
  if (!name || name.length < 2 || !table) return { kind: 'unread', why: 'changed_page' };
  const col = {
    name: column(table.head, 'Tournament'),
    pos: column(table.head, 'Pos', 'Position'),
    pts: column(table.head, 'CME Points', 'Race Points', 'Points'),
  };
  const rounds = roundColumns(table.head);
  if (col.pos < 0 || rounds.length === 0) return { kind: 'unread', why: 'changed_page' };
  const tournaments: ProTournament[] = [];
  const days: string[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    const cell = row[col.name];
    const line = lineOf(cell?.text ?? '');
    if (!cell || !line) continue; // a line that isn't a tournament (a total, a note)
    // The date is the first day; the last is counted on by the rounds the table has room for.
    const end = addDays(line.start, rounds.length - 1);
    days.push(end);
    if (end >= today || isTeamEvent(line.name)) continue;
    const played = roundsOf(row, rounds);
    if (played.length === 0) continue;
    const slug = EVENT.exec(cell.href ?? '')?.[1] ?? slugOf(line.name);
    const ref = `${site.prefix}-${line.start.slice(0, 4)}-${slug}`.slice(0, 100);
    if (seen.has(ref)) continue;
    seen.add(ref);
    const t: ProTournament = { ref, tour: site.tour, name: line.name, start: line.start, rounds: played };
    const f = placeOf(clean(row[col.pos]?.text ?? '').replace(/^W\/D$/i, 'WD'));
    if (f && 'result' in f) t.result = f.result;
    else if (f) {
      t.place = f.place;
      if (f.tied) t.tied = true;
    }
    const pts = col.pts >= 0 ? figureNumber(clean(row[col.pts]?.text ?? '')) : undefined;
    // "0.00" for a missed cut is no points, not a figure worth keeping.
    if (pts !== undefined && pts > 0) t.points = pts;
    tournaments.push(t);
  }
  const ranking: ProRanking = { source: `tour:${site.tour}`, as_of: asOfSeason(seasonOf(snap.pairs.Seasons), days.sort().at(-1), today) };
  const rank = figureNumber(figures.rank);
  if (rank !== undefined && Number.isInteger(rank) && rank >= 1) ranking.rank = rank;
  const points = figureNumber(figures.points);
  if (points !== undefined) ranking.points = points;
  ranking.events = days.length;
  if (ranking.rank === undefined && ranking.points === undefined && tournaments.length === 0) return { kind: 'unread', why: 'nothing' };
  const page: TourPage = { site: `tour:${site.tour}`, id: at.id, name: name.slice(0, 120), ranking, tournaments, stats: [] };
  return { kind: 'page', page };
}

/** The *Stats* page's labels (as `statLabel` writes them) and their keys of prores/1. */
export const STAT_RULES: readonly StatRule[] = [
  { key: 'sg_total', labels: ['sg total'] },
  { key: 'sg_off_tee', labels: ['sg off the tee'] },
  { key: 'sg_approach', labels: ['sg approach'] },
  { key: 'sg_around_green', labels: ['sg around green'] },
  { key: 'sg_putting', labels: ['sg putting'] },
  { key: 'driving_distance_m', labels: ['drive distance avg'], unit: 'yards' },
  { key: 'driving_accuracy_pct', labels: ['drive accuracy pct'] },
  { key: 'gir_pct', labels: ['greens in regulation pct'] },
  { key: 'sand_saves_pct', labels: ['sand save pct'] },
  { key: 'putts_per_gir', labels: ['putts per gir avg'] },
  { key: 'putts_per_round', labels: ['putts per round avg'] },
  { key: 'scoring_average', labels: ['scoring avg per round'] },
  { key: 'par3_average', labels: ['par 3 scoring avg'] },
  { key: 'par4_average', labels: ['par 4 scoring avg'] },
  { key: 'par5_average', labels: ['par 5 scoring avg'] },
  { key: 'rounds', labels: ['rounds played'], unit: 'count' },
  { key: 'events', labels: ['events played'], unit: 'count' },
  { key: 'cuts_made', labels: ['cuts made'], unit: 'count' },
  { key: 'top10', labels: ['top 10 finishes'], unit: 'count' },
  { key: 'wins', labels: ['official wins'], unit: 'count' },
];
// Her birdies of the season: with her rounds, the birdies a round (as pgatour.com's *Birdie Average* counts them).
const BIRDIES = 'birdies';
// The standing's row: its points, and their rank in the table's own column.
const STANDING = /^(?:cme|race for the card) points$/;

/** Her season's statistics as the *Stats* page shows them now: the season of its picker. */
export function readStats(snap: Snapshot, _figures: Readonly<Record<string, string>>, today: string): SeasonRead {
  const at = statsPageOf(snap.url);
  if (!at) return { kind: 'unread', why: 'changed_page' };
  const site = SITES[at.site];
  const name = clean(snap.title);
  const table = snap.tables.find((t) => column(t.head, 'Performance') >= 0 && column(t.head, 'Year to Date') >= 0);
  // The season is the statistics' key: a page that doesn't say it isn't guessed.
  const season = seasonOf(snap.pairs.Seasons);
  if (!name || name.length < 2 || !table || season === undefined) return { kind: 'unread', why: 'changed_page' };
  const col = { label: column(table.head, 'Performance'), value: column(table.head, 'Year to Date'), rank: column(table.head, 'Ranking') };
  const values: Record<string, number> = { ...statsOfPairs(snap.pairs, STAT_RULES), ...statsOfTable(table, col, STAT_RULES) };
  const as_of = statsAsOf(season, today);
  const ranking: ProRanking = { source: `tour:${site.tour}`, as_of };
  for (const row of table.rows) {
    const label = statLabel(row[col.label]?.text ?? '');
    if (label === BIRDIES) {
      const birdies = statValue(row[col.value]?.text, 'count');
      if (birdies !== undefined && values.rounds) values.birdies_per_round = Math.round((birdies / values.rounds) * 100) / 100;
    } else if (STANDING.test(label) && ranking.points === undefined) {
      const points = statValue(row[col.value]?.text);
      if (points !== undefined && points >= 0) ranking.points = points;
      const rank = col.rank >= 0 ? statValue(row[col.rank]?.text, 'count') : undefined;
      if (rank !== undefined && rank >= 1) ranking.rank = rank;
    }
  }
  if (Object.keys(values).length === 0 && ranking.rank === undefined && ranking.points === undefined) return { kind: 'unread', why: 'nothing' };
  const stats = Object.keys(values).length > 0 ? [{ tour: site.tour, season, as_of, values }] : [];
  const page: TourPage = { site: `tour:${site.tour}`, id: at.id, name: name.slice(0, 120), ranking, tournaments: [], stats };
  return { kind: 'page', page };
}
