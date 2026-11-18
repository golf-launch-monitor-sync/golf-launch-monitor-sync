// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Whether main's browser extension is a new release, and a hint when it should be (ci.yml):
 *
 *   node tools/release-check.mjs
 *
 * - **Release**: the version in apps/extension/package.json has no tag `extension-v<version>` yet and is newer than
 *   every released one. CI then releases it once all its checks are green (release.yml, called from ci.yml).
 *   Raising the version is the deliberate step; nothing raises it by itself.
 * - **Hint**: the version is released already, but something that goes into the extension (apps/extension,
 *   packages/, spec/; not tests, click checks, docs or store screenshots) changed since that release. A notice
 *   in the run and its summary - no error: not every change needs a release at once.
 *
 * Reads git's tags and the diff since the last release (the checkout needs the history: `fetch-depth: 0`). Writes
 * `release`, `version` and `tag` to $GITHUB_OUTPUT when it is set.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TAG = /^extension-v(\d+)\.(\d+)\.(\d+)$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/** `1.2.3` → [1, 2, 3]; anything else null. */
export function parseVersion(v) {
  const m = VERSION.exec(String(v ?? ''));
  return m ? m.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The newest released version among the tags, or null. */
export function latestReleased(tags) {
  let best = null;
  for (const t of tags) {
    const m = TAG.exec(String(t).trim());
    if (!m) continue;
    const v = m.slice(1).map(Number);
    if (!best || compare(v, best) > 0) best = v;
  }
  return best ? best.join('.') : null;
}

/** Whether a changed file goes into the extension's packages (what a user would get with a new version). */
export function shipped(file) {
  const f = String(file);
  if (!/^(apps\/extension\/|packages\/|spec\/)/.test(f)) return false;
  if (/\.test\.ts$/.test(f) || /\/e2e\//.test(f) || /\.md$/.test(f)) return false;
  if (/^apps\/extension\/store\//.test(f) || /^spec\/(reference|testvectors)\//.test(f)) return false;
  // The fakes for tests (core/testing, provider-*/testing) aren't bundled.
  if (/^packages\/[^/]+\/src\/testing(\.ts|\/)/.test(f)) return false;
  return true;
}

/**
 * `version`: apps/extension/package.json's; `tags`: the repository's tags; `changed`: the files changed since the
 * newest released version's tag (all of them when there is none).
 */
export function decide({ version, tags, changed }) {
  const v = parseVersion(version);
  if (!v) return { release: false, version: String(version), tag: null, notice: `apps/extension/package.json has no version of the form x.y.z (${version}).` };
  const tag = `extension-v${version}`;
  const latest = latestReleased(tags);
  const released = tags.some((t) => String(t).trim() === tag);
  if (!released && (!latest || compare(v, parseVersion(latest)) > 0)) {
    return { release: true, version, tag, notice: `Extension ${version} is not released yet: it is released once all checks of this commit are green.` };
  }
  if (!released) return { release: false, version, tag, notice: `Extension ${version} is older than the released ${latest}: nothing is released.` };
  const files = changed.filter(shipped);
  if (!files.length) return { release: false, version, tag, notice: null };
  const shown = files.slice(0, 10).join(', ') + (files.length > 10 ? `, … (${files.length} files)` : '');
  return {
    release: false,
    version,
    tag,
    notice: `What goes into the extension changed since ${tag} (${shown}), but its version is still ${version}: raise it in apps/extension/package.json to release.`,
  };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const { version } = JSON.parse(readFileSync(new URL('../apps/extension/package.json', import.meta.url), 'utf8'));
  const tags = git('-C', root, 'tag', '-l', 'extension-v*').split('\n').filter(Boolean);
  const latest = latestReleased(tags);
  const changed = latest ? git('-C', root, 'diff', '--name-only', `extension-v${latest}`, 'HEAD').split('\n').filter(Boolean) : [];
  const out = decide({ version, tags, changed });
  if (out.notice) {
    // A hint, never a failure: the release itself is the deliberate step.
    console.log(`::notice title=Extension version::${out.notice}`);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Extension version\n\n${out.notice}\n`);
  } else {
    console.log(`Extension ${out.version}: released, nothing of it changed since.`);
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `release=${out.release}\nversion=${out.version}\ntag=${out.tag ?? ''}\n`);
}
