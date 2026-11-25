// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the app's page scripts are built with (scripts/golfde-page.mjs, scripts/rankings-page.mjs): one plain script,
 * kept as a string in a module of src/lib - a web view takes the script it injects as text, and Metro bundles no second
 * script for a page. Not minified, so anyone reads what runs in a site's page.
 *
 * No npm script for them on purpose: the app's package.json scripts are part of its native fingerprint, and a new
 * script would keep the update from the builds out there.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const APP = fileURLToPath(new URL('..', import.meta.url));

/** The page script of `entry`, bundled: one function expression run at once, ending with `true;` as a web view wants. */
export async function pageScript(entry) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    // The phones' web views: WKWebView from iOS 16, Android's System WebView (Chromium).
    target: ['safari16', 'chrome110'],
    minify: false,
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'warning',
    absWorkingDir: APP,
  });
  const text = result.outputFiles[0].text;
  return `${text.trimEnd()}\ntrue;\n`;
}

/** Writes `text` to `out`, or with `--check` fails when the file isn't it. `script`: how to run the writer again. */
export function writeOrCheck(out, text, script) {
  if (process.argv.includes('--check')) {
    let had = '';
    try {
      had = readFileSync(out, 'utf8');
    } catch {
      had = '';
    }
    if (had !== text) {
      console.error(`${out} is not what ${script} writes: run \`node apps/companion/${script}\`.`);
      process.exit(1);
    }
  } else {
    writeFileSync(out, text);
    console.log(`wrote ${out}`);
  }
}
