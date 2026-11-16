// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * `account_ref` (spec/olmd.md): base64url, unpadded, of SHA-256("olmd-account-v1|" + salt + "|" +
 * provider + "|" + subject). Two accounts tell apart, nothing identifies one, and one account looks
 * different to different targets.
 */

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Web Crypto: in every browser, in extensions and in Node 22. */
export async function accountRef(salt: string, provider: string, subject: string): Promise<string> {
  const data = new TextEncoder().encode(`olmd-account-v1|${salt}|${provider}|${subject}`);
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}
