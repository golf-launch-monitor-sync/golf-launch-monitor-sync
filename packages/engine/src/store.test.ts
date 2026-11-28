// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { expiresAt, subjectOf } from '@glmsync/provider-trackman';
import { fakeToken } from '@glmsync/provider-trackman/testing';
import { describe, expect, it } from 'vitest';
import { ChunkedSecrets, MemorySecrets, type Secrets } from './secrets.ts';
import { makeEngine } from './engine.ts';
import { SignIns, SLACK_MS } from './signins.ts';
import { MemoryStorage } from '@glmsync/core';

describe('the secure store in pieces', () => {
  it('keeps a short value whole and a long one in parts, and reads both back', async () => {
    const inner = new MemorySecrets();
    const s = new ChunkedSecrets(inner, 100);
    await s.set('a.b', 'short');
    expect(await s.get('a.b')).toBe('short');
    expect(inner.data.size).toBe(1);
    const long = 'x'.repeat(250) + 'é';
    await s.set('a.b', long);
    expect(await s.get('a.b')).toBe(long);
    expect(inner.data.size).toBe(4); // the head and three parts
    await s.set('a.b', 'short again');
    expect(inner.data.size).toBe(1); // the parts went
    await s.remove('a.b');
    expect(inner.data.size).toBe(0);
  });

  it('a part gone missing makes the value none, never half of it', async () => {
    const inner = new MemorySecrets();
    const s = new ChunkedSecrets(inner, 10);
    await s.set('k', 'abcdefghijklmnopqrstuvwxyz');
    inner.data.delete('k.part1');
    expect(await s.get('k')).toBeNull();
  });

  it('a crash before the head was written leaves the old value', async () => {
    const inner = new MemorySecrets();
    const s = new ChunkedSecrets(inner, 10);
    await s.set('k', 'old');
    let writes = 0;
    const failing: Secrets = {
      get: (k) => inner.get(k),
      remove: (k) => inner.remove(k),
      set: async (k, v) => {
        if (++writes > 2) throw new Error('crash');
        await inner.set(k, v);
      },
    };
    await expect(new ChunkedSecrets(failing, 10).set('k', 'a much longer value than ten')).rejects.toThrow('crash');
    expect(await s.get('k')).toBe('old');
  });

  it('refuses keys the platform store would not take', async () => {
    await expect(new MemorySecrets().set('glmsync/x', 'v')).rejects.toThrow();
  });
});

describe('sign-ins', () => {
  // The app's own reading of a key (services.ts): Trackman's from the token, the demo's from its text.
  const keys = {
    subject: (p: string, t: string) => (p === 'demo' ? `demo:${t}` : subjectOf(t)),
    expiresAt: (p: string, t: string) => (p === 'trackman' ? expiresAt(t) : null),
  };
  const at = Date.parse('2026-11-16T08:00:00Z');

  it('a key that runs out within a minute is not used; one that ran out while closed is dropped at start', async () => {
    let now = at;
    const secrets = new MemorySecrets();
    const s = new SignIns(secrets, keys, ['trackman', 'demo'], { now: () => now });
    const token = fakeToken('sub-0001', { exp: Math.floor((at + 3600_000) / 1000) });
    await s.set('trackman', token, 'Test Player');
    expect(s.credential('trackman')).toBe(token);
    now = at + 3600_000 - SLACK_MS + 1;
    expect(s.credential('trackman')).toBeNull();
    const again = new SignIns(secrets, keys, ['trackman', 'demo'], { now: () => now });
    await again.load();
    expect(again.get('trackman')).toBeNull();
    expect(again.had('trackman')?.subject).toBe('sub-0001');
    expect(again.canRenew('trackman')).toBe(true);
    expect([...secrets.data.keys()]).toEqual(['glmsync.had.trackman']);
  });

  it('a renewal keeps the name the player confirmed, for the same account only', async () => {
    const s = new SignIns(new MemorySecrets(), keys, ['trackman'], { now: () => at });
    await s.set('trackman', fakeToken('sub-0001'), 'Test Player');
    await s.set('trackman', fakeToken('sub-0001', { n: 2 }));
    expect(s.get('trackman')?.player).toBe('Test Player');
    await s.set('trackman', fakeToken('sub-0002'));
    expect(s.get('trackman')?.player).toBeNull();
  });

  it('no quiet renewal without a key held before, nor with a key without an account', async () => {
    const s = new SignIns(new MemorySecrets(), keys, ['trackman'], { now: () => at });
    expect(s.canRenew('trackman')).toBe(false);
    expect(s.renewalFits('trackman', fakeToken('sub-0001'))).toBe(false);
    await s.set('trackman', 'not-a-jwt');
    await s.expire('trackman');
    expect(s.renewalFits('trackman', 'not-a-jwt')).toBe(false);
  });

  it('forget removes key and mark, even when the store fails on one of them', async () => {
    const inner = new MemorySecrets();
    const s = new SignIns(
      { get: (k) => inner.get(k), set: (k, v) => inner.set(k, v), remove: async (k) => (k.includes('had') ? Promise.reject(new Error('locked')) : inner.remove(k)) },
      keys,
      ['trackman'],
      { now: () => at },
    );
    await s.set('trackman', fakeToken('sub-0001'));
    await expect(s.forget('trackman')).rejects.toThrow('locked');
    expect(inner.data.has('glmsync.signin.trackman')).toBe(false);
    expect(s.get('trackman')).toBeNull();
    expect(s.had('trackman')).toBeNull();
  });

  it('a secure store that refuses at start reads as signed out', async () => {
    const s = new SignIns({ get: () => Promise.reject(new Error('locked')), set: async () => {}, remove: async () => {} }, keys, ['trackman']);
    await s.load();
    expect(s.get('trackman')).toBeNull();
  });
});

describe('the parts together', () => {
  it('a long Trackman key survives the secure store in pieces', async () => {
    const secrets = new MemorySecrets();
    const services = makeEngine({ secrets, storage: new MemoryStorage() });
    await services.load();
    const token = fakeToken('sub-0001', { padding: 'p'.repeat(5000) });
    await services.signIns.set('trackman', token);
    const again = makeEngine({ secrets, storage: new MemoryStorage() });
    await again.load();
    expect(again.signIns.credential('trackman')).toBe(token);
    for (const v of secrets.data.values()) expect(v.length).toBeLessThanOrEqual(1800);
  });
});
