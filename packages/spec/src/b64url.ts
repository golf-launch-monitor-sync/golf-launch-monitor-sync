// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * base64url without padding, read strictly (spec/reference/handover.py, `unb64url`): the keys and nonces of a sign-in
 * question (spec 1.27.0). Apart from handover.ts so that reading a link needs no cryptography.
 */

export const KEY_LEN = 32;
export const NONCE_LEN = 24;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64URL = /^[A-Za-z0-9_-]*$/;

export function b64url(data: Uint8Array): string {
  let out = '';
  for (let i = 0; i < data.length; i += 3) {
    const a = data[i] as number;
    const b = data[i + 1];
    const c = data[i + 2];
    out += ALPHABET[a >> 2];
    out += ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b !== undefined) out += ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c !== undefined) out += ALPHABET[c & 63];
  }
  return out;
}

/** The bytes of unpadded base64url, or null: only the alphabet, and only the one spelling of each value. */
export function unb64url(text: unknown, length?: number, most?: number): Uint8Array | null {
  if (typeof text !== 'string' || !B64URL.test(text) || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of text) {
    acc = (acc << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 255;
    }
  }
  // The unused low bits of the last letter must be zero: one spelling per value, as the reference reads it.
  if (bits > 0 && (acc & ((1 << bits) - 1)) !== 0) return null;
  if (length !== undefined && out.length !== length) return null;
  if (most !== undefined && out.length > most) return null;
  return out;
}

/** A public key in a link (1.27.0): 32 bytes, base64url (43 letters). */
export const validKey = (text: unknown) => unb64url(text, KEY_LEN) !== null;
/** A nonce in a link (1.27.0): 24 bytes, base64url (32 letters). */
export const validNonce = (text: unknown) => unb64url(text, NONCE_LEN) !== null;
