// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Builds the page script of the app's golf.de window (scripts/golfde-page.entry.ts, with the extension's page script
 * from @glmsync/provider-golfde/page) into one plain script, kept as a string in src/lib/golfdePageScript.ts: a web
 * view takes the script it injects as text, and Metro bundles no second script for a page. Not minified, so anyone
 * reads what runs in golf.de's page.
 *
 *   node apps/companion/scripts/golfde-page.mjs          writes src/lib/golfdePageScript.ts
 *   node apps/companion/scripts/golfde-page.mjs --check  fails when the file isn't what this writes
 *
 * src/lib/golfdePageScript.test.ts checks the same on every test run, so a change to the page script can't reach the
 * app without the file written again. No npm script for it on purpose: the app's package.json scripts are part of its
 * native fingerprint, and a new script would keep this update from the builds out there.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
export const OUT = `${APP}src/lib/golfdePageScript.ts`;
const ENTRY = `${APP}scripts/golfde-page.entry.ts`;

const HEADER = `// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Written by scripts/golfde-page.mjs from scripts/golfde-page.entry.ts and @glmsync/provider-golfde/page - don't edit;
 * \`node apps/companion/scripts/golfde-page.mjs\` writes it again (a test checks it is what the script writes).
 *
 * The page script of the golf.de window (GolfdeView), injected before golf.de's own scripts: it reads along with the
 * answers golf.de's page receives and posts what it made of them to the app. It sends golf.de nothing.
 */
`;

/** The page script, bundled: one function expression run at once, ending with \`true;\` as a web view wants. */
export async function pageScript() {
  const result = await build({
    entryPoints: [ENTRY],
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

/** The module that carries it. */
export async function moduleText() {
  return `${HEADER}\nexport const GOLFDE_PAGE_SCRIPT: string = ${JSON.stringify(await pageScript())};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = await moduleText();
  if (process.argv.includes('--check')) {
    let had = '';
    try {
      had = readFileSync(OUT, 'utf8');
    } catch {
      had = '';
    }
    if (had !== text) {
      console.error('src/lib/golfdePageScript.ts is not what scripts/golfde-page.mjs writes: run `node apps/companion/scripts/golfde-page.mjs`.');
      process.exit(1);
    }
  } else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT}`);
  }
}
