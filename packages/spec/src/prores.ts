// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages (spec/prores.md, 1.15.0): the prores/1 batch as a client builds it, and the rules a client
 * shares with the reference (spec/reference/prores.py, vectors in spec/testvectors/prores-examples.json):
 *
 * - `placeOf`: what a page writes for the player's finish ("T17", "36T", "CUT") -> place and tie, or a result;
 * - `tourOf`: a world ranking's tour column ("DPWT", "LPGA") -> a tour key, or none;
 * - `isoWeek`: a week as prores/1 writes it ("2026-W47").
 *
 * The schema (spec/prores/prores-1.schema.json) is the authority on the batch.
 */

import tours from '../../../spec/prores/tours.json' with { type: 'json' };
import type { Reason } from './olmd.ts';

export const PRORES_FORMAT = 'prores/1';
/** The handicap target API's provider of this kind: pairing with `kind=pro` names it. */
export const PRO_PROVIDER = 'pro';

export type ProTour = 'pro_golf_tour' | 'alps' | 'hotelplanner' | 'dp_world' | 'korn_ferry' | 'pga_tour' | 'let_access' | 'let' | 'epson' | 'lpga' | 'other';
/** A page a client reads: a world ranking, or a tour (`tour:<key>`). */
export type ProSite = 'owgr' | 'rolex' | `tour:${ProTour}`;
export type ProResult = 'MC' | 'WD' | 'DQ' | 'DNS';

export interface ProRanking {
  source: ProSite;
  rank?: number;
  points?: number;
  events?: number;
  as_of: string;
}

export interface ProRound {
  round_no: number;
  played_on?: string;
  gross?: number;
  par?: number;
  holes?: 9 | 18;
}

export interface ProTournament {
  ref: string;
  tour?: ProTour;
  name?: string;
  venue?: string;
  country?: string;
  start?: string;
  end?: string;
  /** The ISO week it ended in (`YYYY-Www`), where the page names a week and no day. */
  week?: string;
  place?: number;
  tied?: boolean;
  result?: ProResult;
  field?: number;
  points?: number;
  rounds?: ProRound[];
}

export interface ProStats {
  tour?: ProTour;
  season: number;
  as_of: string;
  values: Record<string, number>;
}

export interface ProresBatch {
  format: typeof PRORES_FORMAT;
  provider: typeof PRO_PROVIDER;
  site: ProSite;
  account_ref: string;
  generated_at: string;
  generator?: { name: string; version?: string };
  sync?: { plan_id?: string; reason?: Reason };
  player: { name: string; confirmed?: boolean };
  rankings?: ProRanking[];
  tournaments?: ProTournament[];
  stats?: ProStats[];
  notice?: { code: 'signed_out' | 'guard_limit' | 'partial' | 'changed_page'; message?: string };
}

/** At most this much in one batch (the schema's maxItems). */
export const PRORES_MAX = { tournaments: 300, rankings: 20, stats: 10, rounds: 500 } as const;

const RESULT: Readonly<Record<string, ProResult>> = { MC: 'MC', CUT: 'MC', WD: 'WD', RTD: 'WD', DQ: 'DQ', DSQ: 'DQ', DNS: 'DNS' };
const PLACE = /^(?:T(\d{1,3})|(\d{1,3})(T?))$/;

/** The player's finish as a page writes it: `{place, tied?}` or `{result}`; anything else (a bonus line, a dash) none. */
export function placeOf(text: unknown): { place: number; tied?: true } | { result: ProResult } | null {
  if (typeof text !== 'string') return null;
  const s = text.replace(/\s+/g, '').toUpperCase();
  const result = Object.hasOwn(RESULT, s) ? RESULT[s] : undefined;
  if (result) return { result };
  const m = PLACE.exec(s);
  if (!m) return null;
  const n = Number(m[1] ?? m[2]);
  if (n < 1 || n > 999) return null;
  return m[1] !== undefined || m[3] ? { place: n, tied: true } : { place: n };
}

/** What a world ranking's own table writes in its tour column (spec/prores/tours.json, normative). */
export const TOUR_CODES: Readonly<Record<string, Readonly<Record<string, ProTour>>>> = Object.fromEntries(
  Object.entries(tours).filter(([k]) => !k.startsWith('$')),
) as Record<string, Record<string, ProTour>>;

/** A world ranking's tour code -> a tour of prores/1, or none (a major, a tour this version doesn't know). */
export function tourOf(site: unknown, code: unknown): ProTour | null {
  if (typeof site !== 'string' || typeof code !== 'string') return null;
  const of = Object.hasOwn(TOUR_CODES, site) ? TOUR_CODES[site] : undefined;
  const key = code.trim().toUpperCase();
  return of && Object.hasOwn(of, key) ? (of[key] ?? null) : null;
}

const WEEK = /^(\d{4})-W(\d{2})$/;

/** The number of ISO weeks of a year: the week 28 December falls in. */
function weeksIn(year: number): number {
  return Number(weekOf(`${String(year).padStart(4, '0')}-12-28`)?.slice(6) ?? 52);
}

/** Whether a week is written as prores/1 wants it: `YYYY-Www`, a week that exists in that year. */
export function isoWeek(week: unknown): boolean {
  const m = typeof week === 'string' ? WEEK.exec(week) : null;
  if (!m) return false;
  const n = Number(m[2]);
  return n >= 1 && n <= weeksIn(Number(m[1]));
}

/** The ISO week a day falls in, as `YYYY-Www` (the day as YYYY-MM-DD, read as a calendar day). */
export function weekOf(day: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime()) || d.getUTCDate() !== Number(m[3])) return null;
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); // that week's Thursday names its year
  const year = d.getUTCFullYear();
  const n = 1 + Math.floor((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 / 7);
  return `${year}-W${String(n).padStart(2, '0')}`;
}
