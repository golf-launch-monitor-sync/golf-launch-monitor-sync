// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Signing in for a target: the sealed handover (spec/deep-links.md, *Signing in for a target*; since 1.27.0), the
 * TypeScript port of spec/reference/handover.py; both answer spec/testvectors/handover.json alike.
 *
 * A target app on the phone asks the companion app for the player's provider sign-in with a public key it made for
 * this one question and a nonce (`signinLink`); the companion app answers in the fragment of the way back, the sign-in
 * sealed with NaCl's box (TweetNaCl) for that key alone (`seal`, `withAnswer`). The target reads the answer
 * (`readHandover`) and opens it with its secret key (`openSealed`). An app that catches the way back reads nothing.
 *
 * Since 1.28.0 a sign-in may be a test mode's (spec/test-mode.md, *Only signing in for a target*): `test` true, the token
 * a target's test code, never a provider's key, and `expires_at` always there. A target tells the two apart by `test`.
 *
 * base64url, UTF-8 and the times are read here by hand, the same in a browser, in Node and on a phone (where neither
 * Buffer nor a strict TextDecoder can be relied on), and as strictly as the reference reads them.
 */

import nacl from 'tweetnacl';
import { b64url, KEY_LEN, NONCE_LEN, unb64url, validKey } from './b64url.ts';
import { isObject, readHandedOver, type HandedOver } from './handedOver.ts';

export { readHandedOver, type HandedOver } from './handedOver.ts';

export { b64url, unb64url, validKey, validNonce } from './b64url.ts';

/** How a sign-in ended, in the way back (spec): handed over; not signed in; another provider account; anything else. */
export const HANDOVER_RESULTS = ['sealed', 'none', 'other_account', 'failed'] as const;
export type HandoverResult = (typeof HANDOVER_RESULTS)[number];
/** The way back with the answer may be this long: the sealed sign-in makes it longer than a link (2048). */
export const HANDOVER_MAX_ANSWER = 8192;
const ANSWER_KEYS = new Set(['signin', 'from', 'box']);
const TAG_LEN = 16;
const MAX_MESSAGE = 6000;

export type HandoverAnswer = { signin: 'sealed'; from: string; box: string } | { signin: Exclude<HandoverResult, 'sealed'> };

// --- UTF-8, strict ---------------------------------------------------------------------------

function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** UTF-8 to a string, or null for bytes that aren't UTF-8 (overlong forms, surrogates and all, as Python refuses them). */
function fromUtf8(b: Uint8Array): string | null {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const x = b[i] as number;
    let c: number;
    let n: number;
    if (x < 0x80) [c, n] = [x, 0];
    else if (x >= 0xc2 && x < 0xe0) [c, n] = [x & 31, 1];
    else if (x >= 0xe0 && x < 0xf0) [c, n] = [x & 15, 2];
    else if (x >= 0xf0 && x < 0xf5) [c, n] = [x & 7, 3];
    else return null;
    if (i + n >= b.length + (n ? 0 : 1)) return null;
    for (let k = 1; k <= n; k++) {
      const y = b[i + k];
      if (y === undefined || (y & 0xc0) !== 0x80) return null;
      c = (c << 6) | (y & 63);
    }
    if ((n === 2 && c < 0x800) || (n === 3 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) return null;
    out += String.fromCodePoint(c);
    i += n + 1;
  }
  return out;
}

/** The message as it is sealed: compact JSON, the keys in the spec's order. */
function messageBytes(m: HandedOver): Uint8Array {
  const o: Record<string, unknown> = { v: 1, provider: m.provider, token: m.token, account_ref: m.account_ref };
  if (m.expires_at !== undefined) o.expires_at = m.expires_at;
  o.user_agent = m.user_agent;
  if (m.test === true) o.test = true; // only a test sign-in says so
  return utf8(JSON.stringify(o));
}

// --- the question, the seal, the answer -------------------------------------------------------

/** A source of random bytes; by default the platform's (`crypto.getRandomValues`), which a phone may lack. */
export type RandomBytes = (n: number) => Uint8Array;

/** The public key of a secret key (both base64url); null for anything that isn't one. */
export function publicKey(secret: unknown): string | null {
  const sk = unb64url(secret, KEY_LEN);
  return sk ? b64url(nacl.box.keyPair.fromSecretKey(sk).publicKey) : null;
}

/** A target's question: a key pair made for it alone, and its nonce. Keep `secret` until the answer came, then drop it. */
export function newQuestion(random: RandomBytes = nacl.randomBytes): { key: string; secret: string; nonce: string } {
  const pair = nacl.box.keyPair.fromSecretKey(random(KEY_LEN));
  return { key: b64url(pair.publicKey), secret: b64url(pair.secretKey), nonce: b64url(random(NONCE_LEN)) };
}

/** The signin link a target opens (spec 1.27.0); `target` picks the pairing when the client has several. */
export function signinLink(q: { provider: string; key: string; nonce: string; back: string; target?: string }): string {
  const parts = q.target ? [`target=${encodeURIComponent(q.target)}`] : [];
  parts.push(`provider=${encodeURIComponent(q.provider)}`, `key=${q.key}`, `nonce=${q.nonce}`, `return=${encodeURIComponent(q.back)}`);
  return `glmsync://signin?${parts.join('&')}`;
}

/**
 * The sign-in sealed for the target's `key` with its question's `nonce`, under the client's own secret key for this
 * answer (`secret`, base64url; by default a random one). null when the message isn't one a target would read, or a key
 * or the nonce isn't one.
 */
export function seal(message: unknown, key: unknown, nonce: unknown, secret?: unknown): { from: string; box: string } | null {
  const pk = unb64url(key, KEY_LEN);
  const n = unb64url(nonce, NONCE_LEN);
  const sk = secret === undefined ? nacl.randomBytes(KEY_LEN) : unb64url(secret, KEY_LEN);
  if (!pk || !n || !sk || !isObject(message)) return null;
  const read = readHandedOver({ ...message, v: 1 });
  // Sealed only as a target reads it: a time it would drop isn't sealed either.
  if (!read || ('expires_at' in message && read.expires_at !== message.expires_at)) return null;
  const plain = messageBytes(read);
  if (plain.length > MAX_MESSAGE) return null;
  return { from: b64url(nacl.box.keyPair.fromSecretKey(sk).publicKey), box: b64url(nacl.box(plain, n, pk, sk)) };
}

/** What a target reads from an answer with its secret key and its question's nonce; null for anything else. */
export function openSealed(box: unknown, from: unknown, nonce: unknown, secret: unknown): HandedOver | null {
  const sk = unb64url(secret, KEY_LEN);
  const n = unb64url(nonce, NONCE_LEN);
  const pk = unb64url(from, KEY_LEN);
  const c = unb64url(box, undefined, TAG_LEN + MAX_MESSAGE);
  if (!sk || !n || !pk || !c) return null;
  const plain = nacl.box.open(c, n, pk, sk);
  if (!plain) return null;
  const text = fromUtf8(plain);
  if (text === null) return null;
  try {
    return readHandedOver(JSON.parse(text));
  } catch {
    return null;
  }
}

function answerParts(answer: unknown): string[] | null {
  if (!isObject(answer) || !(HANDOVER_RESULTS as readonly unknown[]).includes(answer.signin)) return null;
  if (answer.signin !== 'sealed') return [`signin=${answer.signin as string}`];
  if (!validKey(answer.from) || typeof answer.box !== 'string' || !answer.box) return null;
  if (!unb64url(answer.box, undefined, TAG_LEN + MAX_MESSAGE)) return null;
  return ['signin=sealed', `from=${answer.from as string}`, `box=${answer.box}`];
}

const SCHEME = /^([a-z][a-z0-9+.-]*):/;
const NEVER_RETURN = new Set(['javascript', 'data', 'file', 'vbscript', 'about', 'blob', 'glmsync']);
const SPACE = /[\s\x1c-\x1f]/;

/** deepLinks' validReturn, kept here so that this module stands alone (a target imports only what it uses). */
function validReturn(url: string): boolean {
  const m = SCHEME.exec(url);
  if (!m || url.length > 2048 || SPACE.test(url)) return false;
  const scheme = m[1] as string;
  if (NEVER_RETURN.has(scheme)) return false;
  if (scheme === 'http') return /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/|$)/.test(url);
  if (scheme === 'https') return /^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/|$)/.test(url);
  return url.startsWith(`${scheme}://`);
}

/**
 * The way back with the answer in its fragment, after the fragment's own keys (an answer's key it had already is
 * dropped). null for a way back that isn't one, an answer that isn't one, or one too long: the client answers `failed`.
 */
export function withAnswer(url: unknown, answer: unknown): string | null {
  const parts = answerParts(answer);
  if (typeof url !== 'string' || !validReturn(url) || !parts) return null;
  const at = url.indexOf('#');
  const head = at < 0 ? url : url.slice(0, at);
  const kept = at < 0 ? [] : url.slice(at + 1).split('&').filter((p) => p && !ANSWER_KEYS.has(p.split('=')[0] as string));
  const out = `${head}#${[...kept, ...parts].join('&')}`;
  return out.length <= HANDOVER_MAX_ANSWER ? out : null;
}

/** The answer a target finds in the address it was opened at (spec 1.27.0); null for none or anything unexpected. */
export function readHandover(url: unknown): HandoverAnswer | null {
  if (typeof url !== 'string' || url.length > HANDOVER_MAX_ANSWER) return null;
  const at = url.indexOf('#');
  if (at < 0) return null;
  const found: Record<string, string[]> = { signin: [], from: [], box: [] };
  for (const part of url.slice(at + 1).split('&')) {
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    if (ANSWER_KEYS.has(key)) found[key]?.push(eq < 0 ? '' : part.slice(eq + 1));
  }
  const signin = found.signin as string[];
  if (signin.length !== 1 || !(HANDOVER_RESULTS as readonly string[]).includes(signin[0] as string)) return null;
  const result = signin[0] as HandoverResult;
  if (result !== 'sealed') return { signin: result };
  const from = found.from as string[];
  const box = found.box as string[];
  if (from.length !== 1 || box.length !== 1) return null;
  const [f, b] = [from[0] as string, box[0] as string];
  if (!validKey(f) || !b || !unb64url(b, undefined, TAG_LEN + MAX_MESSAGE)) return null;
  return { signin: 'sealed', from: f, box: b };
}
