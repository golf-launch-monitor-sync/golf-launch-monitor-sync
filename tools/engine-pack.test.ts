// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The engine's release packages (tools/engine-pack.mjs), built for real into a scratch folder: the bundle imports
 * nothing and syncs against a made-up target and Trackman like the workspace's engine (the User-Agent included), its
 * types compile in an app that knows nothing of this workspace, the power package is an Expo module, and the
 * checksums are the files'.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MemoryStorage, type FetchLike } from '../packages/core/src/index.ts';
import { FakeTarget, VirtualClock } from '../packages/core/src/testing/index.ts';
import { GRAPHQL_URL } from '../packages/provider-trackman/src/index.ts';
import { FakeTrackman, fakeToken } from '../packages/provider-trackman/src/testing.ts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error a plain ES module of the tools, without types
import { CHECK_DTS, integrity, packEngine, rewriteDts } from './engine-pack.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

describe('rewriteDts', () => {
  it('points the workspace’s names at the package’s own types, and .ts at .js', () => {
    const src = [
      "import { Guard, type Storage } from '@glmsync/core';",
      "export * from './runner.ts';",
      "export declare const x: import('@glmsync/spec').Reason;",
      "import type { Plan } from '../../core/src/api.ts';",
    ].join('\n');
    const out = rewriteDts(src, 'packages/engine/src/index.d.ts');
    expect(out).toContain("from '../../core/src/index.js'");
    expect(out).toContain("from './runner.js'");
    expect(out).toContain("import('../../spec/src/index.js')");
    expect(out).toContain("from '../../core/src/api.js'");
    expect(out.startsWith('// SPDX-License-Identifier: MIT')).toBe(true);
  });

  it('refuses a workspace package the engine doesn’t bundle, and a subpath of one', () => {
    expect(() => rewriteDts("import { x } from '@glmsync/browser';", 'packages/engine/src/a.d.ts')).toThrow(/not part/);
    expect(() => rewriteDts("import { x } from '@glmsync/core/testing';", 'packages/engine/src/a.d.ts')).toThrow(/not part/);
  });

  it('the olmd/1 check’s types need no ajv', () => {
    expect(CHECK_DTS).not.toMatch(/ajv['"/]/);
  });
});

describe('the packages', () => {
  let out: string;
  let result: { version: string; tag: string; files: { name: string; path: string; integrity: string; sha512: string }[] };
  let app: string;

  beforeAll(async () => {
    out = mkdtempSync(join(tmpdir(), 'glmsync-pack-'));
    result = await packEngine({ out: join(out, 'release') });
    // An app of its own: the two tarballs unpacked into its node_modules, as npm installs them.
    app = join(out, 'app');
    for (const f of result.files) {
      const name = f.name.replace(/-\d+\.\d+\.\d+\.tgz$/, '');
      const dir = join(app, 'node_modules', name);
      mkdirSync(dir, { recursive: true });
      execFileSync('tar', ['-xzf', f.path, '-C', dir, '--strip-components=1']);
    }
  }, 180_000);

  afterAll(() => rmSync(out, { recursive: true, force: true }));

  it('are named by the engine’s version, with checksums of the files', () => {
    const { version } = JSON.parse(readFileSync(join(ROOT, 'packages/engine/package.json'), 'utf8')) as { version: string };
    expect(result.version).toBe(version);
    expect(result.tag).toBe(`engine-v${version}`);
    expect(result.files.map((f) => f.name)).toEqual([`glmsync-engine-${version}.tgz`, `glmsync-power-${version}.tgz`]);
    const sums = readFileSync(join(out, 'release', 'SHA512SUMS'), 'utf8');
    const pins = JSON.parse(readFileSync(join(out, 'release', 'integrity.json'), 'utf8')) as Record<string, string>;
    for (const f of result.files) {
      const buf = readFileSync(f.path);
      expect(integrity(buf)).toBe(f.integrity);
      expect(pins[f.name]).toBe(f.integrity);
      expect(sums).toContain(`${f.sha512}  ${f.name}\n`);
    }
  });

  it('the engine: no dependency, nothing of the workspace, nothing evaluated at runtime', () => {
    const pkg = JSON.parse(readFileSync(join(app, 'node_modules/glmsync-engine/package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg.name).toBe('glmsync-engine');
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.license).toBe('MIT');
    const code = readFileSync(join(app, 'node_modules/glmsync-engine/dist/index.js'), 'utf8');
    expect(code).not.toMatch(/@glmsync\//);
    expect(code).not.toMatch(/\bnew Function\s*\(|\beval\s*\(/);
    expect(code.startsWith('// SPDX-License-Identifier: MIT')).toBe(true);
  });

  it('the bundle syncs as the workspace’s engine does, the sign-in browser’s User-Agent on every call to Trackman', async () => {
    const mod = (await import(pathToFileURL(join(app, 'node_modules/glmsync-engine/dist/index.js')).href)) as typeof import('../packages/engine/src/index.ts');
    const clock = new VirtualClock(Date.parse('2026-11-28T08:00:00Z'));
    const target = new FakeTarget();
    const tm = new FakeTrackman(clock.now);
    const token = fakeToken('7c1d2e3f-0000-4000-8000-0000000000f1', { exp: Math.floor((clock.t + 7 * 86_400_000) / 1000) });
    tm.tokens.add(token);
    tm.activities = [{ id: 'A1', time: new Date(clock.t - 86_400_000).toISOString(), kind: 'RANGE_PRACTICE' }];
    tm.nodes.set('A1', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
    const fetch: FetchLike = (url, init) => (url === GRAPHQL_URL ? tm.fetch(url, init) : target.fetch(url, init));
    const engine = mod.makeEngine({ secrets: new mod.MemorySecrets(), storage: new MemoryStorage(), fetch, now: clock.now, sleep: clock.sleep, client: { kind: 'other', name: 'Golf Stats Sync engine' } });
    await engine.load();
    await engine.runner.pair({ target: target.base, code: 'K7M2PQ9X' });
    await engine.signIns.set('trackman', token, null, 'Mozilla/5.0 (Test) AppleWebKit/605.1.15');
    const [r] = await engine.runner.syncAll('timer');
    expect(r?.run.status).toBe('synced');
    expect(target.sessions.has('A1')).toBe(true);
    for (const q of tm.requests) expect(q.headers['User-Agent']).toBe('Mozilla/5.0 (Test) AppleWebKit/605.1.15');
    expect(target.asked.at(-1)?.client).toBe('other');
  });

  it('the types compile in an app that knows nothing of this workspace', () => {
    writeFileSync(
      join(app, 'app.ts'),
      [
        "import { backgroundWork, makeEngine, MemorySecrets, powerOf, type EnginePlatform, type LastRun } from 'glmsync-engine';",
        "import { GlmsyncPower } from 'glmsync-power';",
        'const storage = { get: async (_k: string) => null as string | null, set: async (_k: string, _v: string) => {}, remove: async (_k: string) => {} };',
        "const platform: EnginePlatform = { secrets: new MemorySecrets(), storage, client: { kind: 'other', name: 'App' } };",
        'const engine = makeEngine(platform);',
        "const last: LastRun | null = engine.runner.lastRun('x');",
        'const power = powerOf(GlmsyncPower);',
        "void backgroundWork({ os: 'ios', runner: engine.runner, now: Date.now, sleep: async () => {}, signal: new AbortController().signal });",
        'export { last, power };',
      ].join('\n'),
    );
    writeFileSync(
      join(app, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'Bundler', target: 'ES2022', lib: ['ES2022', 'DOM'], types: [], noEmit: true, skipLibCheck: false, resolveJsonModule: true }, files: ['app.ts'] }),
    );
    let said = '';
    try {
      execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', join(app, 'tsconfig.json')], { encoding: 'utf8' });
    } catch (e) {
      said = String((e as { stdout?: string }).stdout ?? e);
    }
    expect(said).toBe('');
  });

  it('the power module: an Expo module for iOS with its Swift, and the lines that hand it over', () => {
    const dir = join(app, 'node_modules/glmsync-power');
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg).toMatchObject({ name: 'glmsync-power', version: result.version, main: './index.js', license: 'MIT' });
    expect(JSON.parse(readFileSync(join(dir, 'expo-module.config.json'), 'utf8'))).toEqual({ platforms: ['apple'], apple: { modules: ['GlmsyncPowerModule'] } });
    expect(readFileSync(join(dir, 'ios/GlmsyncPowerModule.swift'), 'utf8')).toContain('Name("GlmsyncPower")');
    expect(readFileSync(join(dir, 'ios/GlmsyncPower.podspec'), 'utf8')).toContain("s.dependency 'ExpoModulesCore'");
    expect(readFileSync(join(dir, 'index.js'), 'utf8')).toContain("requireOptionalNativeModule('GlmsyncPower')");
  });
});
