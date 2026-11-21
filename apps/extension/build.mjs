// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Builds the extension into dist/chrome (Chrome and Edge) and dist/firefox: the bundles, the pages,
 * the icons, the locales and the manifest. `--zip` also packs each for its store
 * (dist/golf-launch-monitor-sync-chrome-edge-<version>.zip, …-firefox-<version>.zip: `packageName`);
 * submitting them is done by hand.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, EVAL, ROOT } from '../../tools/browser-build.mjs';
import { icon } from '../../tools/icon.mjs';
import { de, en } from '../../packages/browser/src/messages.ts';
import { manifest, packageName } from './src/manifest.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const zip = process.argv.includes('--zip');
const DIST = join(HERE, 'dist');
/** The click checks' fake target, granted at install in their build only (dist-e2e/). */
export const E2E_HOSTS = ['https://app.example.org/*'];

const ENTRIES = ['background', 'portal-main', 'portal-relay', 'pair-content', 'bridge-content', 'golfde-main', 'golfde-relay', 'popup', 'connect'];

export async function buildFor(browser, { e2e = false } = {}) {
  const out = join(e2e ? join(HERE, 'dist-e2e') : DIST, browser);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'icons'), { recursive: true });
  const files = await bundle({
    entries: Object.fromEntries(ENTRIES.map((e) => [e, join(HERE, 'src', `${e}.ts`)])),
    outdir: out,
    define: { __VERSION__: JSON.stringify(version), __BROWSER__: JSON.stringify(browser) },
  });
  for (const f of files) {
    if (EVAL.test(readFileSync(f, 'utf8'))) throw new Error(`${f} evaluates code: a store refuses that, and Manifest V3 forbids it`);
  }
  for (const page of readdirSync(join(HERE, 'static'))) copyFileSync(join(HERE, 'static', page), join(out, page));
  copyFileSync(join(ROOT, 'packages', 'browser', 'src', 'style.css'), join(out, 'style.css'));
  copyFileSync(join(ROOT, 'LICENSE'), join(out, 'LICENSE'));
  for (const size of [16, 32, 48, 128]) writeFileSync(join(out, 'icons', `${size}.png`), icon(size));
  for (const [lang, dict] of [['en', en], ['de', de]]) {
    mkdirSync(join(out, '_locales', lang), { recursive: true });
    const messages = { name: { message: dict['app.name'] }, description: { message: dict['app.tagline'] } };
    writeFileSync(join(out, '_locales', lang, 'messages.json'), `${JSON.stringify(messages, null, 2)}\n`);
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest(browser, version, e2e ? E2E_HOSTS : []), null, 2)}\n`);
  if (zip && !e2e) {
    const name = join(DIST, packageName(browser, version));
    rmSync(name, { force: true });
    execFileSync('zip', ['-q', '-r', '-X', name, '.'], { cwd: out });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const b of ['chrome', 'firefox']) console.log(await buildFor(b));
}
