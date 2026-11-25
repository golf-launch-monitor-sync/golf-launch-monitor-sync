// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The Ladies European Tour (ladieseuropeantour.com) and the LET Access Series (letaccess.com): the player's own pages as
 * she opens them. Both sites are built on one platform (OCS Sport) with one page per player, the same ids on both.
 * Unofficial: not affiliated with, endorsed by or supported by the Ladies European Tour, the LET Access Series or OCS.
 *
 * Two kinds of page, both drawn by the site's own script from what it loads (read as shown, after it showed it):
 *
 * - **Her profile** (`/player-profiles/<id>/`): her results of the season picked there - per tournament its start, her
 *   place, every round's strokes and the total with its score to par. The par of a round follows from those (the total
 *   minus its score to par, over the rounds), so no tournament's page needs opening. No rank on the profile.
 * - **The Order of Merit** (`/order-of-merit`, `/letas-order-of-merits`): of the whole table only her own line, found by
 *   the link to her profile (never by a name): rank, points, events. The other lines never leave the page's script.
 *
 * A tournament goes only with its rounds (decision of the target's owner), and only once it is over.
 */

import { placeOf as finishOf, type ProRanking, type ProResult, type ProRound, type ProTour, type ProTournament } from '@glmsync/spec';
import type { TourPage, TourSite } from './page.ts';
import { clean, column, type Cell, type Snapshot } from './snapshot.ts';

export interface OcsSite {
  site: TourSite;
  tour: ProTour;
  origin: string;
  /** The tour's own short name, in front of a tournament's ref. */
  prefix: string;
  /** The path of the season's Order of Merit. */
  oom: string;
}

export const SITES = {
  'tour:let': { site: 'tour:let', tour: 'let', origin: 'https://ladieseuropeantour.com', prefix: 'let', oom: '/order-of-merit' },
  'tour:let_access': { site: 'tour:let_access', tour: 'let_access', origin: 'https://letaccess.com', prefix: 'letas', oom: '/letas-order-of-merits' },
} as const satisfies Record<string, OcsSite>;

export type OcsTourSite = keyof typeof SITES;
export const isOcsSite = (v: unknown): v is OcsTourSite => typeof v === 'string' && Object.hasOwn(SITES, v);

/** Where the module's scripts run (the extension's content scripts): every page of both sites, because each is one app
 * that changes its address without loading a page. */
export const PAGE_MATCHES = Object.values(SITES).map((s) => `${s.origin}/*`);

const PROFILE = /^\/player-profiles\/([0-9]{3,10})\/?$/;
const OOM = /^\/(?:letas-)?order-of-merits?\/?$/;
const TOURNAMENT = /^\/tournaments?(?:-information)?\/([A-Za-z0-9]{1,20})\/([0-9]{4})\/?$/;
const SEASON = /^([0-9]{4}) Season$/i;

function urlOf(url: unknown): URL | null {
  if (typeof url !== 'string' || url.length > 2048) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/** The site an address is on, or none. */
export function siteAt(url: unknown): (typeof SITES)[OcsTourSite] | null {
  const u = urlOf(url);
  return u ? (Object.values(SITES).find((s) => s.origin === u.origin) ?? null) : null;
}

/** The player's id of a profile's address, or none. */
export function profileIdOf(url: unknown): string | null {
  const u = urlOf(url);
  return u && siteAt(url) ? (PROFILE.exec(u.pathname)?.[1] ?? null) : null;
}

/** Whether an address is a site's Order of Merit. */
export function isOomPage(url: unknown): boolean {
  const u = urlOf(url);
  return !!u && !!siteAt(url) && OOM.test(u.pathname);
}

export interface Entry {
  ref: string;
  name: string;
  start: string;
  place?: number;
  tied?: boolean;
  result?: ProResult;
  points?: number;
  rounds: ProRound[];
}

export interface Profile {
  kind: 'profile';
  site: OcsTourSite;
  player_id: string;
  player_name: string;
  season: number;
  entries: Entry[];
}

/** Her line of a season's Order of Merit - nothing of anyone else. */
export interface OomLine {
  kind: 'oom';
  site: OcsTourSite;
  player_id: string;
  season: number;
  rank?: number;
  points?: number;
  events?: number;
}

/** Why a page that should be one of ours couldn't be read: the site changed, she isn't on it, or it shows no results. */
export interface Unread {
  kind: 'unread';
  why: 'changed_page' | 'not_him' | 'no_result';
}

// "12/04/26" or "12/04/2026" → "2026-04-12"
export function dayOf(s: string): string | undefined {
  const m = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{2}|[0-9]{4})$/.exec(s.trim());
  if (!m) return undefined;
  const [d, mo] = [Number(m[1]), Number(m[2])];
  const y = m[3]?.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "2,145.14" → 2145.14 (the sites write English numbers); "", "-" and anything else: none.
function numberOf(s: string): number | undefined {
  const t = s.replace(/\s/g, '');
  if (!/^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+(\.[0-9]+)?$/.test(t)) return undefined;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : undefined;
}

/** A place as the sites write it: "9=" is tied 9th; "MC", "W/D", "DQ" by the spec's rule; "-": nothing. */
export function placeOf(s: string): { place?: number; tied?: boolean; result?: ProResult } {
  const t = s.trim().replace(/\//g, '').replace(/^([0-9]{1,3})=$/, 'T$1');
  const f = finishOf(t);
  if (!f) return {};
  return 'result' in f ? { result: f.result } : f.tied ? { place: f.place, tied: true } : { place: f.place };
}

/** A round's strokes, never a score to par or a total. */
const strokes = (s: string): number[] =>
  clean(s)
    .split(' ')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 50 && n <= 120)
    .slice(0, 8);

// "210 (-6)" → { total: 210, toPar: -6 }; "(E)" or "(Par)" is level.
function totalOf(s: string): { total: number; toPar: number } | undefined {
  const m = /^([0-9]{2,4})\s*\(\s*(E|Par|[+-]?[0-9]{1,3})\s*\)$/i.exec(clean(s));
  if (!m) return undefined;
  const toPar = /^(E|Par)$/i.test(m[2] ?? '') ? 0 : Number(m[2]);
  return { total: Number(m[1]), toPar };
}

const seasonOf = (snap: Snapshot): number | undefined => {
  for (const s of snap.selected ?? []) {
    const y = Number(SEASON.exec(clean(s))?.[1]);
    if (y >= 1990 && y <= 2100) return y;
  }
  return undefined;
};

function refOf(cell: Cell | undefined, site: OcsSite, start: string, name: string): string {
  const u = urlOf(cell?.href);
  const m = u && u.origin === site.origin ? TOURNAMENT.exec(u.pathname) : null;
  if (m?.[1] && m[2]) return `${site.prefix}-${m[1].toLowerCase()}-${m[2]}`;
  // No link of the site's own: the start and the name made plain.
  const plain = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${site.prefix}-${start}-${plain}`.slice(0, 100);
}

/** Her profile: the season's results with their rounds. Null when this isn't a profile. */
export function readProfile(snap: Snapshot): Profile | Unread | null {
  const site = siteAt(snap.url);
  const id = profileIdOf(snap.url);
  if (!site || !id) return null;
  const table = snap.tables.find((t) => column(t.head, 'Tournaments', 'Tournament') >= 0 && column(t.head, 'Rounds') >= 0);
  // A player without results this season (or whose results the site hasn't shown yet).
  if (!table) return { kind: 'unread', why: 'no_result' };
  const col = {
    name: column(table.head, 'Tournaments', 'Tournament'),
    date: column(table.head, 'Date'),
    place: column(table.head, 'Position', 'Pos'),
    rounds: column(table.head, 'Rounds'),
    total: column(table.head, 'Total'),
    points: column(table.head, 'Points'),
  };
  // Her name: the heading above her season's figures ("53 Tournaments Played").
  const at = snap.lines.findIndex((l) => /\bTournaments Played$/i.test(l));
  const name = at > 0 ? clean(snap.lines[at - 1]) : '';
  if (col.date < 0 || col.place < 0 || name.length < 2 || /^[0-9]/.test(name)) return { kind: 'unread', why: 'changed_page' };
  const entries: Entry[] = [];
  for (const row of table.rows) {
    const cell = row[col.name];
    const title = clean(cell?.text).slice(0, 200);
    const start = dayOf(row[col.date]?.text ?? '');
    const gross = strokes(row[col.rounds]?.text ?? '');
    if (!title || !start || gross.length === 0) continue; // a line that isn't a played tournament
    const total = col.total >= 0 ? totalOf(row[col.total]?.text ?? '') : undefined;
    const sum = gross.reduce((a, b) => a + b, 0);
    // The par of a round only when the page's own total agrees with the rounds and gives a whole par.
    const par = total && total.total === sum ? (sum - total.toPar) / gross.length : NaN;
    const rounds = gross.map((g, i): ProRound => (Number.isInteger(par) && par >= 54 && par <= 80 ? { round_no: i + 1, gross: g, par, holes: 18 } : { round_no: i + 1, gross: g, holes: 18 }));
    const e: Entry = { ref: refOf(cell, site, start, title), name: title, start, rounds, ...placeOf(row[col.place]?.text ?? '') };
    const points = col.points >= 0 ? numberOf(row[col.points]?.text ?? '') : undefined;
    if (points !== undefined) e.points = points;
    entries.push(e);
  }
  const season = seasonOf(snap) ?? Number((entries.map((e) => e.start).sort().at(-1) ?? new Date().toISOString()).slice(0, 4));
  return { kind: 'profile', site: site.site, player_id: id, player_name: name.slice(0, 120), season, entries };
}

/** Her line of the Order of Merit (`playerId`: of the profile read last). Null when this isn't the Order of Merit. */
export function readOom(snap: Snapshot, playerId: string): OomLine | Unread | null {
  const site = siteAt(snap.url);
  if (!site || !isOomPage(snap.url)) return null;
  const table = snap.tables.find((t) => column(t.head, 'Pos') >= 0 && column(t.head, 'Name') >= 0 && column(t.head, 'Points') >= 0);
  if (!table) return { kind: 'unread', why: 'changed_page' };
  const mine = table.rows.filter((r) => r.some((c) => profileIdOf(c.href) === playerId));
  // Not on the table (or twice, which a table shouldn't): take nothing.
  if (mine.length !== 1 || !mine[0]) return { kind: 'unread', why: 'not_him' };
  const row = mine[0];
  const fromUrl = Number(urlOf(snap.url)?.searchParams.get('id'));
  const season = seasonOf(snap) ?? (fromUrl >= 1990 && fromUrl <= 2100 ? fromUrl : undefined);
  if (season === undefined) return { kind: 'unread', why: 'changed_page' };
  const out: OomLine = { kind: 'oom', site: site.site, player_id: playerId, season };
  const rank = placeOf(row[column(table.head, 'Pos')]?.text ?? '').place;
  if (rank !== undefined) out.rank = rank;
  const points = numberOf(row[column(table.head, 'Points')]?.text ?? '');
  if (points !== undefined) out.points = points;
  const played = column(table.head, 'Played', 'Events', 'Tourns');
  const events = played >= 0 ? numberOf(row[played]?.text ?? '') : undefined;
  if (events !== undefined && Number.isInteger(events) && events <= 999) out.events = events;
  return out;
}

const plusDays = (day: string, n: number): string => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/**
 * What a read of her profile (and her line of that season's Order of Merit, when read) hands on: the ranking, and every
 * tournament of the season that is over with its rounds. `today`: the player's day; a tournament is taken as over three
 * days after its start (four rounds at most), so one still running isn't sent half.
 */
export function siteRead(profile: Profile, oom: OomLine | null, today: string): TourPage {
  const site = SITES[profile.site];
  const tournaments: ProTournament[] = [];
  for (const e of profile.entries) {
    if (plusDays(e.start, 3) >= today) continue;
    const t: ProTournament = { ref: e.ref, tour: site.tour, name: e.name, start: e.start, rounds: e.rounds };
    if (e.result) t.result = e.result;
    else if (e.place !== undefined) {
      t.place = e.place;
      if (e.tied) t.tied = true;
    }
    if (e.points !== undefined) t.points = e.points;
    tournaments.push(t);
  }
  // A past season's ranking is its final one (as of its last tournament); the running season's is today's.
  const last = profile.entries.map((e) => e.start).sort().at(-1);
  const end = last ? plusDays(last, 3) : today;
  const as_of = profile.season < Number(today.slice(0, 4)) && end < today ? end : today;
  const ranking: ProRanking = { source: site.site, as_of, events: profile.entries.length };
  if (oom && oom.site === profile.site && oom.player_id === profile.player_id && oom.season === profile.season) {
    if (oom.rank !== undefined) ranking.rank = oom.rank;
    if (oom.points !== undefined) ranking.points = oom.points;
    if (oom.events !== undefined) ranking.events = oom.events;
  }
  return { site: site.site, id: profile.player_id, name: profile.player_name, ranking, tournaments, stats: [] };
}

// What arrives from the content script is read again here, field by field (the site's scripts share its page).
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const str = (v: unknown, lo: number, hi: number): v is string => typeof v === 'string' && v.length >= lo && v.length <= hi;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
const OUTCOMES = new Set(['MC', 'WD', 'DQ', 'DNS']);
const ID = /^[0-9]{3,10}$/;

function roundOf(v: unknown): ProRound | null {
  const r = obj(v);
  if (!r || !int(r.round_no, 1, 8) || !int(r.gross, 50, 120)) return null;
  return int(r.par, 54, 80) ? { round_no: r.round_no, gross: r.gross, par: r.par, holes: 18 } : { round_no: r.round_no, gross: r.gross, holes: 18 };
}

/** A profile as the content script read it, read again; none when its frame doesn't hold. */
export function checkProfile(v: unknown): Profile | null {
  const p = obj(v);
  if (!p || p.kind !== 'profile' || !isOcsSite(p.site) || !str(p.player_id, 3, 10) || !ID.test(p.player_id) || !str(p.player_name, 2, 120)) return null;
  if (!int(p.season, 1990, 2100) || !Array.isArray(p.entries)) return null;
  const entries: Entry[] = [];
  for (const x of p.entries.slice(0, 80)) {
    const e = obj(x);
    if (!e || !str(e.ref, 1, 100) || !/^[A-Za-z0-9_.:-]+$/.test(e.ref) || !str(e.name, 1, 200) || !isDay(e.start) || !Array.isArray(e.rounds)) continue;
    const rounds = e.rounds.slice(0, 8).map(roundOf).filter((r): r is ProRound => r !== null);
    if (rounds.length === 0) continue;
    const out: Entry = { ref: e.ref, name: e.name, start: e.start, rounds };
    if (typeof e.result === 'string' && OUTCOMES.has(e.result)) out.result = e.result as ProResult;
    else if (int(e.place, 1, 999)) {
      out.place = e.place;
      if (e.tied === true) out.tied = true;
    }
    if (amount(e.points)) out.points = e.points;
    entries.push(out);
  }
  return { kind: 'profile', site: p.site, player_id: p.player_id, player_name: p.player_name, season: p.season, entries };
}

/** Her Order of Merit line as the content script read it, read again; none when its frame doesn't hold. */
export function checkOom(v: unknown): OomLine | null {
  const l = obj(v);
  if (!l || l.kind !== 'oom' || !isOcsSite(l.site) || !str(l.player_id, 3, 10) || !ID.test(l.player_id) || !int(l.season, 1990, 2100)) return null;
  const out: OomLine = { kind: 'oom', site: l.site, player_id: l.player_id, season: l.season };
  if (int(l.rank, 1, 1_000_000)) out.rank = l.rank;
  if (amount(l.points)) out.points = l.points;
  if (int(l.events, 0, 999)) out.events = l.events;
  return out.rank === undefined && out.points === undefined ? null : out;
}
