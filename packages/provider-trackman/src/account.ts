// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Which Trackman account a sign-in opens - for `account_ref` and the guard's count, never shown or
 * sent as it is. The token is read, not verified: only Trackman can do that, and does with every
 * call. Written without atob, which not every phone engine has.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 or base64url to text (UTF-8); null when it isn't either. */
function decodeBase64(s: string): string | null {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) return null;
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const c of clean) {
    buf = (buf << 6) | B64.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 255);
    }
  }
  return decodeUtf8(bytes);
}

/** Strict UTF-8 to text; null on anything malformed (written out: not every engine has TextDecoder). */
function decodeUtf8(b: number[]): string | null {
  let out = '';
  for (let i = 0; i < b.length; ) {
    const c = b[i] as number;
    let n = 0;
    let cp = 0;
    if (c < 0x80) [n, cp] = [0, c];
    else if (c >= 0xc2 && c < 0xe0) [n, cp] = [1, c & 0x1f];
    else if (c >= 0xe0 && c < 0xf0) [n, cp] = [2, c & 0x0f];
    else if (c >= 0xf0 && c < 0xf5) [n, cp] = [3, c & 0x07];
    else return null;
    for (let k = 1; k <= n; k++) {
      const d = b[i + k];
      if (d === undefined || (d & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (d & 0x3f);
    }
    if ((n === 2 && cp < 0x800) || (n === 3 && (cp < 0x10000 || cp > 0x10ffff)) || (cp >= 0xd800 && cp <= 0xdfff)) return null;
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

/** The token's claims, read (not verified). null: not a JWT that can be read. */
export function claims(token: string): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part || part.length > 16_384) return null;
  const json = decodeBase64(part);
  if (json === null) return null;
  try {
    const c = JSON.parse(json) as unknown;
    return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The account's stable id (the token's `sub`), or null when the token has none. */
export function subjectOf(token: string): string | null {
  const sub = claims(token)?.sub;
  return typeof sub === 'string' && sub.trim() ? sub : null;
}

/** When the token runs out (ms), if it says. */
export function expiresAt(token: string): number | null {
  const exp = claims(token)?.exp;
  return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
}
