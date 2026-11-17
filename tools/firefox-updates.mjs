// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Firefox's updates for the self-distributed extension, written into the web app's site by pages.yml:
 *
 *   node tools/firefox-updates.mjs apps/web/dist
 *
 * Mozilla signs the Firefox package (not listed on addons.mozilla.org, "on your own"), and a maintainer attaches the
 * signed `.xpi` to its GitHub release `extension-v<version>` (deploy notes: apps/extension/README.md). From the
 * newest release that carries one this writes
 *
 * - `firefox/updates.json`, the address in the manifest's `update_url` (src/manifest.ts): Firefox asks it every
 *   day or so and updates by itself - the only way a self-distributed add-on updates;
 * - `firefox/golf-launch-monitor-sync.xpi`, the same file: served from here as `application/x-xpinstall`, a click in
 *   Firefox installs it (a download from GitHub's release would only be saved).
 *
 * No signed release yet: an empty list, no file. Nothing here holds a store credential; GitHub's API is read with the
 * workflow's own token. A release's assets are data: only a file of this repository's releases, of a sane size, that
 * is a zip, is taken.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GECKO_ID } from '../apps/extension/src/manifest.ts';

export const XPI_NAME = 'golf-launch-monitor-sync.xpi';
const TAG = /^extension-v(\d+)\.(\d+)\.(\d+)$/;
const MAX_BYTES = 20 * 1024 * 1024;

/** `extension-v1.2.3` → [1, 2, 3]; anything else null. */
export function versionOf(tag) {
  const m = TAG.exec(String(tag ?? ''));
  return m ? m.slice(1).map(Number) : null;
}

function newer(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * The newest published release of the extension with a signed `.xpi` of this repository: `{ version, url }`, or null.
 * Drafts and pre-releases don't count (the companion app's APK is one); several `.xpi` in one release: the one named
 * like the package (`…-firefox-<version>.xpi`) first, else the first.
 */
export function newestSigned(releases, repo) {
  const base = `https://github.com/${repo}/releases/download/`;
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || r.prerelease) continue;
    const v = versionOf(r.tag_name);
    if (!v) continue;
    const xpis = (Array.isArray(r.assets) ? r.assets : []).filter(
      (a) => a && typeof a.name === 'string' && a.name.endsWith('.xpi') && typeof a.browser_download_url === 'string'
        && a.browser_download_url.startsWith(base) && (a.size == null || a.size <= MAX_BYTES),
    );
    if (!xpis.length) continue;
    const xpi = xpis.find((a) => a.name.includes('-firefox-')) ?? xpis[0];
    if (!best || newer(v, best.v)) best = { v, version: v.join('.'), url: xpi.browser_download_url };
  }
  return best && { version: best.version, url: best.url };
}

/** The update manifest Firefox reads (https://extensionworkshop.com/documentation/manage/updating-your-extension/). */
export function updatesJson(signed, sha256) {
  const updates = signed ? [{ version: signed.version, update_link: signed.url, ...(sha256 ? { update_hash: `sha256:${sha256}` } : {}) }] : [];
  return { addons: { [GECKO_ID]: { updates } } };
}

/** A zip starts with `PK\x03\x04`: anything else (an error page, say) is no add-on. */
export function looksLikeXpi(bytes) {
  return bytes.length > 4 && bytes.length <= MAX_BYTES && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Writes `firefox/` into `out`. `fetchFn` and the environment can be swapped (tools/firefox-updates.test.ts). */
export async function write(out, { fetchFn = fetch, env = process.env } = {}) {
  const repo = env.GITHUB_REPOSITORY || 'golf-launch-monitor-sync/golf-launch-monitor-sync';
  const api = env.GITHUB_API_URL || 'https://api.github.com';
  const headers = { accept: 'application/vnd.github+json', ...(env.GH_TOKEN ? { authorization: `Bearer ${env.GH_TOKEN}` } : {}) };
  // A hundred releases reach back far enough: the newest signed one is what counts.
  const res = await fetchFn(`${api}/repos/${repo}/releases?per_page=100`, { headers });
  if (!res.ok) throw new Error(`GitHub's list of releases answered ${res.status}`);
  const signed = newestSigned(await res.json(), repo);
  const dir = join(out, 'firefox');
  mkdirSync(dir, { recursive: true });
  let sha256 = null;
  if (signed) {
    const file = await fetchFn(signed.url, { redirect: 'follow' });
    if (!file.ok) throw new Error(`The signed add-on ${signed.url} answered ${file.status}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeXpi(bytes)) throw new Error(`${signed.url} is no add-on (not a zip, or over 20 MB)`);
    sha256 = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(join(dir, XPI_NAME), bytes);
  }
  writeFileSync(join(dir, 'updates.json'), `${JSON.stringify(updatesJson(signed, sha256), null, 2)}\n`);
  return signed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: node tools/firefox-updates.mjs <the web app\'s dist>');
    process.exit(2);
  }
  const signed = await write(out);
  console.log(signed ? `Firefox: ${signed.version} (${signed.url})` : 'Firefox: no signed release yet, an empty update list.');
}
