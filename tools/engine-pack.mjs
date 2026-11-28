// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The engine as packages another app installs from a GitHub release (README.md of packages/engine, *Embedding the
 * engine*), without a package registry:
 *
 *   node tools/engine-pack.mjs [out-dir]        (default dist/engine-release)
 *
 * - `glmsync-engine-<version>.tgz`: @glmsync/engine with core, the spec reader, provider-trackman and provider-demo
 *   bundled into one ES module (`dist/index.js`, not minified, the olmd/1 check compiled ahead of time so nothing
 *   evaluates code at runtime), its types (`types/`, the workspace's names rewritten to paths inside the package), no
 *   dependencies at all;
 * - `glmsync-power-<version>.tgz`: the native module of apps/companion/modules/glmsync-power as an Expo module of its
 *   own, with the few lines that hand it to JavaScript (packages/engine/power);
 * - `SHA512SUMS` (hex, as `sha512sum -c` reads it) and `integrity.json` (each file's `sha512-…`, as a lockfile pins it).
 *
 * The version is packages/engine/package.json's; both packages carry it. The release workflow (engine-release.yml)
 * attaches all four files to the release `engine-v<version>` once CI is green on that commit. Writes `version`, `tag`
 * and the files to $GITHUB_OUTPUT when it is set.
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVAL, ROOT, standaloneCheck } from './browser-build.mjs';

/** The workspace packages bundled into the engine's package. */
export const BUNDLED = ['core', 'spec', 'provider-demo', 'provider-trackman', 'engine'];

const HEADER = '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 Reginald Stadlbauer\n';
const BANNER = `${HEADER}// Golf Stats Sync (Golf Launch Monitor Sync) engine - built from https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync`;
const REPOSITORY = 'github:golf-launch-monitor-sync/golf-launch-monitor-sync';

/**
 * The olmd/1 check's types without ajv's: the package bundles the check compiled ahead of time, and its users need not
 * install ajv for its types.
 */
export const CHECK_DTS = `${HEADER}/** The compiled olmd/1 schema check (bundled ahead of time; no ajv needed). */
import type { Batch } from './olmd.js';
export declare const AJV_OPTIONS: {
    readonly allErrors: true;
    readonly strict: true;
};
export declare function makeAjv(extra?: Record<string, unknown>): unknown;
export declare const check: ((data: unknown) => data is Batch) & { errors?: unknown[] | null };
`;

const SPECIFIER = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g;

/**
 * One declaration file of the package's `types/`, its imports made to work there: `@glmsync/<name>` becomes the path
 * to that package's index inside `types/`, a relative `./x.ts` becomes `./x.js`. `file`: its path inside `types/`
 * (posix). Throws for an import of a workspace package that isn't bundled, or of a subpath of one.
 */
export function rewriteDts(text, file) {
  const from = posix.dirname(file);
  const out = text.replace(SPECIFIER, (all, head, q, spec) => {
    const ws = /^@glmsync\/([a-z-]+)(\/.*)?$/.exec(spec);
    if (ws) {
      if (ws[2] || !BUNDLED.includes(ws[1])) throw new Error(`${file}: ${spec} is not part of the engine's package`);
      let rel = posix.relative(from, `packages/${ws[1]}/src/index.js`);
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${head}${q}${rel}${q}`;
    }
    if (/^\.\.?\//.test(spec) && spec.endsWith('.ts')) return `${head}${q}${spec.slice(0, -3)}.js${q}`;
    return all;
  });
  return out.startsWith('// SPDX-License-Identifier') ? out : `${HEADER}${out}`;
}

/** How a lockfile pins a file: `sha512-<base64>`. */
export const integrity = (buf) => `sha512-${createHash('sha512').update(buf).digest('base64')}`;
export const sha512hex = (buf) => createHash('sha512').update(buf).digest('hex');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

function npmPack(dir, dest) {
  // --ignore-scripts: nothing of the staged package runs; the name npm prints is the file it wrote.
  const name = execFileSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', dest], { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
  return join(dest, name);
}

/** The engine's bundle: one ES module, nothing left to resolve, nothing evaluated at runtime. */
async function bundleEngine(outfile) {
  await build({
    entryPoints: [join(ROOT, 'packages', 'engine', 'src', 'index.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2022',
    minify: false,
    sourcemap: false,
    legalComments: 'inline',
    banner: { js: BANNER },
    charset: 'utf8',
    plugins: [standaloneCheck()],
    logLevel: 'warning',
    absWorkingDir: ROOT,
  });
  const code = readFileSync(outfile, 'utf8');
  if (EVAL.test(code)) throw new Error('The engine bundle evaluates code at runtime.');
  if (/\b(?:from|import|require)\s*\(?\s*['"](?:@glmsync\/|node:)/.test(code)) throw new Error('The engine bundle still imports a workspace package or a Node module.');
}

/** The declarations of every bundled package, emitted once (packages/engine/tsconfig.pack.json) and rewritten. */
function writeTypes(dir, scratch) {
  const emitted = join(scratch, 'types');
  rmSync(emitted, { recursive: true, force: true });
  execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', join(ROOT, 'packages', 'engine', 'tsconfig.pack.json'), '--outDir', emitted], { cwd: ROOT, stdio: 'inherit' });
  for (const f of walk(emitted)) {
    if (!f.endsWith('.d.ts')) continue;
    const rel = relative(emitted, f).split(sep).join('/');
    const text = rel === 'packages/spec/src/check.d.ts' ? CHECK_DTS : rewriteDts(readFileSync(f, 'utf8'), rel);
    mkdirSync(join(dir, posix.dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  // The schema the spec's types name (`OLMD_SCHEMA`), where its import points.
  mkdirSync(join(dir, 'spec', 'olmd'), { recursive: true });
  cpSync(join(ROOT, 'spec', 'olmd', 'olmd-1.schema.json'), join(dir, 'spec', 'olmd', 'olmd-1.schema.json'));
}

/** Builds both packages into `out`. Returns the version and each file with its checksums. */
export async function packEngine({ out = join(ROOT, 'dist', 'engine-release') } = {}) {
  const { version } = JSON.parse(readFileSync(join(ROOT, 'packages', 'engine', 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`packages/engine/package.json has no version x.y.z (${version}).`);
  rmSync(out, { recursive: true, force: true });
  const stage = join(out, 'stage');
  mkdirSync(stage, { recursive: true });
  const license = join(ROOT, 'LICENSE');

  // The engine.
  const engine = join(stage, 'glmsync-engine');
  mkdirSync(engine, { recursive: true });
  await bundleEngine(join(engine, 'dist', 'index.js'));
  writeTypes(join(engine, 'types'), stage);
  const types = './types/packages/engine/src/index.d.ts';
  writeFileSync(
    join(engine, 'package.json'),
    json({
      name: 'glmsync-engine',
      version,
      license: 'MIT',
      description: 'The engine of Golf Stats Sync (Golf Launch Monitor Sync): fetches the player\'s own launch monitor data on a phone, as a target\'s plan says. Unofficial: not affiliated with or endorsed by Trackman.',
      repository: REPOSITORY,
      type: 'module',
      sideEffects: false,
      main: './dist/index.js',
      types,
      exports: { '.': { types, default: './dist/index.js' }, './package.json': './package.json' },
    }),
  );
  cpSync(join(ROOT, 'packages', 'engine', 'README.md'), join(engine, 'README.md'));
  cpSync(license, join(engine, 'LICENSE'));

  // The native module.
  const power = join(stage, 'glmsync-power');
  cpSync(join(ROOT, 'apps', 'companion', 'modules', 'glmsync-power'), power, { recursive: true });
  for (const f of ['index.js', 'index.d.ts', 'README.md']) cpSync(join(ROOT, 'packages', 'engine', 'power', f), join(power, f));
  writeFileSync(
    join(power, 'package.json'),
    json({
      name: 'glmsync-power',
      version,
      license: 'MIT',
      description: 'Golf Stats Sync on the iPhone: Background App Refresh, Low Power Mode and the end of a background task\'s time (an Expo module).',
      repository: REPOSITORY,
      main: './index.js',
      types: './index.d.ts',
      peerDependencies: { expo: '*', 'react-native': '*' },
    }),
  );
  cpSync(license, join(power, 'LICENSE'));

  const files = [npmPack(engine, out), npmPack(power, out)].map((path) => {
    const buf = readFileSync(path);
    return { name: path.split(sep).pop(), path, integrity: integrity(buf), sha512: sha512hex(buf) };
  });
  writeFileSync(join(out, 'SHA512SUMS'), files.map((f) => `${f.sha512}  ${f.name}\n`).join(''));
  writeFileSync(join(out, 'integrity.json'), json(Object.fromEntries(files.map((f) => [f.name, f.integrity]))));
  rmSync(stage, { recursive: true, force: true });
  return { version, tag: `engine-v${version}`, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] ? resolve(process.argv[2]) : undefined;
  try {
    const r = await packEngine(out ? { out } : {});
    for (const f of r.files) console.log(`${f.name}\n  ${f.integrity}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${r.version}\ntag=${r.tag}\n`);
  } catch (e) {
    console.error(`engine-pack: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
