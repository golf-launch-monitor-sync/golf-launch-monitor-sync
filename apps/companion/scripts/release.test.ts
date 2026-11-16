// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * release.sh with Expo swapped for stubs: what it publishes or builds, and that it does nothing (and
 * says why) without a token, a project, a build that can run the code, or iOS set up.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./release.sh', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Opts {
  token?: string;
  projectId?: string | null;
  /** Builds of the current runtime Expo lists, by status. */
  builds?: string[];
  ascAppId?: string | null;
  failUpdate?: boolean;
}

function run(args: string[], o: Opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  dirs.push(dir);
  const log = join(dir, 'eas.log');
  const stub = (name: string, body: string) => {
    const p = join(dir, name);
    writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(p, 0o755);
    return p;
  };
  const builds = JSON.stringify((o.builds ?? []).map((status, i) => ({ id: `b${i}`, status })));
  const eas = stub(
    'eas',
    `echo "$*" >> ${JSON.stringify(log)}
case "$1" in
  build:list) echo '${builds}' ;;
  build) echo '[{"id":"new-build","app":{"slug":"golf-launch-monitor-sync","ownerAccount":{"name":"example-org"}}}]' ;;
  update) ${o.failUpdate ? 'exit 3' : 'echo published'} ;;
esac`,
  );
  const config = stub('config', `echo '${JSON.stringify(o.projectId === null ? {} : { extra: { eas: { projectId: o.projectId ?? '0b1d2c3e-0000-4000-8000-000000000001' } } })}'`);
  const runtime = stub('runtime', 'echo "{\\"runtimeVersion\\":\\"fp-$2-1234567890abcdef\\"}"');
  const easJson = join(dir, 'eas.json');
  writeFileSync(easJson, JSON.stringify({ submit: { testflight: { ios: o.ascAppId ? { ascAppId: o.ascAppId } : {} } } }));
  const summary = join(dir, 'summary.md');
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: dir,
    EAS_CLI: eas,
    EXPO_CONFIG: config,
    RESOLVE_RUNTIME: runtime,
    EAS_JSON: easJson,
    GITHUB_STEP_SUMMARY: summary,
  };
  if (o.token !== '') env.EXPO_TOKEN = o.token ?? 'robot-token-for-tests';
  const r = spawnSync('bash', [SCRIPT, ...args], { env, encoding: 'utf8' });
  const read = (f: string) => {
    try {
      return readFileSync(f, 'utf8');
    } catch {
      return '';
    }
  };
  return { status: r.status, out: r.stdout + r.stderr, eas: read(log), summary: read(summary) };
}

describe('release.sh update', () => {
  it('publishes to the channel the builds listen on when a build of this runtime exists', () => {
    const r = run(['update'], { builds: ['FINISHED'] });
    expect(r.status).toBe(0);
    expect(r.eas).toMatch(/build:list --platform android --build-profile preview --runtime-version fp-android-/);
    expect(r.eas).toMatch(/^update --channel preview --environment preview --platform android /m);
    expect(r.summary).toMatch(/Update published for android/);
  });

  it('asks for a build by hand when none can run the code, and publishes nothing', () => {
    const r = run(['update'], { builds: ['ERRORED', 'CANCELED'] });
    expect(r.status).toBe(0);
    expect(r.eas).not.toMatch(/^update /m);
    expect(r.eas).not.toMatch(/^build /m);
    expect(r.summary).toMatch(/a new build is needed/);
  });

  it('both platforms in one update once iOS is set up', () => {
    const r = run(['update'], { builds: ['IN_PROGRESS'], ascAppId: '1234567890' });
    expect(r.eas).toMatch(/build:list --platform ios --build-profile testflight/);
    expect(r.eas).toMatch(/^update .*--platform all /m);
  });

  it('without a token or a project: nothing, and the summary says why', () => {
    const a = run(['update'], { token: '' });
    expect(a.status).toBe(0);
    expect(a.eas).toBe('');
    expect(a.summary).toMatch(/No EXPO_TOKEN/);
    const b = run(['update'], { projectId: null });
    expect(b.status).toBe(0);
    expect(b.eas).toBe('');
    expect(b.summary).toMatch(/No EAS project id/);
  });

  it('a failed update fails the run', () => {
    const r = run(['update'], { builds: ['FINISHED'], failUpdate: true });
    expect(r.status).toBe(1);
    expect(r.summary).toMatch(/could not be published/);
  });
});

describe('release.sh build', () => {
  it('an APK, and the link to it', () => {
    const r = run(['build', '--platform', 'android']);
    expect(r.status).toBe(0);
    expect(r.eas).toMatch(/^build --platform android --profile preview --non-interactive --no-wait --json --message /m);
    expect(r.summary).toMatch(/https:\/\/expo\.dev\/accounts\/example-org\/projects\/golf-launch-monitor-sync\/builds\/new-build/);
  });

  it('iOS goes to TestFlight by itself, and only once it is set up', () => {
    const r = run(['build', '--platform', 'ios'], { ascAppId: '1234567890' });
    expect(r.eas).toMatch(/^build --platform ios --profile testflight .*--auto-submit/m);
    const no = run(['build', '--platform', 'ios']);
    expect(no.status).toBe(1);
    expect(no.eas).toBe('');
    expect(no.out).toMatch(/iOS isn't set up yet/);
  });

  it('refuses what it does not know', () => {
    expect(run(['build', '--platform', 'windows']).status).toBe(1);
    expect(run(['deploy']).status).toBe(1);
  });
});
