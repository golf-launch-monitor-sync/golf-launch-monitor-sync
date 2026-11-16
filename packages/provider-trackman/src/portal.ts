// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Finding the player's own Trackman key where the portal keeps it, for clients that read it from
 * the player's signed-in portal tab (the browser extension's content script, the web app's
 * bookmark). Only reading: nothing here sends anything anywhere.
 *
 * Where the key sits depends on how the portal was built that week, so a client looks in two
 * places: storage and cookies (every string, also inside JSON, that reads as a token with a future
 * `exp`), and the `Authorization` of the next call the portal makes. Where there are several, the
 * one Trackman's own sign-in issued wins over others a page may hold, then the one that lasts
 * longest.
 *
 * Pure functions, no DOM: the clients wire them to the page.
 */

import { claims } from './account.ts';

const JWT = /^[\w-]+\.[\w-]+\.[\w-]*$/;
const TRACKMAN_ISSUER = /(^|[./])trackmangolf\.com(\/|$|:)/;
/** A token past this length is no access key a person's portal holds. */
const MAX_TOKEN = 16_384;
const MAX_DEPTH = 6;

/** When a token runs out (ms), if it reads as a token that hasn't yet; else null. */
export function liveUntil(token: unknown, now: number): number | null {
  if (typeof token !== 'string' || token.length > MAX_TOKEN || !JWT.test(token)) return null;
  const c = claims(token);
  const exp = c?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp * 1000 <= now) return null;
  return exp * 1000;
}

/** Whether Trackman's own sign-in issued it. */
export function fromTrackman(token: string): boolean {
  const iss = claims(token)?.iss;
  return typeof iss === 'string' && TRACKMAN_ISSUER.test(iss);
}

/** How good a candidate is: 0 for none; Trackman's own beat any other, then the longer lasting. */
export function rank(token: unknown, now: number): number {
  const until = liveUntil(token, now);
  if (until === null) return 0;
  return (fromTrackman(token as string) ? 1e14 : 0) + until;
}

/** The best of several candidates, or null. */
export function best(candidates: Iterable<unknown>, now: number): string | null {
  let top = 0;
  let found: string | null = null;
  for (const t of candidates) {
    const r = rank(t, now);
    if (r > top) {
      top = r;
      found = t as string;
    }
  }
  return found;
}

/** Every string in a stored value, also inside JSON kept as text, a few levels deep. */
export function strings(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || out.length > 10_000) return out;
  if (typeof value === 'string') {
    out.push(value);
    const c = value.charAt(0);
    if ((c === '{' || c === '[') && value.length < 1_000_000) {
      try {
        strings(JSON.parse(value) as unknown, depth + 1, out);
      } catch {
        // not JSON after all
      }
    }
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) strings(v, depth + 1, out);
  }
  return out;
}

/** The key in an `Authorization` header, if it carries a bearer token. */
export function bearer(header: unknown): string | null {
  if (typeof header !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? (m[1] as string) : null;
}

/** Values of a cookie string (`a=1; b=2`), decoded where they can be. */
export function cookieValues(cookie: string): string[] {
  return cookie
    .split(';')
    .map((c) => c.split('=').slice(1).join('='))
    .map((v) => {
      try {
        return decodeURIComponent(v.trim());
      } catch {
        return v.trim();
      }
    })
    .filter(Boolean);
}

/** Where the portal lives: the clients read keys from pages of this origin only. */
export const PORTAL_ORIGIN = 'https://portal.trackmangolf.com';
export const PORTAL_URL = `${PORTAL_ORIGIN}/`;
