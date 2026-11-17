// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** A new build of the app is out: from latest.json against the running runtime (LMS-W3-N-b). */

import { describe, expect, it } from 'vitest';
import { APK_URL, checkNewBuild, LATEST_URL, latestRuntime, newBuild, TESTFLIGHT_URL } from './newBuild.ts';

const LATEST = {
  format: 'glmsync-companion/1',
  android: { runtime: 'fp-android-new', version: '0.1.0', commit: 'abc1234' },
  ios: { runtime: 'fp-ios-new' },
};

describe('newBuild', () => {
  it('Android: another runtime than this build is a new APK, to download from the fixed address', () => {
    expect(newBuild('android', 'fp-android-old', LATEST)).toEqual({ platform: 'android', url: APK_URL });
    expect(APK_URL).toBe('https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases/download/companion-android/golf-launch-monitor-sync-companion.apk');
  });

  it('iPhone: a new build comes through TestFlight', () => {
    expect(newBuild('ios', 'fp-ios-old', LATEST)).toEqual({ platform: 'ios', url: TESTFLIGHT_URL });
  });

  it('nothing when this is the newest build, when it is a development build, or on the web', () => {
    expect(newBuild('android', 'fp-android-new', LATEST)).toBeNull();
    expect(newBuild('android', null, LATEST)).toBeNull();
    expect(newBuild('android', '', LATEST)).toBeNull();
    expect(newBuild('web', 'x', LATEST)).toBeNull();
  });

  it('nothing from a file that says nothing usable - and never an address from it', () => {
    expect(newBuild('ios', 'x', { android: LATEST.android })).toBeNull();
    expect(newBuild('android', 'x', null)).toBeNull();
    expect(newBuild('android', 'x', 'junk')).toBeNull();
    expect(newBuild('android', 'x', { android: { runtime: 42 } })).toBeNull();
    expect(latestRuntime({ android: { runtime: '<script>' } }, 'android')).toBeNull();
    const evil = newBuild('android', 'x', { android: { runtime: 'y', url: 'https://evil.example/app.apk' } });
    expect(evil?.url).toBe(APK_URL);
  });
});

describe('checkNewBuild', () => {
  const answer = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch;

  it('reads latest.json beside the APK', async () => {
    let asked = '';
    const f = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify(LATEST));
    }) as unknown as typeof fetch;
    expect(await checkNewBuild('android', 'fp-android-old', f)).toEqual({ platform: 'android', url: APK_URL });
    expect(asked).toBe(LATEST_URL);
  });

  it('never throws: no network, an error page, junk, too much, too slow all mean nothing to say', async () => {
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await checkNewBuild('android', 'old', offline)).toBeNull();
    expect(await checkNewBuild('android', 'old', answer('Not Found', 404))).toBeNull();
    expect(await checkNewBuild('android', 'old', answer('<html>'))).toBeNull();
    expect(await checkNewBuild('android', 'old', answer(`{"android":{"runtime":"${'x'.repeat(30_000)}"}}`))).toBeNull();
    const slow = ((_: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch;
    expect(await checkNewBuild('android', 'old', slow, 20)).toBeNull();
  });

  it("doesn't ask at all without a runtime of its own", async () => {
    let asked = false;
    const f = (async () => {
      asked = true;
      return new Response('{}');
    }) as unknown as typeof fetch;
    expect(await checkNewBuild('android', null, f)).toBeNull();
    expect(asked).toBe(false);
  });
});
