// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Builds the web app into dist/ for GitHub Pages: the pages, their bundles, the bookmark as
 * one `javascript:` line, the icon. The pairing page is there twice (`pair.html`, `pair/index.html`),
 * so `…/pair` works however Pages resolves it. The page behind the universal links (spec 1.22.0) is
 * `link/pair/index.html` and `link/sync/index.html`; the files that vouch for the companion app at the
 * host's root are tools/link-files.mjs's, not this site's (it lives below the root).
 */

import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle, EVAL, ROOT, TARGETS } from '../../tools/browser-build.mjs';
import { icon } from '../../tools/icon.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const OUT = join(HERE, 'dist');

/** The bookmark: bundled, minified, one line. */
export async function bookmarklet() {
  const r = await build({
    entryPoints: [join(HERE, 'src', 'bookmarklet.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: TARGETS,
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    absWorkingDir: ROOT,
  });
  const js = r.outputFiles[0].text.trim();
  return `javascript:${encodeURIComponent(js)}`;
}

export async function buildWeb() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'pair'), { recursive: true });
  for (const kind of ['pair', 'sync', 'signin']) mkdirSync(join(OUT, 'link', kind), { recursive: true });
  const files = await bundle({
    entries: { index: join(HERE, 'src', 'index.ts'), pair: join(HERE, 'src', 'pair.ts'), app: join(HERE, 'src', 'app.ts'), link: join(HERE, 'src', 'link.ts') },
    outdir: OUT,
    define: { __VERSION__: JSON.stringify(version), __BOOKMARKLET__: JSON.stringify(await bookmarklet()) },
  });
  for (const f of files) {
    if (EVAL.test(readFileSync(f, 'utf8').replace(/javascript:[^"]*/g, ''))) throw new Error(`${f} evaluates code: the page's policy forbids it`);
  }
  for (const page of readdirSync(join(HERE, 'static'))) copyFileSync(join(HERE, 'static', page), join(OUT, page));
  writeFileSync(join(OUT, 'pair', 'index.html'), readFileSync(join(OUT, 'pair.html'), 'utf8').replaceAll('"./', '"../'));
  // The site's own path is fixed by the spec (UNIVERSAL_BASE), so the page names its files from there: the same page
  // then works at `link/sync` and `link/sync/`, whichever Pages serves.
  const link = readFileSync(join(OUT, 'link.html'), 'utf8').replaceAll('"./', '"/golf-launch-monitor-sync/');
  for (const kind of ['pair', 'sync', 'signin']) {
    writeFileSync(join(OUT, 'link', kind, 'index.html'), link);
    writeFileSync(join(OUT, 'link', `${kind}.html`), link);
  }
  rmSync(join(OUT, 'link.html'));
  copyFileSync(join(ROOT, 'packages', 'browser', 'src', 'style.css'), join(OUT, 'style.css'));
  writeFileSync(join(OUT, 'icon.png'), icon(128));
  // Served as files, not through Jekyll.
  writeFileSync(join(OUT, '.nojekyll'), '');
  return OUT;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(await buildWeb());
