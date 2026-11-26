// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The Alps Tour (alpstourgolf.com): the player's own profile as he opens it. Unofficial: not affiliated with, endorsed
 * by or supported by the Alps Tour or OCS Sport.
 *
 * The site is an app of OCS Sport (like the LET's, but another layout) that changes its address without loading a page.
 * His profile (`/playerprofile/<code>`, e.g. `VAN054`) shows one report at a time, picked in its own select
 * (*Select Report*); three of them hold what goes:
 *
 * - **This Season record**: the running season's tournaments with their first day, his place, **every round in one
 *   cell** (`69 67 73`) and the total. No par, no link.
 * - **Results**: the season picked in the report's own picker, each tournament with its total and its score to par -
 *   no rounds. Of it only the score to par is kept: with the rounds of *This Season record* it gives the par.
 * - **Order of Merit**: a line per season with his rank, points and tournaments played.
 *
 * Each report is read as the page shows it, after he picked it; what the client keeps of them is merged
 * (`mergeRead`), so his rounds go with the par and the rank once he looked at all three. A tournament goes only with
 * its rounds (decision of the target's owner), and only once it is over. His name is the line above *Represents* (no
 * heading): `snapshotAt` takes it with the snapshot. Prize money is never read.
 */

import { PRORES_MAX, type ProRanking, type ProResult, type ProRound, type ProTournament } from '@glmsync/spec';
import { dayOf, placeOf } from './ocs.ts';
import { checkTourPage, type TourPage, type TourSite } from './page.ts';
import { clean, column, snapshotOf, textOf, type DomDocument, type DomElement, type Snapshot, type Table } from './snapshot.ts';

export const TOUR = 'alps' as const;
export const SITE: TourSite = `tour:${TOUR}`;
export const ORIGIN = 'https://www.alpstourgolf.com';
const ORIGINS = new Set([ORIGIN, 'https://alpstourgolf.com']);
/** Where the module's scripts run: every page of the site, because it changes its address without loading a page. */
export const PAGE_MATCHES = ['https://www.alpstourgolf.com/*', 'https://alpstourgolf.com/*'];
/** The pair `snapshotAt` keeps his name under (the page writes it in no heading). */
export const NAME = 'Player name';

const PROFILE = /^\/playerprofile\/([A-Za-z0-9]{3,12})\/?$/;
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

/** Whether an address is on the site. */
export const onSite = (url: unknown): boolean => ORIGINS.has(urlOf(url)?.origin ?? '');

/** The player's code of a profile's address (lower case), or none. */
export function profileIdOf(url: unknown): string | null {
  const u = urlOf(url);
  return u && ORIGINS.has(u.origin) ? (PROFILE.exec(u.pathname)?.[1]?.toLowerCase() ?? null) : null;
}

const validName = (s: string): boolean => s.length >= 2 && s.length <= 120 && /\p{L}/u.test(s) && !/^[0-9]/.test(s) && !/^represents$/i.test(s);

/**
 * His name on his profile: the box just before the one whose own heading is *Represents* (the name with his flag). None
 * when the page doesn't look so.
 */
export function nameIn(doc: DomDocument): string | null {
  for (const el of Array.from(doc.querySelectorAll('div')).slice(0, 20_000)) {
    // The box of *Represents* is small; the page's wrappers aren't walked.
    if ((el.textContent ?? '').length > 200) continue;
    const own = Array.from(el.childNodes).slice(0, 50).filter((n): n is DomElement => n.nodeType === 1);
    if (!own.some((k) => k.tagName.toLowerCase() === 'h3' && clean(textOf(k)) === 'Represents')) continue;
    const prev = el.previousElementSibling;
    const name = prev && (prev.textContent ?? '').length <= 200 ? clean(textOf(prev)) : '';
    if (validName(name)) return name;
  }
  return null;
}

/** The snapshot of the page open now, with his name (`NAME`) where the page shows it. */
export function snapshotAt(doc: DomDocument, url: string): Snapshot {
  const snap = snapshotOf(doc, url);
  const name = profileIdOf(url) ? nameIn(doc) : null;
  return name ? { ...snap, pairs: { ...snap.pairs, [NAME]: name } } : snap;
}

/** A tournament of *This Season record*: no par there. */
export interface Entry {
  ref: string;
  name: string;
  start: string;
  place?: number;
  tied?: boolean;
  result?: ProResult;
  rounds: ProRound[];
}

/** A tournament's total and score to par, from *Results*. */
export interface Total {
  ref: string;
  total: number;
  to_par: number;
}

/** His line of a season of the *Order of Merit* report. */
export interface OomRow {
  season: number;
  rank?: number;
  points?: number;
  events?: number;
}

/** What his profile showed: one shape for a report read and for what the client keeps of them (`mergeRead`). */
export interface AlpsRead {
  kind: 'alps';
  player_id: string;
  player_name: string;
  /** *This Season record*, when it was read: the season's tournaments with their rounds. */
  record?: Entry[];
  totals: Total[];
  oom: OomRow[];
}

/** Why his profile couldn't be read: the site changed. */
export interface Unread {
  kind: 'unread';
  why: 'changed_page';
}

// "43,821.32" → 43821.32 (the site writes English numbers); "", "-" and anything else: none.
function numberOf(s: string | undefined): number | undefined {
  const t = (s ?? '').replace(/\s/g, '');
  if (!/^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+(\.[0-9]+)?$/.test(t)) return undefined;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n <= 1e9 ? n : undefined;
}

/** A round's strokes, never a total or a score to par. */
const strokes = (s: string): number[] =>
  clean(s)
    .split(' ')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 50 && n <= 120)
    .slice(0, 8);

// "-7", "+5", "E" or "Par" → a score to par.
function toParOf(s: string | undefined): number | undefined {
  const m = /^(E|Par|[+-]?[0-9]{1,3})$/i.exec(clean(s));
  if (!m?.[1]) return undefined;
  return /^(E|Par)$/i.test(m[1]) ? 0 : Number(m[1]);
}

/** A tournament's ref: the site links none of them on the profile, so its first day and its name made plain. */
export function refOf(start: string, name: string): string {
  const plain = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `alps-${start}-${plain}`.slice(0, 100);
}

const has = (t: Table, ...heads: string[]): boolean => heads.every((h) => column(t.head, h) >= 0);
const recordTable = (s: Snapshot) => s.tables.find((t) => has(t, 'Date', 'Name', 'Pos', 'Rounds'));
const resultsTable = (s: Snapshot) => s.tables.find((t) => has(t, 'Date', 'Name', 'Score', 'Par') && column(t.head, 'Rounds') < 0);
const oomTable = (s: Snapshot) => s.tables.find((t) => has(t, 'Season Name', 'Pos', 'Points'));

/** Whether the page shows yet what the module reads (the site draws the report a moment after the page). */
export function shows(snap: Snapshot): boolean {
  return !profileIdOf(snap.url) || (typeof snap.pairs[NAME] === 'string' && snap.tables.length > 0);
}

function recordOf(t: Table): Entry[] {
  const col = { date: column(t.head, 'Date'), name: column(t.head, 'Name'), place: column(t.head, 'Pos'), rounds: column(t.head, 'Rounds') };
  const out: Entry[] = [];
  for (const row of t.rows) {
    const name = clean(row[col.name]?.text).slice(0, 200);
    const start = dayOf(row[col.date]?.text ?? '');
    const gross = strokes(row[col.rounds]?.text ?? '');
    if (!name || !start || gross.length === 0) continue; // a line that isn't a played tournament
    const rounds = gross.map((g, i): ProRound => ({ round_no: i + 1, gross: g, holes: 18 }));
    out.push({ ref: refOf(start, name), name, start, rounds, ...placeOf(row[col.place]?.text ?? '') });
  }
  return out.slice(0, 80);
}

function totalsOf(t: Table): Total[] {
  const col = { date: column(t.head, 'Date'), name: column(t.head, 'Name'), score: column(t.head, 'Score'), par: column(t.head, 'Par') };
  const out: Total[] = [];
  for (const row of t.rows) {
    const name = clean(row[col.name]?.text).slice(0, 200);
    const start = dayOf(row[col.date]?.text ?? '');
    const total = Number(clean(row[col.score]?.text));
    const toPar = toParOf(row[col.par]?.text);
    if (!name || !start || !Number.isInteger(total) || total < 50 || total > 960 || toPar === undefined) continue;
    out.push({ ref: refOf(start, name), total, to_par: toPar });
  }
  return out.slice(0, PRORES_MAX.tournaments);
}

function oomOf(t: Table): OomRow[] {
  const col = { season: column(t.head, 'Season Name'), pos: column(t.head, 'Pos'), points: column(t.head, 'Points'), events: column(t.head, 'Tournament', 'Tournaments') };
  const out: OomRow[] = [];
  for (const row of t.rows) {
    const season = Number(SEASON.exec(clean(row[col.season]?.text))?.[1]);
    if (!(season >= 1990 && season <= 2100)) continue;
    const r: OomRow = { season };
    const rank = placeOf(row[col.pos]?.text ?? '').place;
    if (rank !== undefined) r.rank = rank;
    const points = numberOf(row[col.points]?.text);
    if (points !== undefined) r.points = points;
    const events = col.events >= 0 ? numberOf(row[col.events]?.text) : undefined;
    if (events !== undefined && Number.isInteger(events) && events <= 999) r.events = events;
    if (r.rank !== undefined || r.points !== undefined) out.push(r);
  }
  return out.slice(0, 40);
}

/**
 * His profile as it shows now (`snapshotAt`'s snapshot): the report picked there. Null when this isn't a profile;
 * `changed_page` when it is but his name can't be found. Another report (statistics, highlights) reads as nothing new.
 */
export function readPage(snap: Snapshot): AlpsRead | Unread | null {
  const id = profileIdOf(snap.url);
  if (!id) return null;
  const name = clean(snap.pairs[NAME]);
  if (!validName(name)) return { kind: 'unread', why: 'changed_page' };
  const read: AlpsRead = { kind: 'alps', player_id: id, player_name: name, totals: [], oom: [] };
  const record = recordTable(snap);
  if (record) read.record = recordOf(record);
  const results = resultsTable(snap);
  if (results) read.totals = totalsOf(results);
  const oom = oomTable(snap);
  if (oom) read.oom = oomOf(oom);
  return read;
}

/**
 * What the client keeps after a report: the read before with this one over it - another player's profile replaces it
 * all; *This Season record* replaces the one before, a tournament's total (by its ref) and a season's line of the
 * Order of Merit the older read of them.
 */
export function mergeRead(kept: AlpsRead | null, read: AlpsRead): AlpsRead {
  if (!kept || kept.player_id !== read.player_id) return read;
  const totals = new Map(kept.totals.map((t) => [t.ref, t]));
  for (const t of read.totals) totals.set(t.ref, t);
  const oom = new Map(kept.oom.map((r) => [r.season, r]));
  for (const r of read.oom) oom.set(r.season, r);
  const out: AlpsRead = {
    kind: 'alps',
    player_id: read.player_id,
    player_name: read.player_name,
    totals: [...totals.values()].slice(-PRORES_MAX.tournaments),
    oom: [...oom.values()].sort((a, b) => b.season - a.season).slice(0, 40),
  };
  const record = read.record ?? kept.record;
  if (record) out.record = record;
  return out;
}

const plusDays = (day: string, n: number): string => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** The season of what was read: the record's, else the newest of the Order of Merit. */
export function seasonOf(read: AlpsRead): number | undefined {
  const last = read.record?.map((e) => e.start).sort().at(-1);
  return last ? Number(last.slice(0, 4)) : read.oom[0]?.season;
}

/**
 * The page to send of what was read: every tournament of *This Season record* that is over, with its rounds (each with
 * the par where *Results* gave the score to par and its total agrees with the rounds), and the ranking of that season.
 * `today`: the player's day; a tournament is taken as over three days after its first (three rounds, a fourth at most
 * in a final), so one still running isn't sent half. None when there is nothing to send.
 */
export function pageOf(read: AlpsRead, today: string): TourPage | null {
  const toPar = new Map(read.totals.map((t) => [t.ref, t]));
  const tournaments: ProTournament[] = [];
  for (const e of read.record ?? []) {
    if (plusDays(e.start, 3) >= today) continue;
    const sum = e.rounds.reduce((a, r) => a + (r.gross ?? 0), 0);
    const t = toPar.get(e.ref);
    const par = t && t.total === sum ? (sum - t.to_par) / e.rounds.length : NaN;
    const rounds = e.rounds.map((r): ProRound => (Number.isInteger(par) && par >= 54 && par <= 80 ? { ...r, par } : { ...r }));
    const out: ProTournament = { ref: e.ref, tour: TOUR, name: e.name, start: e.start, rounds };
    if (e.result) out.result = e.result;
    else if (e.place !== undefined) {
      out.place = e.place;
      if (e.tied) out.tied = true;
    }
    tournaments.push(out);
  }
  const season = seasonOf(read);
  const year = Number(today.slice(0, 4));
  // A past season's ranking is its final one (as of its last tournament); the running season's is today's.
  const last = read.record?.map((e) => e.start).sort().at(-1);
  const end = last ? plusDays(last, 3) : season !== undefined ? `${season}-12-31` : today;
  const ranking: ProRanking = { source: SITE, as_of: season !== undefined && season < year && end < today ? end : today };
  const line = read.oom.find((r) => r.season === season);
  if (line?.rank !== undefined) ranking.rank = line.rank;
  if (line?.points !== undefined) ranking.points = line.points;
  const events = line?.events ?? read.record?.length;
  if (events !== undefined) ranking.events = events;
  return checkTourPage({ site: SITE, id: read.player_id, name: read.player_name, ranking, tournaments, stats: [] });
}

// What arrives from the content script (or the client's storage) is read again here, field by field.
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const str = (v: unknown, lo: number, hi: number): v is string => typeof v === 'string' && v.length >= lo && v.length <= hi;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e9;
const REF = /^[A-Za-z0-9_.:-]{1,100}$/;
const OUTCOMES = new Set(['MC', 'WD', 'DQ', 'DNS']);

function entryOf(v: unknown): Entry | null {
  const e = obj(v);
  if (!e || !str(e.ref, 1, 100) || !REF.test(e.ref) || !str(e.name, 1, 200) || !isDay(e.start) || !Array.isArray(e.rounds)) return null;
  const rounds: ProRound[] = [];
  for (const x of e.rounds.slice(0, 8)) {
    const r = obj(x);
    if (r && int(r.round_no, 1, 8) && int(r.gross, 50, 120)) rounds.push({ round_no: r.round_no, gross: r.gross, holes: 18 });
  }
  if (rounds.length === 0) return null;
  const out: Entry = { ref: e.ref, name: e.name, start: e.start, rounds };
  if (typeof e.result === 'string' && OUTCOMES.has(e.result)) out.result = e.result as ProResult;
  else if (int(e.place, 1, 999)) {
    out.place = e.place;
    if (e.tied === true) out.tied = true;
  }
  return out;
}

/** A read as it arrives from the content script (or the client's storage), read again strictly; none when its frame doesn't hold. */
export function checkRead(v: unknown): AlpsRead | null {
  const r = obj(v);
  if (!r || r.kind !== 'alps' || !str(r.player_id, 3, 12) || !/^[a-z0-9]+$/.test(r.player_id) || !str(r.player_name, 2, 120)) return null;
  const out: AlpsRead = { kind: 'alps', player_id: r.player_id, player_name: r.player_name, totals: [], oom: [] };
  if (Array.isArray(r.record)) out.record = r.record.slice(0, 80).map(entryOf).filter((e): e is Entry => e !== null);
  for (const x of Array.isArray(r.totals) ? r.totals.slice(0, PRORES_MAX.tournaments) : []) {
    const t = obj(x);
    if (t && str(t.ref, 1, 100) && REF.test(t.ref) && int(t.total, 50, 960) && int(t.to_par, -200, 200)) out.totals.push({ ref: t.ref, total: t.total, to_par: t.to_par });
  }
  for (const x of Array.isArray(r.oom) ? r.oom.slice(0, 40) : []) {
    const l = obj(x);
    if (!l || !int(l.season, 1990, 2100)) continue;
    const row: OomRow = { season: l.season };
    if (int(l.rank, 1, 1_000_000)) row.rank = l.rank;
    if (amount(l.points)) row.points = l.points;
    if (int(l.events, 0, 999)) row.events = l.events;
    if (row.rank !== undefined || row.points !== undefined) out.oom.push(row);
  }
  return out;
}
