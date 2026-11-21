// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the browser clients (apps/extension, apps/web) build with: esbuild, one plain bundle per
 * page or script, and the olmd/1 schema check compiled ahead of time in place of ajv's runtime
 * compiler - an extension may not evaluate code (Manifest V3), and the web app keeps a content
 * security policy without 'unsafe-eval'.
 *
 * Bundles are not minified: store reviewers (and anyone else) read what runs.
 */

import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standaloneCheckSource } from '../packages/spec/src/standalone.ts';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SPEC_SRC = join(ROOT, 'packages', 'spec', 'src');

/** check.ts of @glmsync/spec becomes the check compiled ahead of time. */
export function standaloneCheck() {
  return {
    name: 'glmsync-standalone-check',
    setup(b) {
      b.onResolve({ filter: /[\\/]check\.ts$/ }, (args) => {
        if (dirname(join(args.resolveDir, args.path)) !== SPEC_SRC) return undefined;
        return { path: 'olmd-check', namespace: 'glmsync-standalone' };
      });
      b.onLoad({ filter: /.*/, namespace: 'glmsync-standalone' }, () => ({
        contents: standaloneCheckSource(),
        loader: 'js',
        resolveDir: join(ROOT, 'packages', 'spec'),
      }));
    },
  };
}

/** Browsers the clients support: Manifest V3 with content scripts in the page's world (Firefox 140 for its data consent). */
export const TARGETS = ['chrome120', 'edge120', 'firefox140', 'safari16'];

/**
 * One bundle per entry point. `entries`: { outName: absolute source path }.
 * Returns the written files' paths.
 */
export async function bundle({ entries, outdir, define = {}, format = 'iife' }) {
  const result = await build({
    entryPoints: entries,
    outdir,
    bundle: true,
    format,
    platform: 'browser',
    target: TARGETS,
    minify: false,
    sourcemap: false,
    legalComments: 'inline',
    banner: { js: '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Reginald Stadlbauer\n// Golf Stats Sync (Golf Launch Monitor Sync) - built from https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync' },
    charset: 'utf8',
    define,
    plugins: [standaloneCheck()],
    metafile: true,
    logLevel: 'warning',
    absWorkingDir: ROOT,
  });
  // The metafile names outputs relative to the working directory.
  return Object.keys(result.metafile.outputs).map((f) => join(ROOT, f));
}

/** Code a strict content security policy would refuse: none may be in a bundle. */
export const EVAL = /\bnew Function\s*\(|\beval\s*\(/;
