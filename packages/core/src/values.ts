// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Reading untrusted values: what a provider answered may be missing or of any type. The port of
 * spec/reference/values.py; both answer spec/testvectors/values.json alike.
 *
 * Every helper maps a value or drops it (null); none of them throws. Numbers are JSON numbers only
 * (a number written as text is dropped), times are RFC 3339 only, digits are ASCII digits. Text is
 * trimmed of exactly what Python's str.strip() trims and cut by code points, as the reference does.
 */

// What Python's str.isspace() counts (not U+FEFF, which JavaScript's trim() also takes).
const PY_SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const LEAD = new RegExp(`^[${PY_SPACE}]+`);
const TRAIL = new RegExp(`[${PY_SPACE}]+$`);

/** Python's str.strip(). */
export function strip(s: string): string {
  return s.replace(LEAD, '').replace(TRAIL, '');
}

/** The first n code points (Python slices by code point, JavaScript by UTF-16 unit). */
export function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  const points = Array.from(s);
  return points.length <= n ? s : points.slice(0, n).join('');
}

/** A finite JSON number, as it came. */
export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const INT_TEXT = /^[ \t\n\r\f\v]*[+-]?[0-9]{1,9}[ \t\n\r\f\v]*$/;

/** A whole number: a number without a fraction, or up to nine digits written as text. */
export function integer(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && Number.isInteger(v) ? v + 0 : null;
  if (typeof v === 'string' && INT_TEXT.test(v)) return Number.parseInt(v.trim(), 10) + 0;
  return null;
}

/** A non-empty string, trimmed and cut to n characters. */
export function text(v: unknown, n: number): string | null {
  if (typeof v !== 'string') return null;
  const s = strip(v);
  return s ? cut(s, n) : null;
}

const TIME = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})?$/;

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** An RFC 3339 time with its zone, or null. Without a zone it is UTC: 'Z' is added. */
export function when(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = strip(v);
  const m = TIME.exec(s);
  if (!m) return null;
  const [y, mo, d, h, mi, se] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i])) as [number, number, number, number, number, number];
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo) || h > 23 || mi > 59 || se > 59) return null;
  const zone = m[8];
  if (zone && zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return null;
  return zone ? s : `${s}Z`;
}

/** olmd leaves out what is unknown: no nulls, no empty groups. */
export function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return;
  out[key] = value;
}

/** An id as text: a string, or a whole number written out; anything else is no id. */
export function externalId(v: unknown): string | null {
  if (typeof v === 'string') {
    const s = strip(v);
    return s ? cut(s, 400) : null;
  }
  // JSON can't tell 12 from 12.0 here; only whole numbers a double holds exactly count.
  if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v + 0);
  return null;
}

/** Milliseconds of an RFC 3339 time, or NaN. */
export function ms(t: string | null | undefined): number {
  return t ? Date.parse(t) : Number.NaN;
}
