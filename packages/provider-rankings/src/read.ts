// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Reading a player's own page of a world ranking as the page shows it (spec/prores.md): the document the site's own
 * scripts built in the player's tab. Nothing here asks the site anything; it reads text the player sees.
 *
 * It goes by what the page *says*, not by its markup's classes: the head's figures by their labels ("Current OWGR
 * Rank", "avg pts"), the tournaments by the table whose column heads are Event, Week, Year and a finish, each column by
 * its head. A page that doesn't say what it should is read as nothing (`changed_page`), never guessed at. OWGR's table
 * comes a moment after the page: `hasTable` tells the caller whether to wait a little before it reads.
 *
 * Written against the little of the DOM it needs (`Doc`, `El`), so it is tested without a browser.
 */

import { isoWeek, placeOf, PRORES_MAX, tourOf, type ProRanking, type ProTournament } from '@glmsync/spec';
import { playerPageOf, type PlayerPage, type RankingSite } from './sites.ts';

/** An element as far as it is needed here. */
export interface El {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<El>;
}

export interface Doc {
  querySelectorAll(selector: string): ArrayLike<El>;
}

/** What one look at the page gave. */
export interface ProPage {
  site: RankingSite;
  /** The site's id of the player (from the address): what the account_ref is made of, never sent as it is. */
  id: string;
  /** The player's name as the page writes it: for the target's check, which keeps nothing of it. */
  name: string;
  ranking: ProRanking;
  /** The tournaments of the page's table; null when the table isn't on the page (then only the ranking goes). */
  tournaments: ProTournament[] | null;
}

export type PageRead =
  | { ok: true; page: ProPage }
  | { ok: false; why: 'not_player_page' | 'changed_page' };

const MOST = 20_000;
const text = (el: El | undefined | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (root: Doc | El, sel: string): El[] => Array.from(root.querySelectorAll(sel)).slice(0, MOST);
/** A name, made plain for comparing with the address: lower case, accents dropped, only letters, digits, spaces. */
const plain = (s: string): string =>
  s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** A number as the page writes it: digits, a dot for decimals, maybe thousands' commas; else none. */
export function numberOf(s: string): number | null {
  const t = s.replace(/,/g, '').trim();
  if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * A figure of the page's head: the element whose whole text is a number and then the label ("3rdCurrent OWGR Rank",
 * "26 rank"), the first one in the page. Ordinals ("3rd") read as their number.
 */
export function figureOf(doc: Doc, label: RegExp): number | null {
  const re = new RegExp(`^([0-9][0-9.,]*)(?:st|nd|rd|th)?\\s*(?:${label.source})$`, 'i');
  for (const el of all(doc, '*')) {
    const m = re.exec(text(el));
    if (m?.[1]) return numberOf(m[1]);
  }
  return null;
}

type Col = 'event' | 'tour' | 'week' | 'year' | 'finish' | 'points';
const HEADS: Readonly<Record<Col, RegExp>> = {
  event: /^event$/i,
  tour: /^tour$/i,
  week: /^week$/i,
  year: /^year$/i,
  finish: /^(?:finish pos\.?|position|pos\.?)$/i,
  // OWGR: the points won (not the weighted ones it adds up now); Rolex: its one points column.
  points: /^(?:points won|points)$/i,
};

/** The page's table of the player's tournaments, its columns by their heads; null when there is none. */
function eventsTable(doc: Doc): { rows: El[]; cols: Partial<Record<Col, number>> } | null {
  for (const table of all(doc, 'table')) {
    const heads = all(table, 'th').map(text);
    const cols: Partial<Record<Col, number>> = {};
    for (const [col, re] of Object.entries(HEADS) as [Col, RegExp][]) {
      const i = heads.findIndex((h) => re.test(h));
      if (i >= 0) cols[col] = i;
    }
    if (cols.event === undefined || cols.week === undefined || cols.year === undefined || cols.finish === undefined) continue;
    return { rows: all(table, 'tr').filter((tr) => all(tr, 'td').length > 0), cols };
  }
  return null;
}

const EVENT_LINK = /\/events\/(?:[^/?#]*-)?(\d{1,10})\/?(?:[?#]|$)/;

/** One row of the table as a tournament of prores/1; null for a line that is none (a bonus line has no event link). */
function tournamentOf(site: RankingSite, row: El, cols: Partial<Record<Col, number>>): ProTournament | null {
  const cells = all(row, 'td');
  const cell = (c: Col): El | undefined => (cols[c] === undefined ? undefined : cells[cols[c] as number]);
  const ev = cell('event');
  const link = ev ? all(ev, 'a')[0] : undefined;
  const id = EVENT_LINK.exec(link?.getAttribute('href') ?? '')?.[1];
  if (!id) return null;
  const week = numberOf(text(cell('week')));
  const year = numberOf(text(cell('year')));
  if (week === null || year === null || !Number.isInteger(week) || !Number.isInteger(year)) return null;
  const w = `${year}-W${String(week).padStart(2, '0')}`;
  if (!isoWeek(w)) return null;
  const t: ProTournament = { ref: `${site}-${id}`, week: w };
  const tour = tourOf(site, text(cell('tour')));
  if (tour) t.tour = tour;
  const name = text(link ?? ev).slice(0, 200);
  if (name) t.name = name;
  const finish = placeOf(text(cell('finish')));
  if (finish) Object.assign(t, finish);
  const points = numberOf(text(cell('points')));
  if (points !== null) t.points = points;
  return t;
}

/** The name OWGR's page writes for the player: the text that is the name its address spells, else that spelling. */
function owgrName(doc: Doc, slug: string): string {
  const want = plain(slug);
  for (const el of all(doc, '*')) {
    const s = text(el);
    if (s.length <= 120 && plain(s) === want) return s;
  }
  return want.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** The name Rolex's page writes: its title says it first ("<name> - Players - Rolex Rankings"). */
function rolexName(title: string): string | null {
  const m = /^(.{2,120}?)\s+-\s+Players\s+-\s+Rolex Rankings\s*$/.exec(title.replace(/\s+/g, ' ').trim());
  return m?.[1] ?? null;
}

/**
 * Reads the page at `url` with its document and title, on the day `today` (YYYY-MM-DD, the player's own: the ranking's
 * `as_of`, as neither page names its ranking's day).
 */
export function readPage(doc: Doc, url: string, title: string, today: string): PageRead {
  const at: PlayerPage | null = playerPageOf(url);
  if (!at) return { ok: false, why: 'not_player_page' };
  const ranking: ProRanking = { source: at.site, as_of: today };
  let rank: number | null;
  let points: number | null;
  let events: number | null;
  let name: string | null;
  if (at.site === 'owgr') {
    rank = figureOf(doc, /current owgr rank/);
    points = figureOf(doc, /average points/);
    events = figureOf(doc, /divisor/) ?? figureOf(doc, /actual events played/);
    name = at.slug ? owgrName(doc, at.slug) : null;
  } else {
    rank = figureOf(doc, /rank/);
    points = figureOf(doc, /avg pts/);
    events = figureOf(doc, /events/);
    name = rolexName(title);
  }
  if (rank === null && points === null) {
    // OWGR's head comes with the page; a page that has none of it is not the page this module knows.
    return { ok: false, why: 'changed_page' };
  }
  if (!name || name.length < 2) return { ok: false, why: 'changed_page' };
  if (rank !== null && Number.isInteger(rank) && rank >= 1 && rank <= 1_000_000) ranking.rank = rank;
  if (points !== null && points <= 1e9) ranking.points = points;
  if (events !== null && Number.isInteger(events) && events <= 999) ranking.events = events;
  if (ranking.rank === undefined && ranking.points === undefined) return { ok: false, why: 'changed_page' };
  const table = eventsTable(doc);
  let tournaments: ProTournament[] | null = null;
  if (table) {
    const seen = new Set<string>();
    tournaments = [];
    for (const row of table.rows) {
      const t = tournamentOf(at.site, row, table.cols);
      if (!t || seen.has(t.ref)) continue;
      seen.add(t.ref);
      tournaments.push(t);
      if (tournaments.length >= PRORES_MAX.tournaments) break;
    }
  }
  return { ok: true, page: { site: at.site, id: at.id, name: name.slice(0, 120), ranking, tournaments } };
}

/** Whether the page's tournaments are there yet (OWGR's table comes a moment after the page). */
export function hasTable(doc: Doc): boolean {
  return eventsTable(doc) !== null;
}

const TOURS: ReadonlySet<string> = new Set(['pro_golf_tour', 'alps', 'hotelplanner', 'dp_world', 'korn_ferry', 'pga_tour', 'let_access', 'let', 'epson', 'lpga', 'other']);
const RESULTS: ReadonlySet<string> = new Set(['MC', 'WD', 'DQ', 'DNS']);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, lo: number, hi: number): v is string => typeof v === 'string' && v.length >= lo && v.length <= hi;

/**
 * A page as it arrives from where it was read (the extension's content script, the app's window): read again strictly,
 * field by field, as from anyone - what doesn't fit is dropped, a page without its site, id, name or ranking is none.
 */
export function checkPage(v: unknown): ProPage | null {
  const p = obj(v);
  if (!p || (p.site !== 'owgr' && p.site !== 'rolex') || !str(p.id, 1, 10) || !/^\d+$/.test(p.id) || !str(p.name, 2, 120)) return null;
  const site = p.site;
  const r = obj(p.ranking);
  if (!r || r.source !== site || !str(r.as_of, 10, 10) || !DAY.test(r.as_of)) return null;
  const ranking: ProRanking = { source: site, as_of: r.as_of };
  if (int(r.rank, 1, 1_000_000)) ranking.rank = r.rank;
  if (num(r.points, 0, 1e9)) ranking.points = r.points;
  if (int(r.events, 0, 999)) ranking.events = r.events;
  if (ranking.rank === undefined && ranking.points === undefined) return null;
  let tournaments: ProTournament[] | null = null;
  if (Array.isArray(p.tournaments)) {
    tournaments = [];
    const refOf = new RegExp(`^${site}-\\d{1,10}$`);
    for (const x of p.tournaments.slice(0, PRORES_MAX.tournaments)) {
      const t = obj(x);
      if (!t || !str(t.ref, 1, 100) || !refOf.test(t.ref) || !isoWeek(t.week)) continue;
      const out: ProTournament = { ref: t.ref, week: t.week as string };
      if (typeof t.tour === 'string' && TOURS.has(t.tour)) out.tour = t.tour as ProTournament['tour'] & string;
      if (str(t.name, 1, 200)) out.name = t.name;
      if (typeof t.result === 'string' && RESULTS.has(t.result)) out.result = t.result as ProTournament['result'] & string;
      else if (int(t.place, 1, 999)) {
        out.place = t.place;
        if (t.tied === true) out.tied = true;
      }
      if (num(t.points, 0, 1e9)) out.points = t.points;
      tournaments.push(out);
    }
  }
  return { site, id: p.id, name: p.name, ranking, tournaments };
}
