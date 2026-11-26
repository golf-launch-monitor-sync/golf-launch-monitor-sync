// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One tournament from the golf.de page the player has open (spec/hcp.md, *Taking one tournament*, 1.19.0): the page's
 * heading and its lines under *Turnierinformationen*, read by their label, as dgvevent/1 - on the player's tap, never
 * by itself, never on a list. It reads what the page shows and asks golf.de nothing.
 *
 * - `readEventPage` is the rule (spec/reference/event.py), checked against spec/testvectors/dgvevent-page.json.
 * - `eventLinesOf` finds the heading and the lines in golf.de's page, written against the little of the DOM it needs
 *   (`PageDoc`), so it is tested without a browser: the extension's content script and the companion app's page
 *   script run it on the real one. Only the block under *Turnierinformationen* is read - not the registration box
 *   beside it, which may show the signed-in player.
 */

import type { DgvEvent, DgvEventBody } from '@glmsync/core';
import { everything, type Root } from './operate.ts';

/** The tournament calendar's pages: where a client looks for a tournament's page (and nowhere else). */
export const EVENT_PAGE_MATCHES = ['https://www.golf.de/sport/turnierkalender/*'];

export type { DgvEvent, DgvEventBody };

/** The page as a client sees it: its address, heading and lines (label, value) in the page's order. */
export interface EventPage {
  address: string;
  heading: string | null;
  lines: [string, string][];
}

export type EventRead = { event: DgvEvent } | { refused: 'not_a_tournament' | 'changed_page' };

// What JavaScript's \s is, spelt out: the Python reference uses the very same set.
const WS = '[ \\t\\n\\r\\f\\v\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';
const WS_RUN = new RegExp(`${WS}+`, 'g');
const PAGE = /^https:\/\/www\.golf\.de\/sport\/turnierkalender\/([A-Za-z0-9_-]{1,60})\.html#\/([0-9]{1,12})(?:\?[^#]*)?$/;
const ADDRESS_MOST = 2048;
const LINES_MOST = 60;
const VALUE_MOST = 500;

/** The labels, lower case with single spaces and no colon, and the field each is (golf.de's German and English page). */
export const EVENT_LABELS: Record<string, keyof DgvEvent> = {
  turnierdatum: 'date',
  'tournament date': 'date',
  turnierort: 'venue',
  'tournament location': 'venue',
  turnierart: 'play_form',
  'tournament type': 'play_form',
  'handicap-relevant': 'hcp_relevant',
  'handicap relevant': 'hcp_relevant',
  starttee: 'tee',
  'start tee': 'tee',
  startzeit: 'time',
  'start time': 'time',
  'teilnehmer maximal': 'max_players',
  'participants maximum': 'max_players',
  geschlecht: 'gender',
  gender: 'gender',
  gäste: 'guests',
  guests: 'guests',
  'offenes / geschlossenes turnier': 'open',
  'open / closed tournament': 'open',
  altersklasse: 'age_class',
  'age group': 'age_class',
  'meldeschluss online': 'entry_close_online',
  'registration deadline online': 'entry_close_online',
  'meldeschluss club': 'entry_close_club',
  'registration deadline club': 'entry_close_club',
};
const TEXTS = { venue: 200, tee: 60, gender: 60, age_class: 60 } as const;
const NAME_MOST = 200;
const PLAY_FORM_MOST = 100;
const PLAYERS_MOST = 9999;
const YES = new Set(['ja', 'yes']);
const NO = new Set(['nein', 'no']);
const OPEN = new Set(['offenes turnier', 'offen', 'open tournament', 'open']);
const CLOSED = new Set(['geschlossenes turnier', 'geschlossen', 'closed tournament', 'closed']);
const NOTHING = new Set(['-', '–', '—']);
const DAY = /([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})/;
const TIME = /([0-9]{1,2}):([0-9]{2})/;
// '…; 18 Löcher' in *Turnierart*. No look-behind: the phones' older web views don't know it.
const HOLES = new RegExp(`(^|[^0-9])([0-9]{1,2})${WS}*(?:löcher|loch|holes|hole)(?![a-zäöü])`, 'i');
const TRIM = ' \t\n\r\f\v;,-–—';
const FIELDS: (keyof DgvEvent)[] = ['id', 'url', 'name', 'date', 'time', 'venue', 'play_form', 'holes', 'hcp_relevant', 'tee', 'max_players', 'gender', 'guests', 'open', 'age_class', 'entry_close_online', 'entry_close_club'];

function trimOf(s: string, chars: string, left = true, right = true): string {
  let a = 0;
  let b = s.length;
  while (left && a < b && chars.includes(s[a] as string)) a++;
  while (right && b > a && chars.includes(s[b - 1] as string)) b--;
  return s.slice(a, b);
}

/** A text of the page with its spaces made single and trimmed; null for anything else or nothing. */
export function plainText(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > VALUE_MOST) return null;
  const s = trimOf(v.replace(WS_RUN, ' '), ' ');
  return !s || NOTHING.has(s) ? null : s;
}

/** The field a line's label is; null for a label this rule doesn't read. */
export function labelOf(v: unknown): keyof DgvEvent | null {
  const s = plainText(v);
  if (s === null) return null;
  const key = trimOf(trimOf(s, ':', false, true), ' ', false, true).toLowerCase();
  return Object.hasOwn(EVENT_LABELS, key) ? (EVENT_LABELS[key] as keyof DgvEvent) : null;
}

/** The tournament's number and its page without the search, for a tournament's page; null for any other address. */
export function eventPageOf(address: unknown): { id: string; url: string } | null {
  if (typeof address !== 'string' || address.length > ADDRESS_MOST) return null;
  const m = PAGE.exec(address);
  if (!m) return null;
  return { id: m[2] as string, url: `https://www.golf.de/sport/turnierkalender/${m[1]}.html#/${m[2]}` };
}

function dayOf(s: string): string | null {
  const m = DAY.exec(s);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  // Date.UTC carries a 31 February into March, and reads years below 100 as 19xx: the day must come back as it was.
  if (y < 1 || t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The first HH:MM in `s`, when it is a time of day. */
function timeOf(s: string): string | null {
  const m = TIME.exec(s);
  if (!m) return null;
  const [h, mi] = [Number(m[1]), Number(m[2])];
  return h <= 23 && mi <= 59 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}

function afterDay(s: string): string {
  const m = DAY.exec(s);
  return m ? s.slice(m.index + m[0].length) : '';
}

function deadlineOf(s: string): string | null {
  const d = dayOf(s);
  if (d === null) return null;
  const t = timeOf(afterDay(s));
  return t ? `${d}T${t}` : d;
}

/** *Turnierart*: the form of play as written, and the holes it names (9 or 18; any other number: none). */
function formOf(s: string): [string | null, 9 | 18 | null] {
  const m = HOLES.exec(s);
  if (!m) return [trimOf(s, TRIM) || null, null];
  const n = Number(m[2]);
  const holes = n === 9 || n === 18 ? n : null;
  const rest = `${trimOf(s.slice(0, m.index) + (m[1] as string), TRIM, false, true)} ${trimOf(s.slice(m.index + m[0].length), TRIM, true, false)}`;
  return [trimOf(rest.replace(WS_RUN, ' '), TRIM) || null, holes];
}

/** The rule: the page -> dgvevent/1's event, or why there is none. */
export function readEventPage(page: unknown): EventRead {
  const p = page && typeof page === 'object' && !Array.isArray(page) ? (page as Record<string, unknown>) : {};
  const where = eventPageOf(p.address);
  if (!where) return { refused: 'not_a_tournament' };
  const name = plainText(p.heading);
  const seen = new Map<keyof DgvEvent, string>();
  if (Array.isArray(p.lines)) {
    for (const line of p.lines.slice(0, LINES_MOST)) {
      if (!Array.isArray(line) || line.length !== 2) continue;
      const field = labelOf(line[0]);
      const value = plainText(line[1]);
      if (field && !seen.has(field) && value !== null) seen.set(field, value);
    }
  }
  const dateLine = seen.get('date');
  const first = dateLine !== undefined ? dayOf(dateLine) : null;
  if (!name || name.length > NAME_MOST || first === null || dateLine === undefined) return { refused: 'changed_page' };
  const ev: Record<string, unknown> = { id: where.id, url: where.url, name, date: first };
  const clock = seen.has('time') ? timeOf(seen.get('time') as string) : null;
  ev.time = clock ?? timeOf(afterDay(dateLine));
  for (const [k, most] of Object.entries(TEXTS) as [keyof typeof TEXTS, number][]) {
    const v = seen.get(k);
    if (v !== undefined && v.length <= most) ev[k] = v;
  }
  const formLine = seen.get('play_form');
  if (formLine !== undefined) {
    const [form, holes] = formOf(formLine);
    if (form && form.length <= PLAY_FORM_MOST) ev.play_form = form;
    if (holes) ev.holes = holes;
  }
  for (const k of ['hcp_relevant', 'guests'] as const) {
    const v = seen.get(k)?.toLowerCase();
    if (v !== undefined) ev[k] = YES.has(v) ? true : NO.has(v) ? false : null;
  }
  const open = seen.get('open')?.toLowerCase();
  if (open !== undefined) ev.open = OPEN.has(open) ? true : CLOSED.has(open) ? false : null;
  const most = seen.get('max_players');
  if (most !== undefined && /^[0-9]{1,4}$/.test(most)) {
    const n = Number(most);
    if (n >= 1 && n <= PLAYERS_MOST) ev.max_players = n;
  }
  for (const k of ['entry_close_online', 'entry_close_club'] as const) {
    const v = seen.get(k);
    if (v !== undefined) ev[k] = deadlineOf(v);
  }
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (ev[k] !== undefined && ev[k] !== null) out[k] = ev[k];
  return { event: out as unknown as DgvEvent };
}

const TEXT_OK = (v: unknown, most: number): v is string => typeof v === 'string' && v.length >= 1 && v.length <= most && plainText(v) === v;
const DAY_OK = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const HHMM_OK = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DEADLINE_OK = /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])(T([01][0-9]|2[0-3]):[0-5][0-9])?$/;

/**
 * An event read again strictly, as the schema has it (it may come from a page script, and a page can post anything):
 * every field of the right kind, nothing else, `url` the page of `id`. null: not one.
 */
export function readEvent(raw: unknown): DgvEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const e = raw as Record<string, unknown>;
  const where = eventPageOf(e.url);
  if (!where || where.url !== e.url || where.id !== e.id) return null;
  if (!TEXT_OK(e.name, NAME_MOST) || typeof e.date !== 'string' || !DAY_OK.test(e.date)) return null;
  const ok: Record<string, (v: unknown) => boolean> = {
    time: (v) => typeof v === 'string' && HHMM_OK.test(v),
    venue: (v) => TEXT_OK(v, TEXTS.venue),
    play_form: (v) => TEXT_OK(v, PLAY_FORM_MOST),
    holes: (v) => v === 9 || v === 18,
    hcp_relevant: (v) => typeof v === 'boolean',
    tee: (v) => TEXT_OK(v, TEXTS.tee),
    max_players: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= PLAYERS_MOST,
    gender: (v) => TEXT_OK(v, TEXTS.gender),
    guests: (v) => typeof v === 'boolean',
    open: (v) => typeof v === 'boolean',
    age_class: (v) => TEXT_OK(v, TEXTS.age_class),
    entry_close_online: (v) => typeof v === 'string' && DEADLINE_OK.test(v),
    entry_close_club: (v) => typeof v === 'string' && DEADLINE_OK.test(v),
  };
  for (const [k, v] of Object.entries(e)) {
    if (k === 'id' || k === 'url' || k === 'name' || k === 'date') continue;
    const check = Object.hasOwn(ok, k) ? ok[k] : undefined;
    if (!check || !check(v)) return null;
  }
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (e[k] !== undefined) out[k] = e[k];
  return out as unknown as DgvEvent;
}

/** The dgvevent/1 a client sends for `event`. */
export function eventBody(event: DgvEvent, generator?: { name: string; version?: string }): DgvEventBody {
  return { format: 'dgvevent/1', provider: 'golfde', ...(generator ? { generator } : {}), event };
}

// ---------------------------------------------------------------------------
// Finding the heading and the lines in golf.de's page
// ---------------------------------------------------------------------------

/** An element as far as it is needed to find the lines. */
export interface PageNode {
  tagName: string;
  textContent: string | null;
  children: ArrayLike<unknown>;
  parentElement: PageNode | null;
  nextElementSibling: PageNode | null;
  querySelectorAll(selector: string): ArrayLike<PageNode>;
}

export interface PageDoc {
  querySelectorAll(selector: string): ArrayLike<PageNode>;
}

/** The block's title on golf.de's German and English page. */
const TITLES = new Set(['turnierinformationen', 'tournament information']);
const UP_MOST = 4;

const leaf = (el: PageNode) => (el.children?.length ?? 0) === 0;

/**
 * A label's value: the element after it (a row of label and value as on golf.de, a table's th and td, dt and dd) unless
 * that is the next label; else the rest of its row's text (a label and its value as text in one row).
 */
function valueOf(label: PageNode, labelText: string): string | null {
  const next = label.nextElementSibling;
  if (next && labelOf(next.textContent) === null) return plainText(next.textContent ?? '');
  if (next) return null;
  const row = label.parentElement;
  const all = row && (row.children?.length ?? 0) === 1 ? plainText(row.textContent ?? '') : null;
  return all && all.length > labelText.length && all.startsWith(labelText) ? plainText(all.slice(labelText.length)) : null;
}

/**
 * The page's heading and the lines under *Turnierinformationen*, as the rule reads them; null when the block isn't on
 * the page (not loaded yet, or not a tournament's page). The heading is the last `h2` before the block.
 */
export function eventLinesOf(doc: PageDoc): Omit<EventPage, 'address'> | null {
  const all = everything(doc as unknown as Root) as unknown as PageNode[];
  const at = all.findIndex((el) => leaf(el) && TITLES.has((plainText(el.textContent ?? '') ?? '').toLowerCase()));
  if (at < 0) return null;
  const title = all[at] as PageNode;
  // Up from the title to the block that holds the lines (on golf.de its parent).
  let block: PageNode | null = title.parentElement;
  let inside: PageNode[] = [];
  for (let up = 0; block && up < UP_MOST; up++, block = block.parentElement) {
    inside = Array.from(block.querySelectorAll('*'));
    if (inside.some((el) => el !== title && leaf(el) && labelOf(el.textContent) !== null)) break;
  }
  if (!block) return null;
  const lines: [string, string][] = [];
  for (const el of inside) {
    if (lines.length >= LINES_MOST) break;
    if (el === title || !leaf(el)) continue;
    const label = plainText(el.textContent ?? '');
    if (label === null || labelOf(label) === null) continue;
    const value = valueOf(el, label);
    if (value !== null) lines.push([label, value]);
  }
  let heading: string | null = null;
  for (let i = at - 1; i >= 0; i--) {
    const el = all[i] as PageNode;
    if (/^H2$/i.test(el.tagName)) {
      heading = plainText(el.textContent ?? '');
      break;
    }
  }
  return { heading, lines };
}

/** What the page shows now: a tournament to take, or why not (`not_a_tournament` too while its lines are loading). */
export function eventOnPage(address: string, doc: PageDoc): EventRead {
  if (!eventPageOf(address)) return { refused: 'not_a_tournament' };
  let found: Omit<EventPage, 'address'> | null = null;
  try {
    found = eventLinesOf(doc);
  } catch {
    found = null;
  }
  return found ? readEventPage({ address, ...found }) : { refused: 'not_a_tournament' };
}

/** How long after the address became a tournament's page the offer shows even without its lines (golf.de may have changed). */
export const EVENT_LOADING_MS = 4000;

/**
 * Whether a client offers to take the page's tournament now: a tournament's address, and its lines there - or the
 * address `sinceMs` long enough ago that a page golf.de changed still gets an answer on the tap (it can't be read).
 */
export function offerEvent(address: string, doc: PageDoc, sinceMs: number, nowMs: number): boolean {
  if (!eventPageOf(address)) return false;
  return 'event' in eventOnPage(address, doc) || nowMs - sinceMs >= EVENT_LOADING_MS;
}
