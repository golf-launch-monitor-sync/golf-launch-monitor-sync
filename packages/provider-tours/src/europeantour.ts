// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * DP World Tour and HotelPlanner Tour (europeantour.com), the player's own pages, as he opens them. Unofficial: not
 * affiliated with, endorsed by or supported by the PGA European Tour, the DP World Tour or the HotelPlanner Tour.
 *
 * Both tours keep one page per player on the same site (`/players/<name>-<id>/`), built by the site's own scripts in
 * the player's tab; the module reads the document they built, and asks the site nothing.
 *
 * - **The head** of every page of his: the rank of the tour named in the address (*R2DR*, the Race to Dubai; *R2M*,
 *   the Road to Mallorca), written above its label.
 * - **Overview**: the tour's *Rankings* (current rank, tournaments played, the season's points) and his last five
 *   tournaments.
 * - **Wins & Results**: his tournaments of the season picked in the page's own select, each with end date, place,
 *   the points of the tour's ranking and R1-R4. A tournament's link names its tour (`/dpworld-tour/…`,
 *   `/hotelplanner-tour/…`; earlier `/european-tour/…`, `/challenge-tour/…`): tours of the site this project has no
 *   key for (Legends, G4D) are left out.
 * - **Stats**: the season statistics of the tour picked in the page's own select, one table a season.
 *
 * What a page shows of both tours goes as two pages of prores/1 (`tour:dp_world`, `tour:hotelplanner`), each with
 * its tour's ranking, tournaments and statistics. A tournament goes only with its rounds.
 */

import { placeOf as finishOf, PRORES_MAX, type ProRanking, type ProRound, type ProStats, type ProTournament } from '@glmsync/spec';
import { checkTourPage, type TourPage, type TourSite } from './page.ts';
import { clean, column, nameKey, type Snapshot, type Table } from './snapshot.ts';

export type EtTour = 'dp_world' | 'hotelplanner';
export const TOURS: readonly EtTour[] = ['dp_world', 'hotelplanner'];
export const SITE: Readonly<Record<EtTour, TourSite>> = { dp_world: 'tour:dp_world', hotelplanner: 'tour:hotelplanner' };
export const ORIGIN = 'https://www.europeantour.com';
/** Where the module's scripts run: a player's pages, nothing else of the site. */
export const PAGE_MATCHES = ['https://www.europeantour.com/players/*'];
/** The labels the site writes under their figure (`snapshotOf`'s `before`). */
export const BEFORE = [
  'R2DR', 'R2M', 'Current Rank', 'Tournaments Played', 'Race to Dubai Points', 'HotelPlanner Tour Rankings Points',
  'Road to Mallorca Points',
] as const;

/** The address's name for a tour (`?tour=…`, and a tournament's path). */
const TOUR_PATHS: Readonly<Record<string, EtTour>> = {
  'dpworld-tour': 'dp_world',
  'european-tour': 'dp_world',
  'hotelplanner-tour': 'hotelplanner',
  'challenge-tour': 'hotelplanner',
};
/** What the tour select on *Stats* writes. */
const TOUR_NAMES: Readonly<Record<string, EtTour>> = { 'dp world tour': 'dp_world', 'hotelplanner tour': 'hotelplanner' };

const PLAYER = /^\/players\/([a-z0-9-]{1,150}?)-([0-9]{1,10})\/?(?:([a-z-]{1,40})\/?)?$/;
const TOURNAMENT = /^\/([a-z-]{1,40})\/([a-z0-9-]{1,95})\/?$/;

export interface PlayerPage {
  id: string;
  /** Which of his pages: `overview` (no part), `results`, `stats`, or another (news, career records). */
  part: 'overview' | 'results' | 'stats' | 'other';
  /** The tour the address names, if it names one of ours. */
  tour: EtTour | null;
}

/** A player's page on the site, by its address; null for anything else. */
export function playerPageOf(url: unknown): PlayerPage | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== ORIGIN) return null;
  const m = PLAYER.exec(u.pathname);
  if (!m?.[2]) return null;
  const part = m[3] === undefined ? 'overview' : m[3] === 'results' || m[3] === 'stats' ? m[3] : 'other';
  const t = u.searchParams.get('tour');
  return { id: m[2], part, tour: t !== null && Object.hasOwn(TOUR_PATHS, t) ? (TOUR_PATHS[t] ?? null) : null };
}

/** The site of a player's page by its address: the tour it names, else the DP World Tour (the site's own default). */
export function siteOfUrl(url: unknown): TourSite {
  return SITE[playerPageOf(url)?.tour ?? 'dp_world'];
}

/** What a page of his showed: one shape for a page read and for what the client keeps of them (`mergeRead`). */
export interface EtRead {
  kind: 'page';
  player_id: string;
  player_name: string;
  rankings: Partial<Record<EtTour, ProRanking>>;
  /** With their tour (one of ours), their rounds, newest first. */
  tournaments: ProTournament[];
  /** With their tour. */
  stats: ProStats[];
}

/** Why a page that should be one of his couldn't be read: the site changed. */
export interface Unread {
  kind: 'unread';
  why: 'changed_page';
}

// "15/11/2026" → "2026-11-15"
export function dayOf(s: string): string | undefined {
  const m = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4})$/.exec(s.trim());
  if (!m) return undefined;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysBefore(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

// "5,044.9" → 5044.9 (the site writes English numbers); "-", "" and anything else: none.
function numberOf(s: string | undefined): number | undefined {
  const t = (s ?? '').replace(/[€\s]/g, '');
  if (!/^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+(\.[0-9]+)?$/.test(t)) return undefined;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n <= 1e9 ? n : undefined;
}

// "1st", "35th", "35" → a rank; "-" and the like: none.
function rankOf(s: string | undefined): number | undefined {
  const m = /^([0-9]{1,7})(?:st|nd|rd|th)?$/i.exec((s ?? '').trim());
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 1_000_000 ? n : undefined;
}

/** The player's name: the document's title names it before *Players* ("Wins & Results - Rory MCILROY - Players - …"). */
export function nameOf(title: string, lines: readonly string[]): string | null {
  const parts = clean(title).split(' - ');
  const at = parts.indexOf('Players');
  const name = at >= 1 ? clean(parts[at - 1]) : '';
  // The page writes it too (its heading): a title the module doesn't know isn't taken.
  if (name.length < 2 || name.length > 120 || !lines.some((l) => nameKey(l) === nameKey(name))) return null;
  return name;
}

/** The results' table (overview and *Wins & Results*): end date, tournament, place and the rounds; the wins' has no place. */
function resultsTables(snap: Snapshot): Table[] {
  return snap.tables.filter((t) => ['End Date', 'Tournament', 'Pos.', 'R1'].every((h) => column(t.head, h) >= 0));
}

function tournamentsOf(table: Table, today: string): ProTournament[] {
  const col = {
    end: column(table.head, 'End Date'),
    name: column(table.head, 'Tournament'),
    place: column(table.head, 'Pos.'),
    total: column(table.head, 'Total'),
    toPar: column(table.head, 'To Par'),
    points: { dp_world: column(table.head, 'R2DR Points'), hotelplanner: column(table.head, 'R2MR Points') } as Record<EtTour, number>,
    rounds: [1, 2, 3, 4, 5, 6].map((n) => column(table.head, `R${n}`)).filter((c) => c >= 0),
  };
  const out: ProTournament[] = [];
  for (const row of table.rows) {
    const end = dayOf(row[col.end]?.text ?? '');
    const cell = row[col.name];
    let path = '';
    try {
      path = cell?.href ? new URL(cell.href).pathname : '';
    } catch {
      path = '';
    }
    const m = TOURNAMENT.exec(path);
    const tour = m?.[1] && Object.hasOwn(TOUR_PATHS, m[1]) ? TOUR_PATHS[m[1]] : undefined;
    // A line of a tour that isn't ours, or that isn't a tournament (an ad, a note), or still to finish: not taken.
    if (!end || !cell || !m?.[2] || !tour || end >= today) continue;
    const rounds: ProRound[] = [];
    col.rounds.forEach((c, i) => {
      const gross = Number(clean(row[c]?.text ?? ''));
      // A round's strokes, never a "to par" or a dash.
      if (Number.isInteger(gross) && gross >= 50 && gross <= 120) rounds.push({ round_no: i + 1, gross, holes: 18 });
    });
    if (rounds.length === 0) continue; // no tournament without its rounds (a match play has none)
    // The par of the course, where total and "to par" say it for every round alike.
    const total = col.total >= 0 ? Number(clean(row[col.total]?.text ?? '')) : NaN;
    const toPar = col.toPar >= 0 ? Number(clean(row[col.toPar]?.text ?? '').replace(/^E$/i, '0')) : NaN;
    const sum = rounds.reduce((a, r) => a + (r.gross ?? 0), 0);
    const par = (total - toPar) / rounds.length;
    if (total === sum && Number.isInteger(toPar) && Number.isInteger(par) && par >= 54 && par <= 80) for (const r of rounds) r.par = par;
    // The site's 4-day week: the first day three before the last (the target counts each round's day from it).
    const t: ProTournament = { ref: `et-${m[2]}`, tour, name: clean(cell.text).slice(0, 200), start: daysBefore(end, 3), end, rounds };
    const f = finishOf(clean(row[col.place]?.text ?? ''));
    const roundCells = col.rounds.map((c) => clean(row[c]?.text ?? ''));
    // A missed cut: the site writes the place after two rounds, the rounds after them and the total as a dash.
    const cut = rounds.length === 2 && col.rounds.length > 2 && roundCells.slice(2).every((x) => x === '-') && clean(row[col.total]?.text ?? '') === '-';
    if (f && 'result' in f) t.result = f.result;
    else if (cut) t.result = 'MC';
    else if (f) {
      t.place = f.place;
      if (f.tied) t.tied = true;
    }
    const points = col.points[tour] >= 0 ? numberOf(row[col.points[tour]]?.text) : undefined;
    if (points !== undefined) t.points = points;
    out.push(t);
  }
  return out;
}

/** The statistics' labels the site writes, and their key of prores/1 (metric). */
const STAT_LABELS: readonly (readonly [RegExp, string, (n: number) => number])[] = [
  [/^stroke average$/i, 'scoring_average', (n) => n],
  [/^driving distance \(yards\)$/i, 'driving_distance_m', (n) => Math.round(n * 0.9144 * 10) / 10],
  [/^driving accuracy \(%\)$/i, 'driving_accuracy_pct', (n) => n],
  [/^greens in regulation \(%\)$/i, 'gir_pct', (n) => n],
  [/^scrambling \(%\)$/i, 'scrambling_pct', (n) => n],
  [/^sand saves \(%/i, 'sand_saves_pct', (n) => n],
  [/^average putts per round$/i, 'putts_per_round', (n) => n],
  [/^putts per gir$/i, 'putts_per_gir', (n) => n],
];

function statsOf(snap: Snapshot, today: string): ProStats[] | null {
  const tour = snap.selected.map((s) => TOUR_NAMES[s.toLowerCase()]).find(Boolean);
  const tables = snap.tables.filter((t) => /^[0-9]{4}$/.test(t.head[0] ?? '') && column(t.head, 'Stat') >= 0);
  if (!tour || tables.length === 0) return null;
  const year = Number(today.slice(0, 4));
  const out: ProStats[] = [];
  for (const t of tables) {
    const season = Number(t.head[0]);
    const at = column(t.head, 'Stat');
    const values: Record<string, number> = {};
    for (const row of t.rows) {
      const label = clean(row[0]?.text ?? '');
      const hit = STAT_LABELS.find(([re]) => re.test(label));
      const n = numberOf(row[at]?.text);
      if (hit && n !== undefined && !(hit[1] in values)) values[hit[1]] = hit[2](n);
    }
    // A past season as at its end; this one (and the next, which the site starts in November) as read today.
    if (Object.keys(values).length > 0 && season >= 1990) out.push({ tour, season, as_of: season < year ? `${season}-12-31` : today, values });
  }
  return out.sort((a, b) => b.season - a.season).slice(0, PRORES_MAX.stats);
}

/**
 * Whether the page shows yet what the module reads of it (the site's scripts build the tables a moment after the page):
 * a client waits a little for it before it reads.
 */
export function shows(snap: Snapshot): boolean {
  const at = playerPageOf(snap.url);
  if (at?.part === 'results') return resultsTables(snap).length > 0;
  if (at?.part === 'stats') return snap.tables.some((t) => /^[0-9]{4}$/.test(t.head[0] ?? '') && column(t.head, 'Stat') >= 0);
  if (at?.part === 'overview') return snap.tables.length > 0;
  return true;
}

/**
 * A page of his as it shows now (`title`: the document's title, which names him; `today`: the player's day). Null when
 * this isn't a player's page; `changed_page` when it is but doesn't look as the module knows it.
 */
export function readPage(snap: Snapshot, title: string, today: string): EtRead | Unread | null {
  const at = playerPageOf(snap.url);
  if (!at) return null;
  const name = nameOf(title, snap.lines);
  if (!name) return { kind: 'unread', why: 'changed_page' };
  const rankings: Partial<Record<EtTour, ProRanking>> = {};
  const rank = (tour: EtTour): ProRanking => (rankings[tour] ??= { source: SITE[tour], as_of: today });
  // The head: the rank of the address's tour, under its short name.
  const head: Record<EtTour, number | undefined> = { dp_world: rankOf(snap.pairs.R2DR), hotelplanner: rankOf(snap.pairs.R2M) };
  for (const tour of TOURS) if (head[tour] !== undefined) rank(tour).rank = head[tour];
  // The overview's *Rankings*: whose they are, its points' label says.
  const points: Record<EtTour, number | undefined> = {
    dp_world: numberOf(snap.pairs['Race to Dubai Points']),
    hotelplanner: numberOf(snap.pairs['HotelPlanner Tour Rankings Points'] ?? snap.pairs['Road to Mallorca Points']),
  };
  const of = TOURS.filter((tour) => points[tour] !== undefined);
  const named = of.length === 1 ? of[0] : undefined;
  const pts = named ? points[named] : undefined;
  if (named && pts !== undefined) {
    const r = rank(named);
    r.points = pts;
    const current = rankOf(snap.pairs['Current Rank']);
    if (r.rank === undefined && current !== undefined) r.rank = current;
    const events = numberOf(snap.pairs['Tournaments Played']);
    if (events !== undefined && Number.isInteger(events) && events <= 999) r.events = events;
  }
  const tables = resultsTables(snap);
  if (at.part === 'results' && tables.length === 0) return { kind: 'unread', why: 'changed_page' };
  const seen = new Set<string>();
  const tournaments: ProTournament[] = [];
  for (const t of tables.flatMap((x) => tournamentsOf(x, today))) {
    if (seen.has(t.ref)) continue;
    seen.add(t.ref);
    tournaments.push(t);
  }
  let stats: ProStats[] = [];
  if (at.part === 'stats') {
    const s = statsOf(snap, today);
    if (s === null) return { kind: 'unread', why: 'changed_page' };
    stats = s;
  }
  return { kind: 'page', player_id: at.id, player_name: name, rankings, tournaments: tournaments.slice(0, PRORES_MAX.tournaments), stats };
}

/**
 * What the client keeps after a page: the read before with this one over it - another player's page replaces it all;
 * a tournament (by its ref) and a tour's season statistics are replaced by the newer read of them, a tour's ranking
 * field by field.
 */
export function mergeRead(kept: EtRead | null, read: EtRead): EtRead {
  if (!kept || kept.player_id !== read.player_id) return read;
  const byRef = new Map(kept.tournaments.map((t) => [t.ref, t]));
  for (const t of read.tournaments) byRef.set(t.ref, t);
  const tournaments = [...byRef.values()].sort((a, b) => ((a.start ?? '') < (b.start ?? '') ? 1 : -1)).slice(0, PRORES_MAX.tournaments);
  const stats: ProStats[] = [];
  for (const tour of TOURS) {
    const bySeason = new Map(kept.stats.filter((s) => s.tour === tour).map((s) => [s.season, s]));
    for (const s of read.stats.filter((x) => x.tour === tour)) bySeason.set(s.season, s);
    stats.push(...[...bySeason.values()].sort((a, b) => b.season - a.season).slice(0, PRORES_MAX.stats));
  }
  // A tour's ranking field by field: the head of a page gives its rank, the overview also its points and events.
  const rankings: Partial<Record<EtTour, ProRanking>> = { ...kept.rankings };
  for (const tour of TOURS) {
    const r = read.rankings[tour];
    if (r) rankings[tour] = { ...kept.rankings[tour], ...r };
  }
  return { kind: 'page', player_id: read.player_id, player_name: read.player_name, rankings, tournaments, stats };
}

/** Each tour's page of what was read: its ranking (as read, else only the day), its tournaments, its statistics. */
export function pagesOf(read: EtRead, today: string): TourPage[] {
  const out: TourPage[] = [];
  for (const tour of TOURS) {
    const page = checkTourPage({
      site: SITE[tour],
      id: read.player_id,
      name: read.player_name,
      ranking: read.rankings[tour] ?? { source: SITE[tour], as_of: today },
      tournaments: read.tournaments.filter((t) => t.tour === tour),
      stats: read.stats.filter((s) => s.tour === tour),
    });
    if (page) out.push(page);
  }
  return out;
}

/**
 * A read as it arrives from the content script (or the client's storage), read again strictly: its frame here, each
 * tour's part by the rules of a tour's page (`checkTourPage`). None when its frame doesn't hold.
 */
export function checkRead(v: unknown): EtRead | null {
  const r = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!r || r.kind !== 'page' || typeof r.player_id !== 'string' || !/^[0-9]{1,10}$/.test(r.player_id)) return null;
  if (typeof r.player_name !== 'string' || r.player_name.length < 2 || r.player_name.length > 120) return null;
  const rankings = r.rankings && typeof r.rankings === 'object' ? (r.rankings as Record<string, unknown>) : {};
  const all = Array.isArray(r.tournaments) ? r.tournaments.slice(0, PRORES_MAX.tournaments * 2) : [];
  const stats = Array.isArray(r.stats) ? r.stats.slice(0, PRORES_MAX.stats * 2) : [];
  const tourOf = (x: unknown): unknown => (x && typeof x === 'object' ? (x as { tour?: unknown }).tour : undefined);
  const out: EtRead = { kind: 'page', player_id: r.player_id, player_name: r.player_name, rankings: {}, tournaments: [], stats: [] };
  for (const tour of TOURS) {
    const given = rankings[tour] && typeof rankings[tour] === 'object' ? (rankings[tour] as Record<string, unknown>) : null;
    const ranking = given ? { ...given, source: SITE[tour] } : { source: SITE[tour], as_of: '1990-01-01' };
    const page = checkTourPage({
      site: SITE[tour], id: r.player_id, name: r.player_name, ranking,
      tournaments: all.filter((t) => tourOf(t) === tour),
      stats: stats.filter((s) => tourOf(s) === tour),
    });
    if (!page) continue;
    if (given && (page.ranking.rank !== undefined || page.ranking.points !== undefined)) out.rankings[tour] = page.ranking;
    out.tournaments.push(...page.tournaments);
    out.stats.push(...page.stats);
  }
  out.tournaments.sort((a, b) => ((a.start ?? '') < (b.start ?? '') ? 1 : -1));
  return out;
}
