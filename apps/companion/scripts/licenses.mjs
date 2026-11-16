// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Writes src/licenses.json for the app's licences page: every package the companion app depends on
 * in production, found the way Node finds them (from this app's dependencies on, through each
 * package's own), with its licence and, where the package brings one, its licence text (identical
 * texts once). Rather more than ends up in the app - Expo's build tools come along - but never less.
 *
 * Run after every install (`postinstall`), so it always matches node_modules and never needs a
 * commit of its own; it is not in git.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(APP, '..', '..');
const OUT = join(APP, 'src', 'licenses.json');
const MAX_TEXT = 40_000;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** Where Node would find `name` from `dir`: up the folders, each one's node_modules. */
function find(name, dir) {
  for (let d = dir; ; d = dirname(d)) {
    const candidate = join(d, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(d) === d) return null;
  }
}

function licenceOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === 'string') return l;
  if (l && typeof l === 'object' && !Array.isArray(l) && typeof l.type === 'string') return l.type;
  if (Array.isArray(l)) return l.map((x) => (typeof x === 'string' ? x : x?.type)).filter(Boolean).join(' OR ') || 'UNKNOWN';
  return 'UNKNOWN';
}

function licenceText(dir) {
  const file = readdirSync(dir).filter((n) => /^(licen[cs]e|copying)(\.|-|$)/i.test(n)).sort()[0];
  if (!file) return null;
  const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…` : text;
}

const seen = new Map(); // real path -> { name, version, license, text }
const queue = [realpathSync(APP)];
while (queue.length) {
  const dir = queue.pop();
  const pkg = readJson(join(dir, 'package.json'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.optionalDependencies ?? {}) };
  for (const name of Object.keys(deps).sort()) {
    const at = find(name, dir);
    if (!at || seen.has(at)) continue; // an optional one not installed here, or known already
    const p = readJson(join(at, 'package.json'));
    seen.set(at, { name: p.name ?? name, version: String(p.version ?? ''), license: licenceOf(p), text: licenceText(at) });
    queue.push(at);
  }
}

const texts = [];
const index = new Map();
const textId = (text) => {
  if (!text) return null;
  if (!index.has(text)) {
    index.set(text, texts.length);
    texts.push(text);
  }
  return index.get(text);
};

const own = readFileSync(join(ROOT, 'LICENSE'), 'utf8').trim();
const packages = [...seen.values()]
  // This project's own packages carry its licence (the repository's LICENSE file).
  .map((p) => ({ name: p.name, version: p.version, license: p.license, text: textId(p.text ?? (p.name.startsWith('@glmsync/') ? own : null)) }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
const unique = packages.filter((p, i) => i === 0 || p.name !== packages[i - 1].name || p.version !== packages[i - 1].version);

writeFileSync(OUT, `${JSON.stringify({ packages: unique, texts })}\n`);
console.log(`licenses.json: ${unique.length} packages, ${texts.length} licence texts.`);
