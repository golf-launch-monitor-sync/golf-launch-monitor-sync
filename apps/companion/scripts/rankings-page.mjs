// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Builds the page script of the app's world ranking window (scripts/rankings-page.entry.ts, with the extension's
 * reading from @glmsync/provider-rankings) into one plain script, kept as a string in src/lib/rankingsPageScript.ts
 * (scripts/page-script.mjs says why).
 *
 *   node apps/companion/scripts/rankings-page.mjs          writes src/lib/rankingsPageScript.ts
 *   node apps/companion/scripts/rankings-page.mjs --check  fails when the file isn't what this writes
 *
 * src/lib/rankingsPageScript.test.ts checks the same on every test run.
 */

import { fileURLToPath } from 'node:url';
import { APP, pageScript, writeOrCheck } from './page-script.mjs';

export const OUT = `${APP}src/lib/rankingsPageScript.ts`;
const ENTRY = `${APP}scripts/rankings-page.entry.ts`;

const HEADER = `// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Written by scripts/rankings-page.mjs from scripts/rankings-page.entry.ts and @glmsync/provider-rankings - don't edit;
 * \`node apps/companion/scripts/rankings-page.mjs\` writes it again (a test checks it is what the script writes).
 *
 * The page script of the world ranking window (RankingsView), injected before the site's own scripts: it reads the
 * player's own page as it shows only when the app asks (the player's tap on *Send*) and posts it to the app. It sends
 * the site nothing.
 */
`;

/** The module that carries it. */
export async function moduleText() {
  return `${HEADER}\nexport const RANKINGS_PAGE_SCRIPT: string = ${JSON.stringify(await pageScript(ENTRY))};\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeOrCheck(OUT, await moduleText(), 'scripts/rankings-page.mjs');
}
