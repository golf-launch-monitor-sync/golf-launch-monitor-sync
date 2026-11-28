// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** SR-8b: a target that needs a newer version - the state, the result in the way back, and *Update now*. */

import type { LastRun } from '@glmsync/engine';
import { describe, expect, it } from 'vitest';
import { isOutdated, outdatedTargets, syncResult, updateNow, wayBack, type UpdateNowDeps } from './outdated.ts';
import { APK_URL, TESTFLIGHT_URL } from './newBuild.ts';

const run = (over: Partial<LastRun> = {}): LastRun => ({ at: 0, reason: 'manual', status: 'synced', ...over });
const r = (over: Partial<LastRun>) => ({ key: 'k1', run: run(over) });
const counts = (sessions: number, rounds = 0, round_shots = 0) => ({ sessions, shots: sessions * 10, rounds, round_shots, duplicates: 0 });

describe('isOutdated', () => {
  it('only a run the target called too old, and only while that version still runs', () => {
    expect(isOutdated(run({ status: 'outdated', version: '0.22.0' }), '0.22.0')).toBe(true);
    expect(isOutdated(run({ status: 'outdated', version: '0.22.0' }), '0.23.0')).toBe(false);
    // A run kept from before it named a version: it still says so until the next plan.
    expect(isOutdated(run({ status: 'outdated' }), '0.23.0')).toBe(true);
    expect(isOutdated(run({ status: 'not_due' }), '0.22.0')).toBe(false);
    expect(isOutdated(null, '0.22.0')).toBe(false);
  });

  it('names each app that needs the newer version once', () => {
    const pairings = [
      { key: 'a', target: { name: 'Example App' } },
      { key: 'b', target: { name: 'Example App' } },
      { key: 'c', target: { name: 'Other App' } },
    ];
    const runs: Record<string, LastRun> = { a: run({ status: 'outdated', version: '1.0.0' }), b: run({ status: 'outdated', version: '1.0.0' }), c: run() };
    expect(outdatedTargets(pairings, (k) => runs[k] ?? null, '1.0.0')).toEqual(['Example App']);
    expect(outdatedTargets(pairings, (k) => runs[k] ?? null, '1.1.0')).toEqual([]);
  });
});

describe('syncResult: what the way back tells the target (spec 1.22.0)', () => {
  it('outdated, before anything else the player has to do', () => {
    expect(syncResult([r({ status: 'outdated' })])).toBe('outdated');
    expect(syncResult([r({ status: 'signed_out' }), r({ status: 'outdated' })])).toBe('outdated');
    expect(syncResult([r({ status: 'synced', result: counts(3) }), r({ status: 'outdated' })])).toBe('outdated');
  });

  it('the other results, each as the spec names it', () => {
    expect(syncResult([r({ result: counts(3) })])).toBe('new');
    expect(syncResult([r({ result: counts(0, 0, 4) })])).toBe('new');
    expect(syncResult([r({ result: counts(0) })])).toBe('nothing');
    expect(syncResult([r({ result: counts(0), notice: 'auth_expired' })])).toBe('signin');
    expect(syncResult([r({ result: counts(0), notice: 'guard_limit' })])).toBe('not_due');
    expect(syncResult([r({ result: counts(0), notice: 'provider_unavailable' })])).toBe('not_due');
    expect(syncResult([r({ status: 'not_due' })])).toBe('not_due');
    expect(syncResult([r({ status: 'busy' })])).toBe('not_due');
    expect(syncResult([r({ status: 'signed_out' })])).toBe('signin');
    expect(syncResult([r({ status: 'other_account' })])).toBe('signin');
    for (const status of ['failed', 'cancelled', 'disconnected', 'unpaired'] as const) expect(syncResult([r({ status })])).toBe('failed');
    expect(syncResult([r({ status: 'failed' }), r({ result: counts(2) })])).toBe('failed');
    expect(syncResult([])).toBeNull();
  });
});

describe('wayBack: the sync link’s jump back carries the result', () => {
  it('result=outdated in the query, before a fragment, a result it had replaced', () => {
    expect(wayBack('exampleapp://synced', [r({ status: 'outdated' })])).toBe('exampleapp://synced?result=outdated');
    expect(wayBack('https://app.example.org/profile?tab=lm&result=new#card', [r({ status: 'outdated' })])).toBe('https://app.example.org/profile?tab=lm&result=outdated#card');
    expect(wayBack('exampleapp://synced', [r({ result: counts(1) })])).toBe('exampleapp://synced?result=new');
    // Nothing ran: as it was.
    expect(wayBack('exampleapp://synced', [])).toBe('exampleapp://synced');
  });
});

describe('updateNow: the button', () => {
  function deps(over: { available?: boolean | 'throws'; enabled?: boolean; platform?: string; build?: 'new' | 'same' | 'unreadable'; reload?: 'throws' } = {}) {
    const calls: string[] = [];
    const d: UpdateNowDeps = {
      updates: {
        isEnabled: over.enabled ?? true,
        async checkForUpdateAsync() {
          calls.push('check');
          if (over.available === 'throws') throw new Error('offline');
          return { isAvailable: over.available ?? true };
        },
        async fetchUpdateAsync() {
          calls.push('fetch');
          return { isNew: true };
        },
        async reloadAsync() {
          calls.push('reload');
          if (over.reload === 'throws') throw new Error('no');
        },
      },
      platform: over.platform ?? 'android',
      runtime: 'rt-1',
      fetch: (async () => {
        calls.push('latest');
        if (over.build === 'unreadable') return new Response('nope', { status: 503 });
        return new Response(JSON.stringify({ android: { runtime: over.build === 'new' ? 'rt-2' : 'rt-1' }, ios: { runtime: over.build === 'new' ? 'rt-2' : 'rt-1' } }));
      }) as typeof fetch,
    };
    return { d, calls };
  }

  it('an update over the air: downloaded and applied at once, in the foreground', async () => {
    const { d, calls } = deps();
    expect(await updateNow(d)).toEqual({ step: 'reloading' });
    expect(calls).toEqual(['check', 'fetch', 'reload']);
  });

  it('none over the air: the new build, the APK on Android, TestFlight on the iPhone', async () => {
    const a = deps({ available: false, build: 'new' });
    expect(await updateNow(a.d)).toEqual({ step: 'build', url: APK_URL });
    const i = deps({ available: false, build: 'new', platform: 'ios' });
    expect(await updateNow(i.d)).toEqual({ step: 'build', url: TESTFLIGHT_URL });
  });

  it('no update server (a development build): straight to the build', async () => {
    const { d, calls } = deps({ enabled: false, build: 'new' });
    expect(await updateNow(d)).toEqual({ step: 'build', url: APK_URL });
    expect(calls).toEqual(['latest']);
  });

  it('nothing newer anywhere: says so, rather than pretending', async () => {
    expect(await updateNow(deps({ available: false, build: 'same' }).d)).toEqual({ step: 'latest' });
  });

  it('the update server out of reach and nothing to say about a build: failed, try again', async () => {
    expect(await updateNow(deps({ available: 'throws', build: 'unreadable' }).d)).toEqual({ step: 'failed' });
    // Out of reach, but a new build is known: that one.
    expect(await updateNow(deps({ available: 'throws', build: 'new' }).d)).toEqual({ step: 'build', url: APK_URL });
  });

  it('a download that broke is no "nothing newer"', async () => {
    const { d } = deps({ build: 'same' });
    d.updates.fetchUpdateAsync = async () => {
      throw new Error('broke');
    };
    expect(await updateNow(d)).toEqual({ step: 'failed' });
  });

  it('downloaded but the restart refused: it applies at the next start', async () => {
    expect(await updateNow(deps({ reload: 'throws' }).d)).toEqual({ step: 'next_start' });
  });
});
