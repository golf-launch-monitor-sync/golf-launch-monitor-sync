// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** House rules that hold for the whole repository (CLAUDE.md). */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '__pycache__', 'testvectors']);
// Formats without comments, and files whose form is fixed by others.
const NO_HEADER = /(\.json|\.lock|LICENSE|\.gitignore|\.editorconfig|\.nvmrc|pnpm-lock\.yaml)$/;
const SOURCE = /\.(ts|tsx|mts|js|mjs|py|ya?ml|md|sh|css|html)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP_DIRS.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('every source file', () => {
  const sources = files(ROOT)
    .map((f) => relative(ROOT, f))
    .filter((f) => SOURCE.test(f) && !NO_HEADER.test(f));

  it('is there to check', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('starts with the MIT header', () => {
    const missing = sources.filter((f) => {
      const head = readFileSync(join(ROOT, f), 'utf8').split('\n').slice(0, 4).join('\n');
      return !head.includes('SPDX-License-Identifier: MIT') || !/Copyright \(c\) \d{4} Reginald Stadlbauer/.test(head);
    });
    expect(missing).toEqual([]);
  });
});
