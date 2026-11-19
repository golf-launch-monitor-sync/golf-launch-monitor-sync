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
  /** Expo refuses the build (a plan's limit, say): a message, nothing on stdout. */
  failBuild?: boolean;
  /** A waited-for build that ended otherwise than FINISHED. */
  buildStatus?: string;
  /** What `build:view` says of it (else the same as buildStatus). */
  viewStatus?: string;
  /** The runtime Expo names for a build (else the script works it out itself). */
  runtimeVersion?: string;
  /** latest.json already in the pre-release. */
  previousLatest?: unknown;
  /** The pre-release can't take a file (none yet). */
  failUpload?: boolean;
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
  build) ${o.failBuild ? "echo 'This account has used its Android builds from the Free plan this month.' >&2; exit 1" : `if [[ "$*" == *--wait* ]]; then echo '[{"id":"new-build","status":"${o.buildStatus ?? 'FINISHED'}",${o.runtimeVersion ? `"runtimeVersion":"${o.runtimeVersion}",` : ''}"artifacts":{"buildUrl":"https://expo.example/artifacts/app.apk"},"app":{"slug":"golf-launch-monitor-sync","ownerAccount":{"name":"example-org"}}}]'; else echo '[{"id":"new-build","app":{"slug":"golf-launch-monitor-sync","ownerAccount":{"name":"example-org"}}}]'; fi`} ;;
  build:view) echo '{"id":"new-build","status":"${o.viewStatus ?? o.buildStatus ?? 'FINISHED'}","runtimeVersion":"fp-viewed","app":{"slug":"golf-launch-monitor-sync","ownerAccount":{"name":"example-org"}}}' ;;
  update) ${o.failUpdate ? 'exit 3' : 'echo published'} ;;
esac`,
  );
  const config = stub('config', `echo '${JSON.stringify(o.projectId === null ? {} : { version: '0.1.0', extra: { eas: { projectId: o.projectId ?? '0b1d2c3e-0000-4000-8000-000000000001' } } })}'`);
  const runtime = stub('runtime', 'echo "{\\"runtimeVersion\\":\\"fp-$2-1234567890abcdef\\"}"');
  const easJson = join(dir, 'eas.json');
  writeFileSync(easJson, JSON.stringify({ submit: { testflight: { ios: o.ascAppId ? { ascAppId: o.ascAppId } : {} } } }));
  const summary = join(dir, 'summary.md');
  const ghLog = join(dir, 'gh.log');
  // The latest.json it hands to GitHub is kept for the test; `release download` writes the previous one, if any.
  const uploaded = join(dir, 'uploaded-latest.json');
  const gh = stub(
    'gh',
    `echo "$*" >> ${JSON.stringify(ghLog)}
if [ "$1 $2" = "release download" ]; then
  out=""; prev=""
  for a in "$@"; do if [ "$prev" = "--output" ]; then out="$a"; fi; prev="$a"; done
  ${o.previousLatest === undefined ? 'exit 1' : `printf '%s' '${JSON.stringify(o.previousLatest)}' > "$out"`}
fi
if [ "$1 $2" = "release upload" ] && ${o.failUpload ? 'true' : 'false'}; then exit 1; fi
for a in "$@"; do case "$a" in *latest.json) if [ -f "$a" ]; then cp "$a" ${JSON.stringify(uploaded)}; fi ;; esac; done`,
  );
  // The download: the address it was asked for, as the file's content.
  const download = stub('download', 'printf "APK from %s" "$2" > "$1"');
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: dir,
    EAS_CLI: eas,
    EXPO_CONFIG: config,
    RESOLVE_RUNTIME: runtime,
    EAS_JSON: easJson,
    GITHUB_STEP_SUMMARY: summary,
    GH_CLI: gh,
    DOWNLOAD: download,
    GITHUB_SHA: 'abc1234',
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
  const latest = read(uploaded);
  return {
    status: r.status,
    out: r.stdout + r.stderr,
    eas: read(log),
    summary: read(summary),
    gh: read(ghLog),
    latest: latest ? (JSON.parse(latest) as Record<string, any>) : null,
  };
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

  it('a build Expo refuses fails the run with its reason, not a script error', () => {
    const r = run(['build', '--platform', 'android'], { failBuild: true });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/Free plan/);
    expect(r.summary).toMatch(/android build could not be started/);
    expect(r.out).not.toMatch(/TypeError/);
  });

  it('iOS goes to TestFlight by itself, and only once it is set up', () => {
    const r = run(['build', '--platform', 'ios'], { ascAppId: '1234567890' });
    expect(r.eas).toMatch(/^build --platform ios --profile testflight .*--auto-submit/m);
    const no = run(['build', '--platform', 'ios']);
    expect(no.status).toBe(1);
    expect(no.eas).toBe('');
    expect(no.out).toMatch(/iOS isn't set up yet/);
  });

  it('with --apk-release: waits for the APK and puts it into the pre-release companion-android, replacing the last', () => {
    const r = run(['build', '--platform', 'android', '--apk-release']);
    expect(r.status).toBe(0);
    expect(r.eas).toMatch(/^build --platform android --profile preview --non-interactive --wait --json /m);
    const lines = r.gh.trim().split('\n');
    expect(lines[0]).toMatch(/^release download companion-android --pattern latest\.json --output /);
    expect(lines[1]).toBe('release delete companion-android --cleanup-tag --yes');
    expect(lines[2]).toMatch(
      /^release create companion-android \S+\/golf-launch-monitor-sync-companion\.apk \S+\/latest\.json --prerelease --target abc1234 /,
    );
    expect(r.summary).toMatch(/on GitHub as the pre-release companion-android/);
  });

  // LMS-W3-N-b (17 Nov): the app tells a new build from latest.json (src/lib/newBuild.ts).
  it("with the APK goes latest.json: the build's runtime, as Expo names it, else as worked out here", () => {
    const named = run(['build', '--platform', 'android', '--apk-release'], { runtimeVersion: 'fp-from-expo' });
    expect(named.latest).toMatchObject({ format: 'glmsync-companion/1', android: { runtime: 'fp-from-expo', version: '0.1.0' } });
    expect(named.latest?.android.built_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const worked = run(['build', '--platform', 'android', '--apk-release']);
    expect(worked.latest?.android.runtime).toBe('fp-android-1234567890abcdef');
  });

  it("an Android build keeps what latest.json said about the iPhone, and drops junk", () => {
    const r = run(['build', '--platform', 'android', '--apk-release'], {
      runtimeVersion: 'fp-a2',
      previousLatest: { android: { runtime: 'fp-a1' }, ios: { runtime: 'fp-i1', version: '0.1.0' }, evil: { url: 'x' } },
    });
    expect(r.latest).toEqual({
      format: 'glmsync-companion/1',
      android: expect.objectContaining({ runtime: 'fp-a2' }),
      ios: { runtime: 'fp-i1', version: '0.1.0' },
    });
  });

  it('with --apk-release and iOS too: both are waited for, the finished iPhone build goes into latest.json', () => {
    const r = run(['build', '--platform', 'all', '--apk-release'], { ascAppId: '1234567890', runtimeVersion: 'fp-x' });
    expect(r.status).toBe(0);
    const builds = r.eas.split('\n').filter((l) => l.startsWith('build '));
    expect(builds[0]).toMatch(/--platform ios .*--wait .*--auto-submit/);
    expect(builds[1]).toMatch(/--platform android .*--wait/);
    expect(r.gh).toMatch(/^release upload companion-android \S+\/latest\.json --clobber$/m);
    expect(r.summary).toMatch(/latest\.json names the new iOS build/);
  });

  it("an iPhone build without the pre-release yet: says latest.json wasn't updated, and still succeeds", () => {
    const r = run(['build', '--platform', 'ios', '--apk-release'], { ascAppId: '1234567890', failUpload: true });
    expect(r.status).toBe(0);
    expect(r.summary).toMatch(/latest\.json was not updated/);
  });

  it('an iPhone build that did not finish writes nothing and fails the run', () => {
    const r = run(['build', '--platform', 'ios', '--apk-release'], { ascAppId: '1234567890', buildStatus: 'ERRORED' });
    expect(r.status).toBe(1);
    expect(r.gh).toBe('');
    expect(r.summary).toMatch(/iOS build did not finish/);
  });

  // 19 Nov: with --auto-submit, eas-cli printed the build as it was when the submission was scheduled
  // (IN_QUEUE), though it had waited for the build and the upload; the run failed after a good build.
  it('an iPhone build listed as still queued after the wait is asked for again, and counts once Expo says FINISHED', () => {
    const r = run(['build', '--platform', 'ios', '--apk-release'], {
      ascAppId: '1234567890',
      buildStatus: 'IN_QUEUE',
      viewStatus: 'FINISHED',
      previousLatest: { android: { runtime: 'fp-a1' } },
    });
    expect(r.status).toBe(0);
    expect(r.eas).toMatch(/^build:view new-build --json$/m);
    expect(r.latest?.ios.runtime).toBe('fp-viewed');
    expect(r.summary).toMatch(/iOS build done/);
    const failed = run(['build', '--platform', 'ios', '--apk-release'], {
      ascAppId: '1234567890',
      buildStatus: 'IN_QUEUE',
      viewStatus: 'ERRORED',
    });
    expect(failed.status).toBe(1);
    expect(failed.gh).toBe('');
    expect(failed.summary).toMatch(/iOS build did not finish/);
  });

  it('without --apk-release an iPhone build is only started, and latest.json stays as it is', () => {
    const r = run(['build', '--platform', 'ios'], { ascAppId: '1234567890' });
    expect(r.eas).toMatch(/--platform ios .*--no-wait/);
    expect(r.gh).toBe('');
  });

  it('a build that did not finish puts nothing on GitHub and fails the run', () => {
    const r = run(['build', '--platform', 'android', '--apk-release'], { buildStatus: 'ERRORED' });
    expect(r.status).toBe(1);
    expect(r.gh).toBe('');
    expect(r.summary).toMatch(/did not finish/);
  });

  it('--apk-release only with build', () => {
    expect(run(['update', '--apk-release'], { builds: ['FINISHED'] }).status).toBe(1);
  });

  it('refuses what it does not know', () => {
    expect(run(['build', '--platform', 'windows']).status).toBe(1);
    expect(run(['deploy']).status).toBe(1);
  });
});
