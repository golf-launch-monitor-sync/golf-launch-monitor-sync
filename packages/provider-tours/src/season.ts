// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tours whose player page shows a whole season share (PGA Tour and Korn Ferry Tour, LPGA Tour and Epson Tour:
 * `pgatour.ts`, `lpga.ts`): one table of the season's tournaments with R1-R4, read on the player's *Send* - nothing is
 * opened for it. Pure.
 */

import type { ProRound } from '@glmsync/spec';
import { clean, type Cell } from './snapshot.ts';
import type { TourPage } from './page.ts';

/** Why a season page gave nothing: the site changed, a tour no module reads, or nothing to send yet. */
export interface SeasonUnread {
  kind: 'unread';
  why: 'changed_page' | 'other_tour' | 'nothing';
}

export type SeasonRead = { kind: 'page'; page: TourPage } | SeasonUnread;

/** `day` moved by `n` days. */
export function addDays(day: string, n: number): string {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** A day from its parts, if it is one. */
export function dayFrom(y: number, m: number, d: number): string | undefined {
  const t = new Date(Date.UTC(y, m - 1, d));
  if (y < 1990 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The round columns R1, R2, … of a head (-1 where there is none), and how many there are. */
export function roundColumns(head: readonly string[]): number[] {
  const out: number[] = [];
  for (let n = 1; n <= 8; n += 1) {
    const i = head.findIndex((h) => h.trim().toUpperCase() === `R${n}`);
    if (i < 0) break;
    out.push(i);
  }
  return out;
}

/** A row's rounds: the strokes of each round played ("-" for one not played is none). */
export function roundsOf(row: readonly Cell[], cols: readonly number[]): ProRound[] {
  const out: ProRound[] = [];
  cols.forEach((c, i) => {
    const t = clean(row[c]?.text ?? '');
    const gross = /^[0-9]{2,3}$/.test(t) ? Number(t) : NaN;
    // A round's strokes, never a "to par" or a total.
    if (gross >= 50 && gross <= 120) out.push({ round_no: i + 1, gross, holes: 18 });
  });
  return out;
}

/**
 * Team events, whose round scores are a pair's (four-ball, foursomes), not the player's own strokes: no rounds of them
 * are sent, and so the tournament isn't either (no tournament without its rounds).
 */
const TEAM_EVENTS = [/\bzurich classic\b/i, /\bgrant thornton invitational\b/i, /\bdow (?:great lakes bay invitational|championship)\b/i, /\bqbe shootout\b/i];
export const isTeamEvent = (name: string): boolean => TEAM_EVENTS.some((re) => re.test(name));

/** A plain id of a name (lower case, accents dropped, anything else a hyphen). */
export function slugOf(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The ranking's day: a past season's is its last tournament's (its final standing), the running season's today. */
export function asOfSeason(season: number | undefined, lastDay: string | undefined, today: string): string {
  const year = season ?? (lastDay ? Number(lastDay.slice(0, 4)) : Number(today.slice(0, 4)));
  return year < Number(today.slice(0, 4)) && lastDay && lastDay < today ? lastDay : today;
}

/** A season as the picker writes it: "2026". */
export function seasonOf(s: string | undefined): number | undefined {
  const m = /^([0-9]{4})$/.exec((s ?? '').trim());
  return m ? Number(m[1]) : undefined;
}
