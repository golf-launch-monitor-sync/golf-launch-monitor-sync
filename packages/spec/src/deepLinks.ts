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
  /** `kind` (1.10.0): which target API the base URL speaks, only where the link names it (none: the launch monitor one). */
  | { ok: true; action: 'pair'; target: string; code: string; provider?: string; kind?: PairKind; return?: string }
  | { ok: true; action: 'sync'; target?: string; return?: string }
  /** Since 1.8.0: a test code for a pairing (spec/test-mode.md); never pairs, never jumps back. */
  | { ok: true; action: 'test'; target?: string; code: string }
  /** Since 1.11.0: open the client's way of reading along for `kind` (spec/hcp.md); never pairs, sends nothing by itself. */
  | { ok: true; action: 'read'; kind: ReadKind }
  | { ok: false; error: string };

const MAX_LEN = 2048;
/**
 * Which target API a pairing speaks (1.10.0): `lm` (spec/target-api.md, also without a kind), `hcp` (spec/hcp.md) or
 * (1.15.0) `pro`: the handicap target API for a professional's own pages (spec/prores.md).
 */
export type PairKind = 'lm' | 'hcp' | 'pro';
const KINDS: ReadonlySet<string> = new Set<PairKind>(['lm', 'hcp', 'pro']);
/** What a read link may open (1.11.0): the handicap record's reading along, and (1.15.0) a professional's pages. */
export type ReadKind = 'hcp' | 'pro';
const READ_KINDS: ReadonlySet<string> = new Set<ReadKind>(['hcp', 'pro']);
const CODE = /^[0-9A-Za-z-]{6,64}$/;
const PROVIDER = /^[a-z][a-z0-9_-]{1,39}$/;
const TARGET =
  /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?|http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?)(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/;
const NEVER_RETURN = new Set(['javascript', 'data', 'file', 'vbscript', 'about', 'blob', 'glmsync']);
const LINK = /^glmsync:\/\/(pair|sync|test|read)\/?(?:\?([^#]*))?$/;
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

const PAIR_KEYS = new Set(['target', 'code', 'provider', 'kind']);
// A pair link may name where to jump back to once paired (1.2.0); the pairing page's fragment may not.
const PAIR_LINK_KEYS = new Set(['target', 'code', 'provider', 'kind', 'return']);
const SYNC_KEYS = new Set(['target', 'return']);
const TEST_KEYS = new Set(['target', 'code']);
const READ_KEYS = new Set(['kind']);

function pair(p: Map<string, string>): LinkResult {
  const target = p.get('target');
  const code = p.get('code');
  if (target === undefined) return { ok: false, error: 'missing:target' };
  if (code === undefined) return { ok: false, error: 'missing:code' };
  if (!validTarget(target)) return { ok: false, error: 'invalid:target' };
  if (!CODE.test(code)) return { ok: false, error: 'invalid:code' };
  const provider = p.get('provider');
  if (provider !== undefined && !PROVIDER.test(provider)) return { ok: false, error: 'invalid:provider' };
  const kind = p.get('kind');
  // Another API than the client knows: invalid, rather than a pairing the target could only refuse.
  if (kind !== undefined && !KINDS.has(kind)) return { ok: false, error: 'invalid:kind' };
  const back = p.get('return');
  if (back !== undefined && !validReturn(back)) return { ok: false, error: 'invalid:return' };
  return {
    ok: true,
    action: 'pair',
    target,
    code,
    ...(provider === undefined ? {} : { provider }),
    ...(kind === undefined ? {} : { kind: kind as PairKind }),
    ...(back === undefined ? {} : { return: back }),
  };
}

/** A test link (1.8.0): the code, and the pairing's target when there are several. */
function test(p: Map<string, string>): LinkResult {
  const target = p.get('target');
  const code = p.get('code');
  if (code === undefined) return { ok: false, error: 'missing:code' };
  if (target !== undefined && !validTarget(target)) return { ok: false, error: 'invalid:target' };
  if (!CODE.test(code)) return { ok: false, error: 'invalid:code' };
  return { ok: true, action: 'test', ...(target === undefined ? {} : { target }), code };
}

/** `glmsync://pair?…`, `glmsync://sync?…`, (1.8.0) `glmsync://test?…` or (1.11.0) `glmsync://read?kind=hcp`. */
export function parseLink(url: unknown): LinkResult {
  if (typeof url !== 'string' || url.length > MAX_LEN) return { ok: false, error: 'invalid:link' };
  const m = LINK.exec(url);
  if (!m) return { ok: false, error: 'invalid:link' };
  const query = m[2] ?? '';
  if (m[1] === 'pair') {
    const p = params(query, PAIR_LINK_KEYS);
    return typeof p === 'string' ? { ok: false, error: p } : pair(p);
  }
  if (m[1] === 'test') {
    const p = params(query, TEST_KEYS);
    return typeof p === 'string' ? { ok: false, error: p } : test(p);
  }
  if (m[1] === 'read') {
    // No target, no return: a handicap pairing names no return_prefixes, and one window reads for all of them.
    const p = params(query, READ_KEYS);
    if (typeof p === 'string') return { ok: false, error: p };
    const kind = p.get('kind');
    if (kind === undefined) return { ok: false, error: 'missing:kind' };
    if (!READ_KINDS.has(kind)) return { ok: false, error: 'invalid:kind' };
    return { ok: true, action: 'read', kind: kind as ReadKind };
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

/**
 * A pairing link for the companion app; `back`: where it jumps once paired (checked there against the target's
 * return_prefixes, like a sync link's `return`). `kind` (1.10.0): `hcp` for a handicap target (spec/hcp.md), `pro` (1.15.0)
 * for a professional's pages (spec/prores.md).
 */
export function pairLink(target: string, code: string, provider?: string, back?: string, kind?: PairKind): string {
  const q = [`target=${encodeURIComponent(target)}`, `code=${encodeURIComponent(code)}`];
  if (provider) q.push(`provider=${encodeURIComponent(provider)}`);
  if (kind) q.push(`kind=${kind}`);
  if (back) q.push(`return=${encodeURIComponent(back)}`);
  return `glmsync://pair?${q.join('&')}`;
}

/** A read link for the companion app (1.11.0): opens its window on the handicap record's page, or (1.15.0) a pro's pages. */
export function readLink(kind: ReadKind = 'hcp'): string {
  return `glmsync://read?kind=${kind}`;
}

/** A test link for the companion app (1.8.0); `target` picks the pairing when the client has several. */
export function testLink(code: string, target?: string): string {
  const q = target ? [`target=${encodeURIComponent(target)}`] : [];
  q.push(`code=${encodeURIComponent(code)}`);
  return `glmsync://test?${q.join('&')}`;
}

/**
 * Android: a target binds to the companion app's sync service (spec/deep-links.md, "Android"). The
 * intent's action is `SYNC_ACTION`, its data a sync link naming the target, its extra `SYNC_REASON_EXTRA`
 * `open` or `manual`.
 */
export const SYNC_ACTION = 'glmsync.intent.action.SYNC';
export const SYNC_REASON_EXTRA = 'glmsync.extra.REASON';

export type SyncIntentReason = 'open' | 'manual';
export type SyncIntentResult = { ok: true; target: string; reason: SyncIntentReason } | { ok: false; error: string };

/**
 * What a target asks for when it binds: a sync link that names the target and has nothing to jump back
 * to (a service opens nothing). A missing or unknown reason reads as `manual`: a target app can't claim a
 * reason of the client's own (timer, connect, backfill).
 */
export function parseSyncIntent(data: unknown, reason?: unknown): SyncIntentResult {
  const link = parseLink(data);
  if (!link.ok) return link;
  if (link.action !== 'sync') return { ok: false, error: 'invalid:action' };
  if (link.target === undefined) return { ok: false, error: 'missing:target' };
  if (link.return !== undefined) return { ok: false, error: 'unexpected:return' };
  return { ok: true, target: link.target, reason: reason === 'open' ? 'open' : 'manual' };
}
