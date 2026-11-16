// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The deep links and the pairing fragment (spec/deep-links.md), the TypeScript port of
 * spec/reference/deeplinks.py; both answer spec/testvectors/deep-links.json alike.
 *
 * Parsed by hand rather than with `URL`, whose handling of custom schemes differs between engines.
 * A link is data from outside: anything unexpected makes it invalid rather than guessed at.
 */

export type LinkResult =
  | { ok: true; action: 'pair'; target: string; code: string; provider?: string }
  | { ok: true; action: 'sync'; target?: string; return?: string }
  | { ok: false; error: string };

const MAX_LEN = 2048;
const CODE = /^[0-9A-Za-z-]{6,64}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{1,39}$/;
const TARGET =
  /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?)(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/;
const NEVER_RETURN = new Set(['javascript', 'data', 'file', 'vbscript', 'about', 'blob', 'glmsync']);
const LINK = /^glmsync:\/\/(pair|sync)\/?(?:\?([^#]*))?$/;
const BAD_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
// What Python's str.isspace() counts: JS's \s plus the separators \x1c-\x1f.
const SPACE = /[\s\x1c-\x1f]/;

function decode(s: string): string {
  // '+' is a space, then percent escapes as UTF-8; malformed ones throw (URIError).
  return decodeURIComponent(s.replace(/\+/g, ' '));
}

function params(query: string, allowed: ReadonlySet<string>): Map<string, string> | string {
  const out = new Map<string, string>();
  for (const part of query ? query.split('&') : []) {
    if (!part) continue;
    if (BAD_ESCAPE.test(part)) return 'invalid:encoding';
    const eq = part.indexOf('=');
    let key: string;
    let value: string;
    try {
      key = decode(eq < 0 ? part : part.slice(0, eq));
      value = decode(eq < 0 ? '' : part.slice(eq + 1));
    } catch {
      return 'invalid:encoding';
    }
    if (!allowed.has(key)) continue;
    if (out.has(key)) return `duplicate:${key}`;
    if (!value) return `empty:${key}`;
    out.set(key, value);
  }
  return out;
}

export function validTarget(url: string): boolean {
  return url.length <= MAX_LEN && TARGET.test(url);
}

/**
 * Where a sync may jump back to: https, http to this machine, or an app's own scheme written
 * `scheme://…`; never a scheme that runs code or reads files.
 */
export function validReturn(url: string): boolean {
  const m = SCHEME.exec(url);
  if (!m || url.length > MAX_LEN || SPACE.test(url)) return false;
  const scheme = m[1] as string;
  if (NEVER_RETURN.has(scheme)) return false;
  if (scheme === 'http') return /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/|$)/.test(url);
  if (scheme === 'https') return /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/|$)/.test(url);
  return url.startsWith(`${scheme}://`);
}

const PAIR_KEYS = new Set(['target', 'code', 'provider']);
const SYNC_KEYS = new Set(['target', 'return']);

function pair(p: Map<string, string>): LinkResult {
  const target = p.get('target');
  const code = p.get('code');
  if (target === undefined) return { ok: false, error: 'missing:target' };
  if (code === undefined) return { ok: false, error: 'missing:code' };
  if (!validTarget(target)) return { ok: false, error: 'invalid:target' };
  if (!CODE.test(code)) return { ok: false, error: 'invalid:code' };
  const provider = p.get('provider');
  if (provider !== undefined && !PROVIDER.test(provider)) return { ok: false, error: 'invalid:provider' };
  return provider === undefined ? { ok: true, action: 'pair', target, code } : { ok: true, action: 'pair', target, code, provider };
}

/** `glmsync://pair?…` or `glmsync://sync?…`. */
export function parseLink(url: unknown): LinkResult {
  if (typeof url !== 'string' || url.length > MAX_LEN) return { ok: false, error: 'invalid:link' };
  const m = LINK.exec(url);
  if (!m) return { ok: false, error: 'invalid:link' };
  const query = m[2] ?? '';
  if (m[1] === 'pair') {
    const p = params(query, PAIR_KEYS);
    return typeof p === 'string' ? { ok: false, error: p } : pair(p);
  }
  const p = params(query, SYNC_KEYS);
  if (typeof p === 'string') return { ok: false, error: p };
  const target = p.get('target');
  const back = p.get('return');
  if (target !== undefined && !validTarget(target)) return { ok: false, error: 'invalid:target' };
  if (back !== undefined && !validReturn(back)) return { ok: false, error: 'invalid:return' };
  return {
    ok: true,
    action: 'sync',
    ...(target === undefined ? {} : { target }),
    ...(back === undefined ? {} : { return: back }),
  };
}

/** The web app's pairing page: the part after '#', which reaches no server. */
export function parsePairFragment(fragment: unknown): LinkResult {
  if (typeof fragment !== 'string' || fragment.length > MAX_LEN) return { ok: false, error: 'invalid:link' };
  const p = params(fragment.startsWith('#') ? fragment.slice(1) : fragment, PAIR_KEYS);
  return typeof p === 'string' ? { ok: false, error: p } : pair(p);
}

/**
 * Whether a sync may jump back to `url`: a valid return URL that starts with one of the prefixes
 * the target named at pairing. A prefix must end with '/' or '://'.
 */
export function returnAllowed(url: string, prefixes: readonly string[]): boolean {
  if (!validReturn(url)) return false;
  return prefixes.some((p) => (p.endsWith('/') || p.endsWith('://')) && url.startsWith(p));
}

/** A pairing link for the companion app. */
export function pairLink(target: string, code: string, provider?: string): string {
  const q = [`target=${encodeURIComponent(target)}`, `code=${encodeURIComponent(code)}`];
  if (provider) q.push(`provider=${encodeURIComponent(provider)}`);
  return `glmsync://pair?${q.join('&')}`;
}
