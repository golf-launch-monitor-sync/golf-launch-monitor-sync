// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The bridge on a paired target's page (spec/page-bridge.md) against the real client, a made-up Trackman and a
 * made-up target. Offline; all data synthetic.
 */

import { BrowserClient } from '@glmsync/browser';
import { MemoryStorage, type FetchLike } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { describe, expect, it } from 'vitest';
import { answer, bridgeMatches, finishedOf, originOf, pairingFor, type BridgeDeps } from './bridge.ts';
import { finished } from './finished.ts';

const NOW = Date.parse('2026-11-18T21:00:00Z');
const ORIGIN = 'https://app.example.org';

function world() {
  const clock = new VirtualClock(NOW);
  const tm = new FakeTrackman(clock.now);
  tm.profile = { fullName: 'Alex Example' };
  tm.activities = [{ id: 'A1', time: '2026-11-17T17:00:00Z', kind: 'RANGE_PRACTICE' }];
  tm.nodes.set('A1', { strokes: [{ club: 'Iron7', time: '2026-11-17T17:00:00Z', measurement: { carry: 140, ballSpeed: 50 } }] });
  const target = new FakeTarget();
  const fetch: FetchLike = (url, init) => (url.startsWith(GRAPHQL_URL) ? tm.fetch(url, init) : target.fetch(url, init));
  const client = new BrowserClient({ storage: new MemoryStorage(), vault: new MemoryStorage(), kind: 'extension', name: 'GLMS test', version: '0.0.1', fetch, now: clock.now, sleep: clock.sleep, random: () => 0 });
  const started = new Map<string, number>();
  const deps: BridgeDeps = {
    status: () => client.status(),
    guardHold: () => client.guardHold(),
    run: (id, reason) => client.run(reason, id),
    now: clock.now,
    lastStarted: async (id) => started.get(id) ?? null,
    started: async (id, at) => void started.set(id, at),
  };
  const signIn = async () => {
    const t = fakeToken('player-0001', { exp: Math.round(clock.t / 1000 + 7 * 86400), iss: 'https://login.trackmangolf.com' });
    tm.tokens.add(t);
    await client.setKey(t);
    await client.confirm(true);
  };
  return { clock, tm, target, client, deps, signIn };
}

async function paired(w: ReturnType<typeof world>) {
  const out = await w.client.offerPairing({ target: w.target.base, code: 'K7M2PQ9X' });
  return out.ok ? out.id : '';
}

describe('where the bridge goes', () => {
  it('to the origin of each paired target, once', () => {
    expect(bridgeMatches([{ base: 'https://app.example.org/lm/v1' }, { base: 'https://app.example.org/other/lm/v1' }, { base: 'http://localhost:8000/lm/v1' }])).toEqual([
      'http://localhost:8000/*',
      'https://app.example.org/*',
    ]);
    expect(bridgeMatches([{ base: 'not a url' }])).toEqual([]);
  });

  it('reads only http(s) origins', () => {
    expect(originOf('https://app.example.org/profile?tab=lm')).toBe(ORIGIN);
    expect(originOf('chrome-extension://abc/popup.html')).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});

describe('a page asks the extension', () => {
  it('answers "unpaired" to a page of an origin no pairing has', async () => {
    const w = world();
    await paired(w);
    expect((await answer(w.deps, { id: 'r1', ask: 'state' }, 'https://app.example.org.evil.test')).reply).toEqual({ id: 'r1', answer: 'unpaired' });
    expect((await answer(w.deps, { id: 'r2', ask: 'fetch', reason: 'manual' }, 'https://other.example')).reply).toEqual({ id: 'r2', answer: 'unpaired' });
  });

  it('says where the sign-in stands, and fetches nothing without one', async () => {
    const w = world();
    await paired(w);
    expect((await answer(w.deps, { id: 'r1', ask: 'state' }, ORIGIN)).reply).toEqual({ id: 'r1', answer: 'state', signin: 'none', fetching: false });
    const out = await answer(w.deps, { id: 'r2', ask: 'fetch', reason: 'manual' }, ORIGIN);
    expect(out.reply).toEqual({ id: 'r2', answer: 'signin', signin: 'none' });
    expect(out.finish).toBeUndefined();
    expect(w.target.asked).toHaveLength(0);
  });

  it('starts a manual sync of its pairing - the plan first - and says how it ended', async () => {
    const w = world();
    await paired(w);
    await w.signIn();
    const out = await answer(w.deps, { id: 'r1', ask: 'fetch', reason: 'manual' }, ORIGIN);
    expect(out.reply).toEqual({ id: 'r1', answer: 'started' });
    expect(await out.finish?.()).toEqual({ id: 'r1', answer: 'finished', outcome: 'synced' });
    expect(w.target.asked.at(-1)).toMatchObject({ reason: 'manual', client: 'extension', signin: 'ready' });
    expect(w.target.sessions.has('A1')).toBe(true);
  });

  it('asks the plan with reason open when the player came back to the target app (spec 1.12.0)', async () => {
    const w = world();
    await paired(w);
    await w.signIn();
    const out = await answer(w.deps, { id: 'r1', ask: 'fetch', reason: 'open' }, ORIGIN);
    expect(out.reply).toEqual({ id: 'r1', answer: 'started' });
    await out.finish?.();
    expect(w.target.asked.at(-1)).toMatchObject({ reason: 'open', client: 'extension' });
  });

  it('starts no second sync within ten seconds of the last a page started', async () => {
    const w = world();
    await paired(w);
    await w.signIn();
    expect((await answer(w.deps, { id: 'r1', ask: 'fetch', reason: 'manual' }, ORIGIN)).reply).toEqual({ id: 'r1', answer: 'started' });
    expect((await answer(w.deps, { id: 'r2', ask: 'fetch', reason: 'manual' }, ORIGIN)).reply).toEqual({ id: 'r2', answer: 'busy' });
    w.clock.advance(9_999);
    expect((await answer(w.deps, { id: 'r3', ask: 'fetch', reason: 'manual' }, ORIGIN)).reply).toEqual({ id: 'r3', answer: 'busy' });
    w.clock.advance(1);
    expect((await answer(w.deps, { id: 'r4', ask: 'fetch', reason: 'manual' }, ORIGIN)).reply).toEqual({ id: 'r4', answer: 'started' });
  });

  it('starts none while a sync of its pairing runs, and says so in its state', async () => {
    const w = world();
    const id = await paired(w);
    await w.signIn();
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    const tmFetch = w.tm.fetch;
    w.tm.fetch = async (url, init) => {
      await held;
      return tmFetch(url, init);
    };
    const running = w.client.run('timer', id);
    await new Promise((done) => setTimeout(done, 0));
    expect((await answer(w.deps, { id: 'r1', ask: 'state' }, ORIGIN)).reply).toEqual({ id: 'r1', answer: 'state', signin: 'ready', fetching: true });
    expect((await answer(w.deps, { id: 'r2', ask: 'fetch', reason: 'manual' }, ORIGIN)).reply).toEqual({ id: 'r2', answer: 'busy' });
    release();
    await running;
  });

  it('says until when the guard holds, and starts nothing', async () => {
    const w = world();
    await paired(w);
    await w.signIn();
    w.tm.override = () => new TypeError('offline'); // no answer: the guard backs off
    await w.client.run('manual');
    w.clock.advance(10_000);
    const asked = w.target.asked.length;
    const out = await answer(w.deps, { id: 'r1', ask: 'fetch', reason: 'manual' }, ORIGIN);
    expect(out.reply).toMatchObject({ id: 'r1', answer: 'guard' });
    expect(Date.parse((out.reply as { until: string }).until)).toBeGreaterThan(w.clock.t);
    expect(w.target.asked).toHaveLength(asked);
  });
});

describe('how a sync ended, in the bridge’s words', () => {
  const r = (outcome: unknown) => ({ outcomes: [{ id: 'p', name: 'x', outcome }] }) as Parameters<typeof finishedOf>[0];
  it.each([
    [{ status: 'synced', result: {}, more: false, parts: 1, dropped: 0 }, { outcome: 'synced' }],
    [{ status: 'synced', notice: { code: 'auth_expired' } }, { outcome: 'signin' }],
    [{ status: 'synced', notice: { code: 'guard_limit', until: '2026-11-18T22:00:00Z' } }, { outcome: 'guard', until: '2026-11-18T22:00:00Z' }],
    [{ status: 'not_due' }, { outcome: 'not_due' }],
    [{ status: 'other_account' }, { outcome: 'other_account' }],
    [{ status: 'skipped', why: 'confirm' }, { outcome: 'signin' }],
    [{ status: 'failed', error: new Error('x') }, { outcome: 'failed' }],
    [{ status: 'disconnected' }, { outcome: 'failed' }],
  ])('%j', (outcome, expected) => {
    expect(finishedOf(r(outcome), 'p')).toEqual(expected);
  });

  it('a pairing that is gone meanwhile: failed', () => {
    expect(finishedOf({ outcomes: [] }, 'p')).toEqual({ outcome: 'failed' });
  });
});

describe('the pairing a page speaks for', () => {
  it('is the newest of its origin', async () => {
    const w = world();
    await paired(w);
    const s = await w.client.status();
    const older = { ...s.pairings[0]!, id: 'old', paired_at: '2026-01-01T00:00:00Z' };
    expect(pairingFor({ ...s, pairings: [older, ...s.pairings] }, ORIGIN)?.id).toBe(s.pairings[0]?.id);
  });
});

describe('the connect window is done', () => {
  const ready = { pairings: [{}], key: { state: 'ready', until: 1 }, attention: null } as unknown as Parameters<typeof finished>[1];
  it('once paired, signed in and confirmed', () => {
    expect(finished(null, ready)).toBe(true);
    expect(finished({ state: 'paired' } as Parameters<typeof finished>[0], ready)).toBe(true);
  });
  it('not while anything is still to do', () => {
    expect(finished({ state: 'asking' } as Parameters<typeof finished>[0], ready)).toBe(false);
    expect(finished(null, { ...ready!, key: { state: 'confirm', until: 1, who: null } })).toBe(false);
    expect(finished(null, { ...ready!, attention: 'sign_in' })).toBe(false);
    expect(finished(null, { ...ready!, pairings: [] })).toBe(false);
    expect(finished(null, null)).toBe(false);
  });
});
