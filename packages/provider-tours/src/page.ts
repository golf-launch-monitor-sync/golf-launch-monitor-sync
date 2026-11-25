// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A tour's page as a client hands it on (spec/prores.md): one site, one player, his ranking on that tour, his
 * tournaments with their rounds, the season's statistics - and, read again strictly wherever it arrives (`checkTourPage`:
 * it comes from a content script, which the site's own scripts share a page with), one prores/1 batch of it.
 */

import {
  PRO_PROVIDER,
  PRORES_FORMAT,
  PRORES_MAX,
  type ProRanking,
  type ProresBatch,
  type ProResult,
  type ProRound,
  type ProStats,
  type ProTour,
  type ProTournament,
  type Reason,
} from '@glmsync/spec';

export type TourSite = `tour:${ProTour}`;

export interface TourPage {
  site: TourSite;
  /** The site's id of the player: what the account_ref is made of, never sent as it is. */
  id: string;
  /** The name the page writes: for the target's check, which keeps nothing of it. */
  name: string;
  ranking: ProRanking;
  tournaments: ProTournament[];
  stats: ProStats[];
}

export interface TourInfo {
  site: TourSite;
  /** What the player calls it. */
  name: string;
  /** Where the extension's content script runs. */
  matches: readonly string[];
  /** Where the player finds his page (the site's players or Order of Merit). */
  start: string;
}

/** The tours a module reads today. */
export const TOUR_SITES: Readonly<Partial<Record<TourSite, TourInfo>>> = {
  'tour:pro_golf_tour': {
    site: 'tour:pro_golf_tour',
    name: 'Pro Golf Tour',
    matches: ['https://www.progolftour.de/*'],
    start: 'https://www.progolftour.de/order-of-merit-en',
  },
  // One site, one page per player for both tours (europeantour.ts): each tour's ranking and tournaments go as its own page.
  'tour:dp_world': {
    site: 'tour:dp_world',
    name: 'DP World Tour',
    matches: ['https://www.europeantour.com/players/*'],
    start: 'https://www.europeantour.com/dpworld-tour/players/',
  },
  'tour:hotelplanner': {
    site: 'tour:hotelplanner',
    name: 'HotelPlanner Tour',
    matches: ['https://www.europeantour.com/players/*'],
    start: 'https://www.europeantour.com/hotelplanner-tour/players/',
  },
};

export const isTourSite = (v: unknown): v is TourSite => typeof v === 'string' && Object.hasOwn(TOUR_SITES, v);

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const REF = /^[A-Za-z0-9_.:-]{1,100}$/;
const RESULTS = new Set<ProResult>(['MC', 'WD', 'DQ', 'DNS']);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, lo: number, hi: number): v is string => typeof v === 'string' && v.length >= lo && v.length <= hi;
const day = (v: unknown): v is string => typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function roundOf(v: unknown): ProRound | null {
  const r = obj(v);
  if (!r || !int(r.round_no, 1, 8) || !int(r.gross, 9, 250)) return null;
  const out: ProRound = { round_no: r.round_no, gross: r.gross };
  if (day(r.played_on)) out.played_on = r.played_on;
  if (int(r.par, 27, 80)) out.par = r.par;
  if (r.holes === 9 || r.holes === 18) out.holes = r.holes;
  return out;
}

function tournamentOf(v: unknown, tour: ProTour): ProTournament | null {
  const t = obj(v);
  if (!t || !str(t.ref, 1, 100) || !REF.test(t.ref) || !day(t.start) || !Array.isArray(t.rounds)) return null;
  const rounds = t.rounds.slice(0, 8).map(roundOf).filter((r): r is ProRound => r !== null);
  if (rounds.length === 0) return null; // no tournament without its rounds
  const out: ProTournament = { ref: t.ref, tour, start: t.start, rounds };
  if (day(t.end) && t.end >= t.start) out.end = t.end;
  for (const k of ['name', 'venue'] as const) if (str(t[k], 1, 200)) out[k] = t[k];
  if (str(t.country, 1, 60)) out.country = t.country;
  if (typeof t.result === 'string' && RESULTS.has(t.result as ProResult)) out.result = t.result as ProResult;
  else if (int(t.place, 1, 999)) {
    out.place = t.place;
    if (t.tied === true) out.tied = true;
  }
  if (int(t.field, 1, 999)) out.field = t.field;
  if (num(t.points, 0, 1e9)) out.points = t.points;
  return out;
}

// The statistics' keys a client of this package sends, each in a range no season of a tour leaves (spec/prores.md).
const STATS: Readonly<Record<string, readonly [number, number]>> = {
  scoring_average: [55, 95], driving_distance_m: [100, 400], driving_accuracy_pct: [0, 100], gir_pct: [0, 100],
  scrambling_pct: [0, 100], sand_saves_pct: [0, 100], putts_per_round: [15, 45], putts_per_gir: [1, 3],
};

function statsOf(v: unknown, tour: ProTour): ProStats | null {
  const s = obj(v);
  const values = obj(s?.values);
  if (!s || !int(s.season, 1990, 2100) || !day(s.as_of) || !values) return null;
  const kept: Record<string, number> = {};
  for (const [k, [lo, hi]] of Object.entries(STATS)) if (num(values[k], lo, hi)) kept[k] = values[k];
  // A page's statistics are of the page's tour, never another's.
  return Object.keys(kept).length > 0 && (s.tour === undefined || s.tour === tour) ? { tour, season: s.season, as_of: s.as_of, values: kept } : null;
}

/** A page as it arrives from where it was read: field by field, what doesn't fit is dropped; without site, id, name or ranking it is none. */
export function checkTourPage(v: unknown): TourPage | null {
  const p = obj(v);
  if (!p || !isTourSite(p.site) || !str(p.id, 1, 60) || !/^[a-z0-9-]+$/.test(p.id) || !str(p.name, 2, 120)) return null;
  const site = p.site;
  const tour = site.slice(5) as ProTour;
  const r = obj(p.ranking);
  if (!r || r.source !== site || !day(r.as_of)) return null;
  const ranking: ProRanking = { source: site, as_of: r.as_of };
  if (int(r.rank, 1, 1_000_000)) ranking.rank = r.rank;
  if (num(r.points, 0, 1e9)) ranking.points = r.points;
  if (int(r.events, 0, 999)) ranking.events = r.events;
  const raw = Array.isArray(p.tournaments) ? p.tournaments.slice(0, PRORES_MAX.tournaments) : [];
  const tournaments = raw.map((t) => tournamentOf(t, tour)).filter((t): t is ProTournament => t !== null);
  const stats = (Array.isArray(p.stats) ? p.stats.slice(0, PRORES_MAX.stats) : []).map((x) => statsOf(x, tour)).filter((x): x is ProStats => x !== null);
  // Neither a rank nor points nor a tournament nor a season's statistics: nothing worth sending.
  if (ranking.rank === undefined && ranking.points === undefined && tournaments.length === 0 && stats.length === 0) return null;
  return { site, id: p.id, name: p.name, ranking, tournaments, stats };
}

export interface TourBatchOptions {
  /** The account_ref rule (spec/olmd.md) with provider `pro` over `<site>:<id>` and the pairing's salt. */
  account_ref: string;
  generated_at: string;
  generator: { name: string; version?: string };
  plan_id?: string;
  reason?: Reason;
  /** The player said the page is theirs although the target found another name (`other_player`). */
  confirmed?: boolean;
}

/** The subject of a page's account_ref: the site and its id of the player. */
export const tourSubjectOf = (page: Pick<TourPage, 'site' | 'id'>): string => `${page.site}:${page.id}`;

/** One prores/1 batch of a page, cut to the format's limits (the most rounds a batch carries). */
export function tourBatchOf(page: TourPage, o: TourBatchOptions): ProresBatch {
  const b: ProresBatch = {
    format: PRORES_FORMAT,
    provider: PRO_PROVIDER,
    site: page.site,
    account_ref: o.account_ref,
    generated_at: o.generated_at,
    generator: o.generator,
    player: o.confirmed ? { name: page.name, confirmed: true } : { name: page.name },
    rankings: [page.ranking],
  };
  if (o.plan_id || o.reason) b.sync = { ...(o.plan_id ? { plan_id: o.plan_id } : {}), ...(o.reason ? { reason: o.reason } : {}) };
  const tournaments: ProTournament[] = [];
  let rounds = 0;
  // Newest first, so that a cut leaves out the oldest.
  for (const t of [...page.tournaments].sort((a, b) => ((a.start ?? '') < (b.start ?? '') ? 1 : -1))) {
    const n = t.rounds?.length ?? 0;
    if (tournaments.length >= PRORES_MAX.tournaments || rounds + n > PRORES_MAX.rounds) break;
    tournaments.push(t);
    rounds += n;
  }
  if (tournaments.length > 0) b.tournaments = tournaments;
  if (page.stats.length > 0) b.stats = page.stats.slice(0, PRORES_MAX.stats);
  return b;
}
