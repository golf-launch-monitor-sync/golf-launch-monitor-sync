// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Which of golf.de's answers the page script looks at, and what it makes of them (spec/hcp.md, *A client that only
 * observes*). Pure, so it is tested without a browser; page.ts runs it in the page.
 *
 * Only these answers, all of them ones golf.de's own page asked for in the player's tab:
 *
 * - `api-v2.golf.de/graphql`, the operations `GetMemberDetails` (the account's id and index), `GetHandicapHistorySheet`
 *   (a page of the History Sheet) and `GetScoringRecords` (the Scoring Record);
 * - `api-v2.golf.de/v1.0/tournaments/<number>/results` (a tournament's result list: of each line only the result's id,
 *   its place and the size of its list - never a name);
 * - `login.golf.de/api/sessions/me` (whether the player is signed in).
 *
 * What comes out (`Seen`) is already dgvhcp/1's results and holds no name, no card or member number: that is what
 * leaves the page. `readSeen` reads it again on the extension's side, as strictly, since a page can post anything.
 */

import type { HcpResult } from '@glmsync/core';
import { memberOf, resultOf, type Raw } from './mapping.ts';

export const GRAPHQL_URL = 'https://api-v2.golf.de/graphql';
export const SESSION_URL = 'https://login.golf.de/api/sessions/me';
const RESULTS = /^https:\/\/api-v2\.golf\.de\/v1\.0\/tournaments\/(\d{1,12})\/results(?:\?.*)?$/;
export const OPERATIONS = ['GetMemberDetails', 'GetHandicapHistorySheet', 'GetScoringRecords'] as const;
export type Operation = (typeof OPERATIONS)[number];

/** The pages the extension's page script runs on (and nowhere else). */
export const PAGE_MATCHES = [
  'https://www.golf.de/mein-bereich.html*',
  'https://www.golf.de/mein-bereich/*',
  'https://www.golf.de/sport/turnierkalender/clubturniere.html*',
];
export const PAGE_ORIGIN = 'https://www.golf.de';
/** The History Sheet, where the player goes to have the record read (the target app's reminder links here). */
export const HISTORY_SHEET_URL = 'https://www.golf.de/mein-bereich/handicap-history-sheet.html';

export type Watch = { kind: 'graphql'; op: Operation } | { kind: 'results'; tournament: string } | { kind: 'session' };

/** A result list's line, reduced to what can tell the player's own: the result's id, its place, its list's size. */
export interface PlaceLine {
  ref: string;
  place: number;
  field: number;
  /** Which list of its class it stood in: the net one is the class's ranking where it has one. */
  list: 'net' | 'gross';
}

/** Which tournament a result of the History Sheet belongs to: what tells the result list to open for its place. */
export interface ListLink {
  ref: string;
  tournament: string;
}

export type Seen =
  | { kind: 'member'; subject: string; index?: { value: number; low?: number } }
  /**
   * A page of the History Sheet. `page` is its number and `next` golf.de's own cursor of the page after it (opaque,
   * passed on as the page got it, never built), `links` the tournament of each result: what a client that clicks for
   * the player needs to go on (spec/hcp.md). None of them is personal, and none goes into a batch.
   */
  | { kind: 'history'; results: HcpResult[]; total?: number; page?: number; next?: string; links?: ListLink[] }
  | { kind: 'scoring'; results: HcpResult[] }
  | { kind: 'places'; tournament: string; lines: PlaceLine[] }
  | { kind: 'signed_out' }
  | { kind: 'changed_page'; what: Watch['kind'] | Operation };

const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

function graphqlOp(url: URL, method: string, body: unknown): Operation | null {
  let op: unknown = null;
  if (method === 'GET') op = url.searchParams.get('operationName');
  else if (typeof body === 'string' && body.length <= 100_000) {
    try {
      op = obj(JSON.parse(body))?.operationName;
    } catch {
      op = null;
    }
  }
  return typeof op === 'string' && (OPERATIONS as readonly string[]).includes(op) ? (op as Operation) : null;
}

/** Whether the page script looks at the answer to this request (asked by golf.de's page); null: it doesn't. */
export function watchOf(rawUrl: unknown, rawMethod: unknown, body: unknown, base = PAGE_ORIGIN): Watch | null {
  let url: URL;
  try {
    url = new URL(String(rawUrl), base);
  } catch {
    return null;
  }
  const method = typeof rawMethod === 'string' && rawMethod ? rawMethod.toUpperCase() : 'GET';
  const plain = `${url.origin}${url.pathname}`;
  if (plain === GRAPHQL_URL) {
    const op = graphqlOp(url, method, body);
    return op ? { kind: 'graphql', op } : null;
  }
  if (method === 'GET') {
    const m = RESULTS.exec(url.href);
    if (m) return { kind: 'results', tournament: m[1] as string };
    if (plain === SESSION_URL) return { kind: 'session' };
  }
  return null;
}

function authFailed(errors: unknown): boolean {
  return Array.isArray(errors) && errors.some((e) => obj(obj(e)?.extensions)?.code === 'AUTH_FAILED');
}

function reports(data: unknown): Raw | null {
  return obj(obj(obj(data)?.me)?.reports);
}

/** Entries mapped one by one; a list of entries none of which could be read is a page that changed. */
function mapped(list: unknown[], sheet: 'history' | 'scoring'): HcpResult[] | null {
  const out = list.map((e) => resultOf(e, sheet)).filter((r): r is HcpResult => r !== null);
  return list.length && !out.length ? null : out;
}

function placeOf(line: Raw): number | null {
  for (const k of ['rank', 'placement']) {
    const v = line[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999) return v;
  }
  return null;
}

function placesOf(body: unknown, tournament: string): Seen {
  const rounds = obj(body)?.rounds;
  if (!Array.isArray(rounds)) return { kind: 'changed_page', what: 'results' };
  const lines: PlaceLine[] = [];
  for (const round of rounds) {
    const classes = obj(round)?.resultClasses;
    if (!Array.isArray(classes)) continue;
    for (const cls of classes) {
      const c = obj(cls);
      if (!c) continue;
      for (const [key, list] of [['netResults', 'net'], ['grossResults', 'gross']] as const) {
        const rows = c[key];
        if (!Array.isArray(rows)) continue;
        for (const row of rows) {
          const r = obj(row);
          const ref = typeof r?.resultGuid === 'string' ? r.resultGuid.trim() : '';
          const place = r ? placeOf(r) : null;
          if (!ref || ref.length > 100 || place === null || rows.length > 999) continue;
          lines.push({ ref, place, field: rows.length, list });
        }
      }
    }
  }
  return { kind: 'places', tournament, lines };
}

const CURSOR = /^[A-Za-z0-9+/=_.:-]{1,300}$/;

function cursorOf(v: unknown): { cursor: string; page: number } | null {
  const c = obj(v);
  const page = c?.page;
  if (!c || typeof c.cursor !== 'string' || !CURSOR.test(c.cursor)) return null;
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 && page <= 10_000 ? { cursor: c.cursor, page } : null;
}

/** This page's number and golf.de's cursor of the next one (`RelativePageInfo`), as far as the answer says them. */
function pagingOf(info: unknown): { page?: number; next?: string } {
  const i = obj(info);
  const current = cursorOf(i?.currentCursor);
  if (!i || !current) return {};
  const forward = (Array.isArray(i.forwardCursors) ? i.forwardCursors : []).map(cursorOf).filter((c): c is { cursor: string; page: number } => !!c && c.page > current.page);
  forward.sort((a, b) => a.page - b.page);
  const next = forward[0];
  return next ? { page: current.page, next: next.cursor } : { page: current.page };
}

/** The tournament of each entry (golf.de's number of it, which its result list's address carries), by the result's id. */
function linksOf(nodes: unknown[]): ListLink[] {
  const out: ListLink[] = [];
  for (const n of nodes) {
    const e = obj(n);
    const ref = typeof e?.resultGuid === 'string' ? e.resultGuid.trim() : '';
    const t = e?.scorecardTournamentNumber;
    const tournament = typeof t === 'number' && Number.isInteger(t) && t > 0 ? String(t) : typeof t === 'string' ? t.trim() : '';
    if (ref && ref.length <= 100 && /^[0-9]{1,12}$/.test(tournament)) out.push({ ref, tournament });
  }
  return out;
}

/**
 * What the page script makes of one answer it watches (`status` its HTTP status, `body` its parsed JSON); null when
 * there is nothing to say (an answer golf.de's page will show as an error itself, an empty one).
 */
export function reduce(watch: Watch, status: number, body: unknown): Seen | null {
  if (watch.kind === 'session') {
    if (status === 401) return { kind: 'signed_out' };
    return status === 200 && obj(body)?.authenticated === false ? { kind: 'signed_out' } : null;
  }
  if (status === 401) return { kind: 'signed_out' };
  if (status !== 200) return null;
  if (watch.kind === 'results') return placesOf(body, watch.tournament);
  const b = obj(body);
  if (!b) return { kind: 'changed_page', what: watch.op };
  if (authFailed(b.errors)) return { kind: 'signed_out' };
  const rep = reports(b.data);
  if (!rep) return b.errors ? null : { kind: 'changed_page', what: watch.op };
  switch (watch.op) {
    case 'GetMemberDetails': {
      const m = memberOf(rep.memberDetails);
      return m ? { kind: 'member', ...m } : { kind: 'changed_page', what: watch.op };
    }
    case 'GetHandicapHistorySheet': {
      const sheet = obj(rep.handicapHistorySheet);
      if (!sheet || !Array.isArray(sheet.nodes)) return { kind: 'changed_page', what: watch.op };
      const results = mapped(sheet.nodes, 'history');
      if (!results) return { kind: 'changed_page', what: watch.op };
      const out: Extract<Seen, { kind: 'history' }> = { kind: 'history', results };
      const total = sheet.totalCount;
      if (typeof total === 'number' && Number.isInteger(total) && total >= 0) out.total = total;
      Object.assign(out, pagingOf(sheet.pageInfo));
      const links = linksOf(sheet.nodes);
      if (links.length) out.links = links;
      return out;
    }
    case 'GetScoringRecords': {
      if (!Array.isArray(rep.scoringRecords)) return { kind: 'changed_page', what: watch.op };
      const results = mapped(rep.scoringRecords, 'scoring');
      return results ? { kind: 'scoring', results } : { kind: 'changed_page', what: watch.op };
    }
  }
}

// ---------------------------------------------------------------------------
// The extension's side: what a page posted, read again
// ---------------------------------------------------------------------------

const KNOWN: ReadonlySet<string> = new Set([
  'played_on', 'ref', 'name', 'club_name', 'club_no', 'course_no', 'country', 'round_no', 'holes_read', 'kind',
  'hcp_relevant', 'status', 'format', 'art', 'tee', 'par', 'cr', 'slope', 'hcp_index', 'ch', 'ph', 'gbe',
  'stableford_net', 'sd', 'pcc', 'exceptional', 'counting',
]);
const RANGES: Record<string, [number, number, boolean]> = {
  round_no: [0, 8, true], par: [27, 80, true], cr: [20, 90, false], slope: [55, 155, true], hcp_index: [-10, 54, false],
  ch: [-20, 80, true], ph: [-20, 80, true], gbe: [0, 200, true], stableford_net: [0, 99, true], sd: [-20, 80, false],
  pcc: [-1, 3, true], exceptional: [-3, 3, true],
};
const TEXTS: Record<string, number> = { ref: 100, name: 200, club_name: 200, tee: 40, course_no: 10 };
const CHOICES: Record<string, readonly unknown[]> = {
  holes_read: [9, 18], kind: ['tournament', 'private', 'foreign', 'adjustment'], status: ['TA', 'NA', 'NRA', 'NRO', 'DQA', 'DQO'],
  format: ['single', 'rpr'], art: ['Z', 'S', 'H', 'P', 'G'],
};

/** A result as dgvhcp/1 has it, field by field; null without its day or anything that tells its holes. */
export function readResult(raw: unknown): HcpResult | null {
  const r = obj(raw);
  if (!r || typeof r.played_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.played_on)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (!KNOWN.has(k)) continue;
    const range = RANGES[k];
    if (range) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= range[0] && v <= range[1] && (!range[2] || Number.isInteger(v))) out[k] = v;
    } else if (k in TEXTS) {
      if (typeof v === 'string' && v.length >= 1 && v.length <= (TEXTS[k] as number)) out[k] = v;
    } else if (k in CHOICES) {
      if ((CHOICES[k] as readonly unknown[]).includes(v)) out[k] = v;
    } else if (k === 'hcp_relevant' || k === 'counting') {
      if (typeof v === 'boolean') out[k] = v;
    } else if (k === 'club_no') {
      if (typeof v === 'string' && /^[0-9]{1,6}$/.test(v)) out[k] = v;
    } else if (k === 'country') {
      if (typeof v === 'string' && /^[0-9]{1,4}$/.test(v)) out[k] = v;
    } else out[k] = v; // played_on, checked above
  }
  if (out.format === 'rpr') delete out.name; // never a marker's name
  if (out.holes_read === undefined && out.par === undefined && out.cr === undefined) return null;
  return out as unknown as HcpResult;
}

function results(v: unknown, most = 50): HcpResult[] | null {
  if (!Array.isArray(v) || v.length > most) return null;
  return v.map(readResult).filter((r): r is HcpResult => r !== null);
}

const hcp = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= -10 && v <= 54 ? v : null);

/** What the page script posted, read strictly (anything that isn't one is null). */
export function readSeen(raw: unknown): Seen | null {
  const s = obj(raw);
  if (!s) return null;
  switch (s.kind) {
    case 'member': {
      if (typeof s.subject !== 'string' || !s.subject || s.subject.length > 200) return null;
      const out: Extract<Seen, { kind: 'member' }> = { kind: 'member', subject: s.subject };
      const i = obj(s.index);
      const value = hcp(i?.value);
      if (value !== null) {
        out.index = { value };
        const low = hcp(i?.low);
        if (low !== null) out.index.low = low;
      }
      return out;
    }
    case 'history': {
      const list = results(s.results);
      if (!list) return null;
      const out: Extract<Seen, { kind: 'history' }> = { kind: 'history', results: list };
      if (typeof s.total === 'number' && Number.isInteger(s.total) && s.total >= 0) out.total = s.total;
      if (typeof s.page === 'number' && Number.isInteger(s.page) && s.page >= 1 && s.page <= 10_000) out.page = s.page;
      if (typeof s.next === 'string' && CURSOR.test(s.next)) out.next = s.next;
      if (Array.isArray(s.links) && s.links.length <= 50) {
        const links: ListLink[] = [];
        for (const l of s.links) {
          const o = obj(l);
          if (o && typeof o.ref === 'string' && o.ref && o.ref.length <= 100 && typeof o.tournament === 'string' && /^[0-9]{1,12}$/.test(o.tournament)) links.push({ ref: o.ref, tournament: o.tournament });
        }
        if (links.length) out.links = links;
      }
      return out;
    }
    case 'scoring': {
      const list = results(s.results);
      return list ? { kind: 'scoring', results: list } : null;
    }
    case 'places': {
      if (typeof s.tournament !== 'string' || !/^\d{1,12}$/.test(s.tournament) || !Array.isArray(s.lines) || s.lines.length > 5000) return null;
      const lines: PlaceLine[] = [];
      for (const l of s.lines) {
        const o = obj(l);
        if (!o || typeof o.ref !== 'string' || !o.ref || o.ref.length > 100) continue;
        const place = o.place;
        const field = o.field;
        if (typeof place !== 'number' || !Number.isInteger(place) || place < 1 || place > 999) continue;
        if (typeof field !== 'number' || !Number.isInteger(field) || field < place || field > 999) continue;
        if (o.list !== 'net' && o.list !== 'gross') continue;
        lines.push({ ref: o.ref, place, field, list: o.list });
      }
      return { kind: 'places', tournament: s.tournament, lines };
    }
    case 'signed_out':
      return { kind: 'signed_out' };
    case 'changed_page':
      return typeof s.what === 'string' && s.what.length <= 40 ? { kind: 'changed_page', what: s.what as Extract<Seen, { kind: 'changed_page' }>['what'] } : null;
    default:
      return null;
  }
}

/** The player's own line of a result list: the one whose result the record named, from the net list where it is. */
export function ownLine(lines: readonly PlaceLine[], ref: string): PlaceLine | null {
  const mine = lines.filter((l) => l.ref === ref);
  return mine.find((l) => l.list === 'net') ?? mine[0] ?? null;
}
