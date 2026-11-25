// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Pro Golf Tour (progolftour.de), the player's own pages, as he opens them. Unofficial: not affiliated with, endorsed
 * by or supported by the Pro Golf Tour or the PGA of Germany.
 *
 * Two kinds of page, both plain HTML the site serves anyway:
 *
 * - **His profile** (`/player-profile/<id>?year=<season>`): his rank and points of the season's Order of Merit, and his
 *   tournaments of that season (start, end, name, place, Order of Merit points). No rounds.
 * - **A tournament's page** (`/tournament-details/<slug>`, its *Final result*): R1-R3 of every player of the field.
 *   Only his own line is taken (by the name of his profile), and of the field only how many played.
 *
 * A tournament becomes one of prores/1 only with its rounds, i.e. once its page was read (decision of the target's
 * owner: no list of tournaments without rounds); the profile alone gives the ranking.
 */

import { placeOf as finishOf, type ProRanking, type ProResult, type ProRound, type ProTournament } from '@glmsync/spec';
import type { TourPage } from './page.ts';
import { clean, column, nameKey, type Snapshot } from './snapshot.ts';

export const TOUR = 'pro_golf_tour' as const;
export const SITE = `tour:${TOUR}` as const;
export const ORIGIN = 'https://www.progolftour.de';
/** Where the module's scripts run (the extension's content scripts, the companion app's window). */
export const PAGE_MATCHES = ['https://www.progolftour.de/*'];
/** The labels whose values the profile shows beside them (`snapshotOf`'s `labels`). */
export const LABELS = ['Order of Merit', 'Season points', 'Golfclub:', 'Date:'] as const;

const PROFILE = /^https:\/\/www\.progolftour\.de\/player-profile\/([A-Za-z0-9-]{1,60})\/?(?:\?(?:.*&)?year=([0-9]{4})(?:&.*)?)?$/;
const RESULT = /^https:\/\/www\.progolftour\.de\/tournament-details\/([A-Za-z0-9%._-]{1,200})\/?(?:\?[^#]*)?(?:#.*)?$/;

/** A tournament's page by its path: the key that ties a profile's line to the page read later. */
export function resultKey(url: string): string | null {
  const m = RESULT.exec(url);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]).normalize('NFC').toLowerCase();
  } catch {
    return null;
  }
}

/** The address of a tournament's page, as the profile's own link has it (nothing added). */
export function resultUrl(key: string): string {
  return `${ORIGIN}/tournament-details/${encodeURIComponent(key)}`;
}

/** Whether a run may open this address: a tournament's page or a profile, nothing else of the site. */
export function mayOpen(url: unknown): boolean {
  return typeof url === 'string' && (RESULT.test(url) || PROFILE.test(url));
}

export interface Entry {
  /** `resultKey` of its page. */
  key: string;
  name: string;
  start: string;
  end?: string;
  place?: number;
  tied?: boolean;
  result?: ProResult;
  points?: number;
}

export interface Profile {
  kind: 'profile';
  player_id: string;
  player_name: string;
  season: number;
  ranking: Omit<ProRanking, 'as_of'>;
  entries: Entry[];
}

/** His line of a tournament's final result, and the facts of the tournament - nothing of anyone else. */
export interface OwnLine {
  kind: 'result';
  key: string;
  ref: string;
  name?: string;
  venue?: string;
  country?: string;
  start?: string;
  end?: string;
  place?: number;
  tied?: boolean;
  result?: ProResult;
  field: number;
  rounds: ProRound[];
}

/** Why a page that should be one of ours couldn't be read: the site changed (or it is another page of it). */
export interface Unread {
  kind: 'unread';
  why: 'changed_page' | 'not_him' | 'no_result';
}

// "19.02.2026" → "2026-02-19"
export function dayOf(s: string): string | undefined {
  const m = /^([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})$/.exec(s.trim());
  if (!m) return undefined;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return undefined;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// "17,290.60" → 17290.6 (the site writes English numbers); "—" and anything else: none.
function numberOf(s: string): number | undefined {
  const t = s.replace(/[€\s]/g, '');
  if (!/^[0-9]{1,3}(,[0-9]{3})*(\.[0-9]+)?$|^[0-9]+(\.[0-9]+)?$/.test(t)) return undefined;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : undefined;
}

/**
 * A finish as the site writes it, by the spec's rule (`placeOf` of @glmsync/spec: "T6", "MC", "RTD" …); the Order of
 * Merit writes its rank as an ordinal ("12th"), which is the same number. "—": nothing.
 */
export function placeOf(s: string): { place?: number; tied?: boolean; result?: ProResult } {
  const f = finishOf(s.trim().replace(/^([0-9]{1,3})(st|nd|rd|th)\.?$/i, '$1'));
  if (!f) return {};
  return 'result' in f ? { result: f.result } : f.tied ? { place: f.place, tied: true } : { place: f.place };
}

/** The profile: ranking and the season's tournaments. Null when this isn't a profile. */
export function readProfile(snap: Snapshot): Profile | Unread | null {
  const m = PROFILE.exec(snap.url);
  if (!m?.[1]) return null;
  const name = clean(snap.title);
  const table = snap.tables.find((t) => column(t.head, 'Tournament', 'Turnier') >= 0 && column(t.head, 'Start') >= 0);
  if (!name || !table) return { kind: 'unread', why: 'changed_page' };
  const col = {
    start: column(table.head, 'Start'),
    end: column(table.head, 'End', 'Ende'),
    name: column(table.head, 'Tournament', 'Turnier'),
    place: column(table.head, 'Position', 'Platzierung', 'Platz'),
    points: column(table.head, 'Score', 'Punkte'),
  };
  if (col.place < 0) return { kind: 'unread', why: 'changed_page' };
  const entries: Entry[] = [];
  for (const row of table.rows) {
    const cell = row[col.name];
    const start = dayOf(row[col.start]?.text ?? '');
    const key = cell?.href ? resultKey(cell.href) : null;
    if (!cell || !start || !key) continue; // a line that isn't a tournament (an ad, a note)
    const e: Entry = { key, name: clean(cell.text).slice(0, 200), start, ...placeOf(row[col.place]?.text ?? '') };
    const end = col.end >= 0 ? dayOf(row[col.end]?.text ?? '') : undefined;
    if (end && end >= start) e.end = end;
    const points = col.points >= 0 ? numberOf(row[col.points]?.text ?? '') : undefined;
    if (points !== undefined) e.points = points;
    entries.push(e);
  }
  const year = m[2] ? Number(m[2]) : Number((entries[0]?.start ?? new Date().toISOString()).slice(0, 4));
  const ranking: Omit<ProRanking, 'as_of'> = { source: SITE, events: entries.length };
  const rank = placeOf(snap.pairs['Order of Merit'] ?? '').place;
  if (rank !== undefined) ranking.rank = rank;
  const points = numberOf(snap.pairs['Season points'] ?? '');
  if (points !== undefined) ranking.points = points;
  return { kind: 'profile', player_id: m[1].toLowerCase(), player_name: name.slice(0, 200), season: year, ranking, entries };
}

/** His line of a tournament's final result (`who`: the name of his profile). Null when this isn't a tournament's page. */
export function ownLine(snap: Snapshot, who: string): OwnLine | Unread | null {
  const key = resultKey(snap.url);
  if (!key) return null;
  const table = snap.tables.find((t) => column(t.head, 'Player', 'Spieler') >= 0 && column(t.head, 'R1') >= 0);
  // Tee times, the entry list or a tournament still to be played: no final result on this page.
  if (!table) return { kind: 'unread', why: 'no_result' };
  const col = { place: column(table.head, '#', 'Pos', 'Position'), player: column(table.head, 'Player', 'Spieler') };
  const rounds: number[] = [];
  for (let n = 1; n <= 8; n += 1) rounds.push(column(table.head, `R${n}`));
  if (col.place < 0) return { kind: 'unread', why: 'changed_page' };
  const me = nameKey(who);
  const players = table.rows.filter((r) => clean(r[col.player]?.text ?? '') !== '');
  const mine = players.filter((r) => nameKey(r[col.player]?.text ?? '') === me);
  // Two lines of the same name: not knowing which is his, take neither.
  if (!me || mine.length !== 1 || !mine[0]) return { kind: 'unread', why: 'not_him' };
  const row = mine[0];
  const par = parOf(snap.lines);
  const line: OwnLine = { kind: 'result', key, ref: refOf(snap, key), field: players.length, rounds: [], ...placeOf(row[col.place]?.text ?? '') };
  rounds.forEach((c, i) => {
    const gross = c >= 0 ? Number(clean(row[c]?.text ?? '')) : NaN;
    // A round's strokes, never a "to par" or a hole number.
    if (Number.isInteger(gross) && gross >= 50 && gross <= 120) {
      line.rounds.push(par ? { round_no: i + 1, gross, par, holes: 18 } : { round_no: i + 1, gross, holes: 18 });
    }
  });
  const days = (snap.pairs['Date:'] ?? '').split(/\s+-\s+/).map(dayOf);
  if (days[0]) line.start = days[0];
  if (days[1] && days[0] && days[1] >= days[0]) line.end = days[1];
  const venue = snap.lines.map((l) => /^(.{2,200}?)\s+PAR\s+[0-9]{2}$/i.exec(l)?.[1]).find(Boolean);
  if (venue) line.venue = venue;
  const country = /,\s*([A-Za-zÀ-ÿ .'-]{2,60})$/.exec(snap.pairs['Golfclub:'] ?? '')?.[1];
  if (country) line.country = country.trim();
  const title = snap.lines.map((l) => /^Final result\s+(.{1,200})$/i.exec(l)?.[1]).find(Boolean);
  if (title) line.name = title;
  return line;
}

function parOf(lines: readonly string[]): number | undefined {
  for (const l of lines) {
    const m = /\bPAR\s+([0-9]{2})$/i.exec(l);
    const par = m ? Number(m[1]) : NaN;
    if (par >= 54 && par <= 80) return par;
  }
  return undefined;
}

// The site's own number of the tournament (its result tabs' links name it), else the page's name made plain.
function refOf(snap: Snapshot, key: string): string {
  for (const l of snap.links) {
    if (resultKey(l) !== key) continue;
    const id = /[?&]tournament=([0-9]{1,12})\b/.exec(l)?.[1];
    if (id) return `pgt-${id}`;
  }
  const plain = key.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return `pgt-${plain}`.slice(0, 100);
}

/**
 * What a read of his profile and the tournaments' pages read so far hands on: the ranking, and every finished
 * tournament of the season with its rounds (place and points from the profile where the result page has none).
 * `today`: the player's day; a tournament still running isn't sent.
 */
export function siteRead(profile: Profile, lines: Readonly<Record<string, OwnLine>>, today: string): TourPage {
  const tournaments: ProTournament[] = [];
  for (const e of profile.entries) {
    const line = lines[e.key];
    const end = line?.end ?? e.end ?? e.start;
    if (!line || line.rounds.length === 0 || end >= today) continue;
    const t: ProTournament = { ref: line.ref, tour: TOUR, name: line.name ?? e.name, start: line.start ?? e.start, end, rounds: line.rounds };
    if (line.venue) t.venue = line.venue;
    if (line.country) t.country = line.country;
    const finish = line.place !== undefined || line.result ? line : e;
    if (finish.result) t.result = finish.result;
    else if (finish.place !== undefined) {
      t.place = finish.place;
      if (finish.tied) t.tied = true;
    }
    if (line.field > 0) t.field = line.field;
    if (e.points !== undefined) t.points = e.points;
    tournaments.push(t);
  }
  // A past season's ranking is its final one (as of its last tournament); the running season's is today's.
  const last = profile.entries.map((e) => e.end ?? e.start).sort().at(-1);
  const as_of = profile.season < Number(today.slice(0, 4)) && last ? last : today;
  return {
    site: SITE,
    id: profile.player_id,
    name: profile.player_name,
    ranking: { ...profile.ranking, as_of },
    tournaments,
    stats: [],
  };
}

// What arrives from the content script is read again here, field by field (the site's scripts share its page).
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const str = (v: unknown, lo: number, hi: number): v is string => typeof v === 'string' && v.length >= lo && v.length <= hi;
const isDay = (v: unknown): v is string => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v);
const OUTCOMES = new Set(['MC', 'WD', 'DQ', 'DNS']);

function finish<T extends { place?: number; tied?: boolean; result?: ProResult }>(into: T, o: Record<string, unknown>): T {
  if (typeof o.result === 'string' && OUTCOMES.has(o.result)) into.result = o.result as ProResult;
  else if (int(o.place, 1, 999)) {
    into.place = o.place;
    if (o.tied === true) into.tied = true;
  }
  return into;
}

/** A profile as the content script read it, read again; none when its frame doesn't hold. */
export function checkProfile(v: unknown): Profile | null {
  const p = obj(v);
  const r = obj(p?.ranking);
  if (!p || p.kind !== 'profile' || !str(p.player_id, 1, 60) || !/^[a-z0-9-]+$/.test(p.player_id) || !str(p.player_name, 2, 120)) return null;
  if (!int(p.season, 1990, 2100) || !r || !Array.isArray(p.entries)) return null;
  const ranking: Omit<ProRanking, 'as_of'> = { source: SITE };
  if (int(r.rank, 1, 1_000_000)) ranking.rank = r.rank;
  if (typeof r.points === 'number' && Number.isFinite(r.points) && r.points >= 0 && r.points <= 1e9) ranking.points = r.points;
  if (int(r.events, 0, 999)) ranking.events = r.events;
  const entries: Entry[] = [];
  for (const x of p.entries.slice(0, 80)) {
    const e = obj(x);
    if (!e || !str(e.key, 1, 200) || !str(e.name, 1, 200) || !isDay(e.start)) continue;
    const out = finish<Entry>({ key: e.key, name: e.name, start: e.start }, e);
    if (isDay(e.end) && e.end >= e.start) out.end = e.end;
    if (typeof e.points === 'number' && Number.isFinite(e.points) && e.points >= 0 && e.points <= 1e9) out.points = e.points;
    entries.push(out);
  }
  return { kind: 'profile', player_id: p.player_id, player_name: p.player_name, season: p.season, ranking, entries };
}

/** His line as the content script read it, read again; none without its key, id, field or a round. */
export function checkOwnLine(v: unknown): OwnLine | null {
  const l = obj(v);
  if (!l || l.kind !== 'result' || !str(l.key, 1, 200) || !str(l.ref, 1, 100) || !/^[A-Za-z0-9_.:-]+$/.test(l.ref) || !int(l.field, 1, 999)) return null;
  const rounds: ProRound[] = [];
  for (const x of Array.isArray(l.rounds) ? l.rounds.slice(0, 8) : []) {
    const r = obj(x);
    if (!r || !int(r.round_no, 1, 8) || !int(r.gross, 50, 120)) continue;
    rounds.push(int(r.par, 54, 80) ? { round_no: r.round_no, gross: r.gross, par: r.par, holes: 18 } : { round_no: r.round_no, gross: r.gross, holes: 18 });
  }
  if (rounds.length === 0) return null;
  const out = finish<OwnLine>({ kind: 'result', key: l.key, ref: l.ref, field: l.field, rounds }, l);
  if (isDay(l.start)) out.start = l.start;
  if (isDay(l.end) && out.start && l.end >= out.start) out.end = l.end;
  for (const k of ['name', 'venue'] as const) if (str(l[k], 1, 200)) out[k] = l[k];
  if (str(l.country, 1, 60)) out.country = l.country;
  return out;
}
