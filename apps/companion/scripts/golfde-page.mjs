// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Builds the page script of the app's golf.de window (scripts/golfde-page.entry.ts, with the extension's page script
 * from @glmsync/provider-golfde/page) into one plain script, kept as a string in src/lib/golfdePageScript.ts
 * (scripts/page-script.mjs says why).
 *
 *   node apps/companion/scripts/golfde-page.mjs          writes src/lib/golfdePageScript.ts
 *   node apps/companion/scripts/golfde-page.mjs --check  fails when the file isn't what this writes
 *
 * src/lib/golfdePageScript.test.ts checks the same on every test run, so a change to the page script can't reach the
 * app without the file written again.
 */

import { fileURLToPath } from 'node:url';
import { APP, pageScript, writeOrCheck } from './page-script.mjs';

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

/** The module that carries it. */
export async function moduleText() {
  return `${HEADER}\nexport const GOLFDE_PAGE_SCRIPT: string = ${JSON.stringify(await pageScript(ENTRY))};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeOrCheck(OUT, await moduleText(), 'scripts/golfde-page.mjs');
}
