// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The test sign-ins this app keeps for an app that only asks it to sign in (spec 1.28.0): per pairing, in the secure
 * store, until the test is over, the pairing goes or the tester ends it - and nothing half kept. Synthetic.
 */
import { MemoryStorage } from '@glmsync/core';
import { MemorySecrets } from '@glmsync/engine';
import { describe, expect, it } from 'vitest';
import type { TestHeld } from './handover';
import { TestSignIns } from './testSignIns';

const NOW = Date.parse('2026-11-28T09:00:00Z');
const KEY = 'https://app.example.org/lm/v1|trackman';
const held = (over: Partial<TestHeld> = {}): TestHeld => ({
  code: 'K7MP-Q2RX', subject: 'caddie-test-T21-a-leon', userAgent: 'Mozilla/5.0 (iPhone)', validUntil: new Date(NOW + 86_400_000).toISOString(), signinValidS: 600, ...over,
});

function setup() {
  let now = NOW;
  const secrets = new MemorySecrets();
  const storage = new MemoryStorage();
  const make = () => new TestSignIns(secrets, storage, { now: () => now });
  return { secrets, storage, make, keep: make(), at: (t: number) => (now = t) };
}

describe('test sign-ins kept for a pairing', () => {
  it('are kept in the secure store (the code is the target’s secret), and found again after a restart', async () => {
    const s = setup();
    await s.keep.load([KEY]);
    await s.keep.set(KEY, held());
    expect(s.keep.get(KEY)).toEqual(held());
    expect([...s.secrets.data.values()].join()).toContain('K7MP-Q2RX');
    expect([...s.storage.data.values()].join()).not.toContain('K7MP-Q2RX');
    const again = s.make();
    await again.load([KEY]);
    expect(again.get(KEY)).toEqual(held());
  });

  it('go when the test is over, when their pairing went, and when the tester ends them', async () => {
    const s = setup();
    await s.keep.load([KEY]);
    await s.keep.set(KEY, held());
    s.at(NOW + 86_400_000);
    expect(s.keep.get(KEY)).toBeNull();

    const t = setup();
    await t.keep.load([KEY]);
    await t.keep.set(KEY, held());
    const gone = t.make();
    await gone.load([]);
    expect(gone.get(KEY)).toBeNull();
    expect(t.secrets.data.size).toBe(0);

    const u = setup();
    await u.keep.load([KEY]);
    await u.keep.set(KEY, held());
    await u.keep.forget(KEY);
    expect(u.keep.get(KEY)).toBeNull();
    expect(u.secrets.data.size).toBe(0);
    const fresh = u.make();
    await fresh.load([KEY]);
    expect(fresh.get(KEY)).toBeNull();
  });

  it('a broken entry is none, and a secure store that refuses keeps nothing (the error goes to the screen)', async () => {
    const s = setup();
    await s.keep.load([KEY]);
    await s.keep.set(KEY, held());
    for (const k of s.secrets.data.keys()) s.secrets.data.set(k, '{broken');
    const again = s.make();
    await again.load([KEY]);
    expect(again.get(KEY)).toBeNull();

    const t = setup();
    await t.keep.load([KEY]);
    t.secrets.set = async () => {
      throw new Error('locked');
    };
    await expect(t.keep.set(KEY, held())).rejects.toThrow('locked');
    expect(t.keep.get(KEY)).toBeNull();
  });

  it('refuses one that isn’t one: a code that is no code, a time that is none', async () => {
    const s = setup();
    await s.keep.load([KEY]);
    await expect(s.keep.set(KEY, held({ code: 'aaa.bbb.ccc' }))).rejects.toThrow();
    await expect(s.keep.set(KEY, held({ validUntil: 'soon' }))).rejects.toThrow();
    expect(s.keep.get(KEY)).toBeNull();
  });
});
