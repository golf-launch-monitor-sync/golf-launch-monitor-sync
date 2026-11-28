// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The made-up Trackman refuses a sign-in that has run out, as Trackman refuses an expired key (spec 1.28.0: a test
 * sign-in handed to a target app runs out at its `expires_at`), and test mode's keeping carries that expiry: set with
 * the yes, renewed by a later handover, ended by a refusal, kept across a restart. All of it synthetic.
 */
import { MemoryStorage } from '@glmsync/core';
import { VirtualClock } from '@glmsync/core/testing';
import { readTestScenario } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { GRAPHQL_URL } from './index.ts';
import { replay } from './replay.ts';
import { FakeTrackman, fakeToken } from './testing.ts';
import { MemoryBlobs, Tests } from './testMode.ts';

const START = Date.parse('2026-11-28T09:00:00Z');
const MIN = 60_000;

const ask = (fake: FakeTrackman, token: string) =>
  fake.fetch(GRAPHQL_URL, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ query: 'query Me { me { id } }' }) });

function scenario() {
  const read = readTestScenario(
    { name: 'steady', provider: 'trackman', subject: 'test-sub-0001', profile: { fullName: 'Sam Example' }, data: {}, valid_until: new Date(START + 7 * 86_400_000).toISOString(), signin_valid_s: 600 },
    new Date(START).toISOString(),
  );
  if (!read.ok) throw new Error(read.error);
  return read.scenario;
}

describe('the made-up Trackman and an expiry', () => {
  it('answers until expiresAt, then 401 as Trackman does for a key that ran out', async () => {
    const clock = new VirtualClock(START);
    const fake = new FakeTrackman(clock.now);
    const token = fakeToken('sub-1');
    fake.tokens.add(token);
    fake.expiresAt = START + 10 * MIN;
    expect((await ask(fake, token)).status).not.toBe(401);
    clock.advance(10 * MIN - 1);
    expect((await ask(fake, token)).status).not.toBe(401);
    clock.advance(1);
    expect((await ask(fake, token)).status).toBe(401);
    fake.expiresAt = undefined; // renewed without an end (the companion's own test mode): answers again
    expect((await ask(fake, token)).status).not.toBe(401);
  });

  it('a replay takes the expiry it is given', async () => {
    const clock = new VirtualClock(START);
    const r = replay(scenario(), { now: clock.now, signinUntil: START + MIN });
    expect(r.fake.expiresAt).toBe(START + MIN);
    expect(replay(scenario(), { now: clock.now }).fake.expiresAt).toBeUndefined();
  });
});

describe('test mode keeps the sign-in’s expiry', () => {
  it('from the yes, renewed, ended by a refusal, across a restart - and the playback follows each', async () => {
    const clock = new VirtualClock(START);
    const storage = new MemoryStorage();
    const blobs = new MemoryBlobs();
    const tests = new Tests(storage, blobs, { now: clock.now });
    const until = new Date(START + 10 * MIN).toISOString();
    const m = await tests.start('k1', scenario(), null, until);
    expect(m.signin_until).toBe(until);
    expect((await tests.provider('k1'))?.fake.expiresAt).toBe(START + 10 * MIN);

    const later = new Date(START + 30 * MIN).toISOString();
    expect(await tests.renewSignin('k1', later)).toBe(true);
    expect(tests.of('k1')?.signin_until).toBe(later);
    expect((await tests.provider('k1'))?.fake.expiresAt).toBe(START + 30 * MIN);

    const again = new Tests(storage, blobs, { now: clock.now });
    await again.load();
    expect(again.of('k1')?.signin_until).toBe(later);
    expect((await again.provider('k1'))?.fake.expiresAt).toBe(START + 30 * MIN);

    clock.advance(5 * MIN);
    await again.expireSignin('k1');
    expect(again.of('k1')?.signin_until).toBe(new Date(START + 5 * MIN).toISOString());
    expect((await again.provider('k1'))?.fake.expiresAt).toBe(START + 5 * MIN);
    expect(await again.renewSignin('nope', later)).toBe(false);
  });

  it('a test of the companion’s own (no expiry) stays as it was', async () => {
    const tests = new Tests(new MemoryStorage(), new MemoryBlobs(), { now: () => START });
    const m = await tests.start('k1', scenario(), 'Sam Example');
    expect('signin_until' in m).toBe(false);
    expect((await tests.provider('k1'))?.fake.expiresAt).toBeUndefined();
  });
});
