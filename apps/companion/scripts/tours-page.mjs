// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Builds the page script of the app's tour window (scripts/tours-page.entry.ts, with the extension's
 * reading from @glmsync/provider-tours) into one plain script, kept as a string in src/lib/toursPageScript.ts
 * (scripts/page-script.mjs says why).
 *
 *   node apps/companion/scripts/tours-page.mjs          writes src/lib/toursPageScript.ts
 *   node apps/companion/scripts/tours-page.mjs --check  fails when the file isn't what this writes
 *
 * src/lib/toursPageScript.test.ts checks the same on every test run.
 */

import { fileURLToPath } from 'node:url';
import { APP, pageScript, writeOrCheck } from './page-script.mjs';

export const OUT = `${APP}src/lib/toursPageScript.ts`;
const ENTRY = `${APP}scripts/tours-page.entry.ts`;

const HEADER = `// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Written by scripts/tours-page.mjs from scripts/tours-page.entry.ts and @glmsync/provider-tours - don't edit;
 * \`node apps/companion/scripts/tours-page.mjs\` writes it again (a test checks it is what the script writes).
 *
 * The page script of the tour window (ToursView), injected before the site's own scripts: it reads the player's own
 * page as it shows only when the app asks (his tap on *Send* or *Fetch all*, a page his run opened) and posts only his
 * own of it to the app. It sends the site nothing.
 */
`;

/** The module that carries it. */
export async function moduleText() {
  return `${HEADER}\nexport const TOURS_PAGE_SCRIPT: string = ${JSON.stringify(await pageScript(ENTRY))};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeOrCheck(OUT, await moduleText(), 'scripts/tours-page.mjs');
}
