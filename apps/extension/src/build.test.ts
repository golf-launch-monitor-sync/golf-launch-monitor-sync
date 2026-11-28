// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - the build script is plain JavaScript without types
import { buildFor } from '../build.mjs';

/** Every bundle of a build, as text. */
function bundles(dir: string): string {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

describe('the build per browser', () => {
  // Mozilla's linter (release.yml, warnings as errors) refused release 0.29.0 for naming an API Firefox lacks.
  it("leaves APIs Firefox hasn't implemented out of Firefox's bundles, and keeps them in Chrome's", async () => {
    const firefox = bundles(await buildFor('firefox', { e2e: true }));
    const chrome = bundles(await buildFor('chrome', { e2e: true }));
    expect(firefox).not.toMatch(/runtime\.requestUpdateCheck/);
    expect(chrome).toMatch(/chrome\.runtime\.requestUpdateCheck\(\)/);
  }, 60_000);
});
