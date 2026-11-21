// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * golf.de's entries of the handicap record, as dgvhcp/1 results (spec/hcp.md). A whitelist: each field the mapping
 * knows is read, checked and renamed; everything else - names, card and member numbers, fields nobody mapped - is
 * simply never copied. A value of the wrong kind or out of its range is left out, never bent into it; nothing is
 * worked out (a Score Differential is read, never computed).
 *
 * The field names are those of golf.de's History Sheet (`HandicapHistoryRecord`) and Scoring Record, as listed in the
 * project's notes on the page's shape; the values in the tests are made up in that shape.
 */

import type { HcpResult } from '@glmsync/core';

export type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : null);

/** A number as the record gives it: a JSON number, or a numeric text (also with a decimal comma). */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!/^-?\d{1,4}(?:[.,]\d{1,6})?$/.test(t)) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function inRange(v: unknown, lo: number, hi: number): number | null {
  const n = num(v);
  return n !== null && n >= lo && n <= hi ? n : null;
}

function whole(v: unknown, lo: number, hi: number): number | null {
  const n = inRange(v, lo, hi);
  return n !== null && Number.isInteger(n) ? n : null;
}

function text(v: unknown, most: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > 0 && t.length <= most ? t : null;
}

/** The day of a time as the record gives it (its own offset: the day the round was played there). */
export function dayOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(v.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const digits = (v: unknown, most: number): string | null => {
  const s = typeof v === 'number' && Number.isInteger(v) && v >= 0 ? String(v) : typeof v === 'string' ? v.trim() : '';
  return new RegExp(`^[0-9]{1,${most}}$`).test(s) ? s : null;
};

const STATUSES = new Set(['TA', 'NA', 'NRA', 'NRO', 'DQA', 'DQO']);
const ARTS = new Set(['Z', 'S', 'H', 'P', 'G']);
/** A registered private round's "name" is its marker's (`RPR: …`, `EDS: …`). */
const MARKER = /^\s*(rpr|eds)\s*:/i;

/** Where an entry was read: what each list gives differs a little. */
export type Sheet = 'history' | 'scoring';

/**
 * One entry of the History Sheet or the Scoring Record as a dgvhcp/1 result, or null without a day (or without
 * anything that tells its holes: the schema needs one of holes, par or rating).
 */
export function resultOf(raw: unknown, sheet: Sheet): HcpResult | null {
  const e = obj(raw);
  if (!e) return null;
  const day = dayOf(e.tournamentDate);
  if (!day) return null;
  const r: HcpResult = { played_on: day };
  const ref = text(e.resultGuid, 100);
  if (ref) r.ref = ref;
  const type = whole(e.tournamentType, 0, 999);
  // 1 a tournament, 8 a registered private round (seen so far); any other type says nothing we know.
  const rpr = type === 8 || (typeof e.tournamentName === 'string' && MARKER.test(e.tournamentName));
  if (rpr) {
    r.format = 'rpr';
    r.kind = 'private';
  } else if (type === 1) {
    r.format = 'single';
    r.kind = 'tournament';
    const name = text(e.tournamentName, 200);
    if (name) r.name = name;
  } else {
    const name = text(e.tournamentName, 200);
    if (name) r.name = name;
  }
  const club = text(e.tournamentClubName, 200);
  if (club) r.club_name = club;
  const clubNo = digits(e.tournamentClubNumber, 6);
  if (clubNo) r.club_no = clubNo;
  const course = digits(e.tournamentCourse, 10);
  if (course) r.course_no = course;
  const country = digits(e.countryCode, 4);
  if (country) r.country = country;
  const round = whole(e.tournamentRound, 0, 8);
  if (round !== null) r.round_no = round;
  const holes = whole(e.holesPerRound, 9, 18);
  if (holes === 9 || holes === 18) r.holes_read = holes;
  const status = typeof e.resultStatus === 'string' ? e.resultStatus.trim().toUpperCase() : '';
  // `W` is what the page shows as "-": no status of the list.
  if (STATUSES.has(status)) r.status = status as NonNullable<HcpResult['status']>;
  const art = typeof e.tournamentMode === 'string' ? e.tournamentMode.trim().toUpperCase() : '';
  if (ARTS.has(art)) r.art = art as NonNullable<HcpResult['art']>;
  if (typeof e.hcpiRelevant === 'boolean') r.hcp_relevant = e.hcpiRelevant;
  if (typeof e.usedForHcpiCalculation === 'boolean') r.counting = e.usedForHcpiCalculation;
  const tee = text(e.startTeeColor, 40);
  if (tee) r.tee = tee;
  const par = whole(e.par, 27, 80);
  if (par !== null) r.par = par;
  const cr = inRange(e.courseRating, 20, 90);
  if (cr !== null) r.cr = Math.round(cr * 10) / 10;
  const slope = whole(e.slope, 55, 155);
  if (slope !== null) r.slope = slope;
  const index = inRange(e.hcpi, -10, 54);
  if (index !== null) r.hcp_index = Math.round(index * 10) / 10;
  // The course handicap as the record gives it: only a whole one (a CH with decimals is not one we round). The
  // Scoring Record's of a nine-hole result is the one for 18 there: left out.
  const ch = whole(e.courseHandicap, -20, 80);
  if (ch !== null && !(sheet === 'scoring' && r.holes_read === 9)) r.ch = ch;
  const ph = whole(e.playingHandicap, -20, 80);
  if (ph !== null) r.ph = ph;
  const gbe = whole(e.ratedGrossResult, 0, 200);
  if (gbe !== null) r.gbe = gbe;
  // Before the WHS the record has Stableford points instead of an adjusted gross score.
  const points = whole(e.ratedStablefordPoints, 0, 99);
  if (points !== null && (gbe === null || gbe === 0) && r.status !== 'NA') r.stableford_net = points;
  if (sheet === 'scoring') {
    const sd = inRange(e.scoreDifferential, -20, 80);
    if (sd !== null) r.sd = Math.round(sd * 10) / 10;
    const pcc = whole(e.pcc, -1, 3);
    if (pcc !== null) r.pcc = pcc;
    const exc = whole(e.exceptionalScoreReduction, -3, 3);
    if (exc !== null) r.exceptional = exc;
  }
  if (r.holes_read === undefined && r.par === undefined && r.cr === undefined) return null;
  return r;
}

/** The account's own details: its stable id (never a name, never a card number) and its index now. */
export function memberOf(raw: unknown): { subject: string; index?: { value: number; low?: number } } | null {
  const m = obj(raw);
  const id = typeof m?.id === 'string' ? m.id.trim() : '';
  if (!m || !id || id.length > 200) return null;
  const out: { subject: string; index?: { value: number; low?: number } } = { subject: subjectOf(id) };
  const value = inRange(m.hcpi, -10, 54);
  if (value !== null) {
    out.index = { value: Math.round(value * 10) / 10 };
    const low = inRange(m.hcpiLow, -10, 54);
    if (low !== null) out.index.low = Math.round(low * 10) / 10;
  }
  return out;
}

/**
 * The stable part of the account's id: golf.de gives a Relay id (`ReportMemberDetails:<number>` in Base64); its
 * number stays the same if the encoding ever changes. Anything else is taken as it is.
 */
export function subjectOf(id: string): string {
  try {
    const plain = atob(id);
    const m = /^ReportMemberDetails:(\d{1,20})$/.exec(plain);
    if (m) return `member:${m[1]}`;
  } catch {
    // not Base64: as it is
  }
  return id;
}
