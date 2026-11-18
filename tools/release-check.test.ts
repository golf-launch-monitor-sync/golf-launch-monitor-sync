// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension released by itself when its version rises (18 Nov: 0.1.2 was built but never released, and the
 * web app kept offering 0.1.1), and a hint when what goes into it changed without a new version.
 */

import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain ES module without types
import { decide, latestReleased, parseVersion, shipped } from './release-check.mjs';

describe('a new version', () => {
  it('is released when it has no tag yet and is newer than every release', () => {
    expect(decide({ version: '0.2.0', tags: ['extension-v0.1.0', 'extension-v0.1.1'], changed: [] })).toMatchObject({ release: true, tag: 'extension-v0.2.0' });
    // 0.1.2 was never released: 0.2.0 still goes.
    expect(decide({ version: '0.2.0', tags: ['extension-v0.1.1', 'other-v9.9.9'], changed: [] })).toMatchObject({ release: true });
    expect(decide({ version: '0.1.0', tags: [], changed: [] })).toMatchObject({ release: true });
  });

  it('is not released twice, nor when it is older than the newest release', () => {
    expect(decide({ version: '0.1.1', tags: ['extension-v0.1.1'], changed: [] })).toEqual({ release: false, version: '0.1.1', tag: 'extension-v0.1.1', notice: null });
    expect(decide({ version: '0.1.0', tags: ['extension-v0.1.1'], changed: [] })).toMatchObject({ release: false, notice: expect.stringContaining('older') });
    expect(decide({ version: 'one', tags: [], changed: [] })).toMatchObject({ release: false });
  });

  it('compares versions as numbers, not as text', () => {
    expect(latestReleased(['extension-v0.9.0', 'extension-v0.10.0', 'extension-v0.2.5'])).toBe('0.10.0');
    expect(decide({ version: '0.10.0', tags: ['extension-v0.9.9'], changed: [] })).toMatchObject({ release: true });
    expect(parseVersion('1.2')).toBeNull();
  });
});

describe('the hint', () => {
  it('names what changed in the extension since its release without a new version', () => {
    const out = decide({ version: '0.1.1', tags: ['extension-v0.1.1'], changed: ['apps/extension/src/background.ts', 'packages/browser/src/client.ts', 'apps/companion/src/ui/App.tsx'] });
    expect(out.release).toBe(false);
    expect(out.notice).toContain('apps/extension/src/background.ts, packages/browser/src/client.ts');
    expect(out.notice).toContain('raise it in apps/extension/package.json');
    expect(out.notice).not.toContain('companion');
  });

  it('says nothing for tests, click checks, docs, screenshots, vectors and fakes', () => {
    for (const f of [
      'apps/extension/src/bridge.test.ts',
      'apps/extension/e2e/bridge.spec.ts',
      'apps/extension/README.md',
      'spec/page-bridge.md',
      'apps/extension/store/1-connect.png',
      'spec/testvectors/page-bridge.json',
      'spec/reference/bridge.py',
      'packages/core/src/testing/index.ts',
      'packages/provider-trackman/src/testing.ts',
      'apps/companion/src/lib/runner.ts',
      'tools/release-check.mjs',
    ]) {
      expect([f, shipped(f)]).toEqual([f, false]);
    }
    for (const f of ['apps/extension/src/portal-main.ts', 'apps/extension/static/connect.html', 'packages/spec/src/bridge.ts', 'spec/olmd/olmd-1.schema.json', 'spec/guard/limits.json']) {
      expect([f, shipped(f)]).toEqual([f, true]);
    }
  });
});
