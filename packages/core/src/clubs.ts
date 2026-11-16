// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Club names: "7 Iron", "7i", "Eisen 7", "I7" -> "7i"; "Driver"/"Dr" -> "Dr" ... The port of
 * spec/reference/clubs.py; both answer spec/testvectors/clubs.json alike.
 *
 * The canonical codes of olmd/1: Dr, nW, nH, ni, PW, GW, SW, LW, NN° (a wedge by its loft) and
 * Putter. A name none of the rules reads is kept as it came (trimmed), so nothing a player named is
 * lost; "unknown" means no club was set. Written without lookbehind and named groups, which not
 * every JavaScript engine of a phone knows.
 */

import { strip } from './values.ts';

export const UNKNOWN_CLUB = 'unknown';

const CLUB_PATTERNS: [RegExp, string][] = [
  // "d": some monitors write the driver as one letter.
  [/^(driver|dr|d|1 ?w|1 ?wood|wood ?1|1 ?(?:er )?holz|holz ?1|madera ?1|hout ?1|1 ?hout)$/, 'Dr'],
  [/^(putter|pt)$/, 'Putter'],
  [/^(pw|pitching ?wedge|p)$/, 'PW'],
  [/^(gw|aw|uw|gap ?wedge|approach ?wedge)$/, 'GW'],
  [/^(sw|sand ?wedge|s)$/, 'SW'],
  [/^(lw|lob ?wedge|low ?wedge|l)$/, 'LW'], // "low": how dictation hears "lob"
];
const KINDS = 'w|wood|holz|madera|hout|h|hy|hybrid|híbrido|hibrido|rescue|i|iron|eisen|hierro|ijzer';
// n1 kind1 | kind2 n2 | n3 "er"
const NUMBERED = new RegExp(`^(?:([0-9]{1,2}) ?(?:er )?(${KINDS})|(${KINDS}) ?([0-9]{1,2})|([0-9]{1,2}) ?er)$`);
const WEDGE_DEG = /^(?:([0-9]{2}) ?(?:°|deg|degree|grad)?(?: ?wedge)?|wedge ?([0-9]{2}) ?(?:°|deg|degree|grad)?)$/;
const NO_CLUB = new Set(['', 'unknown', 'unbekannt', 'none', 'null', 'n/a', 'na', '?', '-', 'kein', 'no club', 'other', 'sonstige']);
const WOODS = new Set(['w', 'wood', 'holz', 'madera', 'hout']);
const HYBRIDS = new Set(['h', 'hy', 'hybrid', 'híbrido', 'hibrido', 'rescue']);

export function isUnknownClub(club: string | null | undefined): boolean {
  return club === null || club === undefined || NO_CLUB.has(strip(club).toLowerCase());
}

/** A short canonical club code, or the trimmed input if no rule reads it. */
export function normalizeClub(raw: string): string {
  if (isUnknownClub(raw)) return UNKNOWN_CLUB;
  const s = strip(raw).toLowerCase().replace(/-/g, ' ').replace(/_/g, ' ').replace(/[ \t\n\r\f\v]+/g, ' ');
  for (const [pattern, code] of CLUB_PATTERNS) if (pattern.test(s)) return code;
  const m = NUMBERED.exec(s);
  if (m) {
    const n = (m[1] ?? m[4] ?? m[5]) as string;
    const kind = m[2] ?? m[3] ?? 'i';
    if (WOODS.has(kind)) return `${n}W`;
    if (HYBRIDS.has(kind)) return `${n}H`;
    if (Number(n) >= 40) return `${n}°`; // "56er" is a wedge's loft, never an iron
    return `${n}i`;
  }
  const w = WEDGE_DEG.exec(s);
  if (w) {
    const loft = (w[1] ?? w[2]) as string;
    if (Number(loft) >= 40 && Number(loft) <= 70) return `${loft}°`; // a wedge's loft ("12" is a shot number)
  }
  return strip(raw);
}

const lower = (c: string) => c >= 'a' && c <= 'z';
const upper = (c: string) => c >= 'A' && c <= 'Z';
const digit = (c: string) => c >= '0' && c <= '9';

/** Trackman writes its clubs in CamelCase ("Iron7", "PitchingWedge"): a space between the words. */
function splitCamel(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    const prev = i > 0 ? (s[i - 1] as string) : '';
    if ((lower(prev) && (upper(c) || digit(c))) || (digit(prev) && (lower(c) || upper(c)))) out += ' ';
    out += c;
  }
  return out;
}

/** 'Iron7' -> '7i', 'PitchingWedge' -> 'PW', 'Wood3' -> '3W'; anything that is no name -> 'unknown'. */
export function camelClub(raw: unknown): string {
  if (typeof raw !== 'string' || !strip(raw)) return UNKNOWN_CLUB;
  return normalizeClub(splitCamel(strip(raw)));
}
