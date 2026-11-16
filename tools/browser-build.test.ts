// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The browser bundles check batches with the schema compiled ahead of time: it must answer every
 * example as the runtime check does, and the bundle must hold no eval of any kind.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { validateBatch } from '../packages/spec/src/index.ts';
// @ts-expect-error - a plain ES module without types
import { bundle, EVAL, ROOT } from './browser-build.mjs';

const dir = mkdtempSync(join(tmpdir(), 'glmsync-build-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const examples = JSON.parse(readFileSync(join(ROOT, 'spec/testvectors/olmd-examples.json'), 'utf8')) as {
  cases: { name: string; valid: boolean; batch: unknown }[];
};
const trackman = JSON.parse(readFileSync(join(ROOT, 'spec/testvectors/trackman-olmd.json'), 'utf8')) as {
  cases: { name: string; expected: unknown }[];
};

describe('the schema check compiled ahead of time', () => {
  it('answers like the runtime check, and the bundle evaluates nothing', async () => {
    const entry = join(dir, 'entry.ts');
    writeFileSync(entry, `import { validateBatch } from '${join(ROOT, 'packages/spec/src/index.ts')}';\nexport { validateBatch };\n`);
    const files: string[] = await bundle({ entries: { checked: entry }, outdir: dir, format: 'esm' });
    const out = files.find((f) => f.endsWith('checked.js')) as string;
    const text = readFileSync(out, 'utf8');
    expect(text).not.toMatch(EVAL);
    expect(text).not.toContain('ajv/dist/compile');
    const mod = (await import(pathToFileURL(out).href)) as { validateBatch: typeof validateBatch };
    const batches = [
      ...examples.cases.map((c) => ({ name: c.name, batch: c.batch })),
      ...trackman.cases.map((c) => ({ name: c.name, batch: c.expected })),
    ];
    expect(batches.length).toBeGreaterThan(20);
    for (const { name, batch } of batches) {
      const a = validateBatch(batch);
      const b = mod.validateBatch(batch);
      expect({ name, ok: b.ok, errors: b.ok ? [] : b.errors }).toEqual({ name, ok: a.ok, errors: a.ok ? [] : a.errors });
    }
    for (const c of examples.cases) expect({ name: c.name, ok: mod.validateBatch(c.batch).ok }).toEqual({ name: c.name, ok: c.valid });
  });
});
