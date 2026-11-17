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
  // A wedge's name alone ("Pitching", "Sand") or with a letter ("S Wedge"), as some monitors shorten it.
  [/^(pw|pitching ?wedge|pitching|p ?wedge|p)$/, 'PW'],
  // AW and UW are GW: which of a player's wedges they mean is the target's question, not a code.
  [/^(gw|aw|uw|gap ?wedge|approach ?wedge|gap|approach|g ?wedge|a ?wedge)$/, 'GW'],
  [/^(sw|sand ?wedge|sand|s ?wedge|s)$/, 'SW'],
  [/^(lw|lob ?wedge|low ?wedge|lob|l ?wedge|l)$/, 'LW'], // "low": how dictation hears "lob"
];
// A fairway wood ("3 FW", "Fairway 5") is a wood; a utility or driving iron ("4U", "UT 3", "3 DI") the
// iron of its number.
const KINDS =
  'fairway wood|fairway|fwy|fw|w|wood|holz|madera|hout|hyb|hybrid|hy|h|híbrido|hibrido|rescue|' +
  'driving iron|utility iron|utility|util|ut|u|di|i|iron|eisen|hierro|ijzer';
// n1 kind1 | kind2 n2 | n3 "er"
const NUMBERED = new RegExp(`^(?:([0-9]{1,2}) ?(?:er )?(${KINDS})|(${KINDS}) ?([0-9]{1,2})|([0-9]{1,2}) ?er)$`);
const WEDGE_DEG = /^(?:([0-9]{2}) ?(?:°|deg|degree|grad)?(?: ?wedge)?|wedge ?([0-9]{2}) ?(?:°|deg|degree|grad)?)$/;
// A wedge named with its loft ("SW 56", "56° Sand Wedge", "LW60"): the loft says more than the name.
const WEDGE_NAMES = '(?:pw|gw|aw|uw|sw|lw|pitching|gap|approach|sand|lob)(?: ?wedge)?';
const DEG = '(?:°|deg|degree|grad)?';
const NAMED_DEG = new RegExp(`^(?:([0-9]{2}) ?${DEG} ?${WEDGE_NAMES}|${WEDGE_NAMES} ?([0-9]{2}) ?${DEG})$`);
const NO_CLUB = new Set(['', 'unknown', 'unbekannt', 'none', 'null', 'n/a', 'na', '?', '-', 'kein', 'no club', 'other', 'sonstige']);
const WOODS = new Set(['w', 'wood', 'holz', 'madera', 'hout', 'fw', 'fwy', 'fairway', 'fairway wood']);
const HYBRIDS = new Set(['h', 'hy', 'hyb', 'hybrid', 'híbrido', 'hibrido', 'rescue']);

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
  for (const pattern of [WEDGE_DEG, NAMED_DEG]) {
    const w = pattern.exec(s);
    if (!w) continue;
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
