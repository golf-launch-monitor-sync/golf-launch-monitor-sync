// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Over-the-air updates fetched in the background and after a target's nudge, applied at the next start. */

import { MemoryStorage } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import { fetchUpdateQuietly, UPDATE_CHECK_KEY, UPDATE_EVERY_MS, type UpdatesApi } from './otaUpdate.ts';

const T0 = Date.parse('2026-11-28T03:00:00Z');

function fakeUpdates(over: Partial<UpdatesApi> & { available?: boolean } = {}) {
  const calls: string[] = [];
  const api: UpdatesApi = {
    isEnabled: true,
    async checkForUpdateAsync() {
      calls.push('check');
      return { isAvailable: over.available ?? true };
    },
    async fetchUpdateAsync() {
      calls.push('fetch');
      return { isNew: true };
    },
    ...over,
  };
  return { api, calls };
}

describe('fetchUpdateQuietly', () => {
  it('checks and downloads, and never reloads: the update applies at the next start', async () => {
    const { api, calls } = fakeUpdates();
    const storage = new MemoryStorage();
    expect(await fetchUpdateQuietly({ updates: api, storage, now: () => T0 })).toBe('fetched');
    expect(calls).toEqual(['check', 'fetch']);
    expect(Object.keys(api)).not.toContain('reloadAsync');
    expect(await storage.get(UPDATE_CHECK_KEY)).toBe(String(T0));
  });

  it('asks again only after a while, whatever the last answer was', async () => {
    const { api, calls } = fakeUpdates({ available: false });
    const storage = new MemoryStorage();
    expect(await fetchUpdateQuietly({ updates: api, storage, now: () => T0 })).toBe('none');
    expect(await fetchUpdateQuietly({ updates: api, storage, now: () => T0 + UPDATE_EVERY_MS - 1 })).toBe('recent');
    expect(await fetchUpdateQuietly({ updates: api, storage, now: () => T0 + UPDATE_EVERY_MS })).toBe('none');
    expect(calls).toEqual(['check', 'check']);
    // A clock set back (or a stored value it can't read) is no reason to wait.
    expect(await fetchUpdateQuietly({ updates: api, storage, now: () => T0 - 1 })).toBe('none');
    await storage.set(UPDATE_CHECK_KEY, 'soon');
    expect(await fetchUpdateQuietly({ updates: api, storage, now: () => T0 })).toBe('none');
  });

  it('does nothing where updates are off (a development build, a fork without an update server)', async () => {
    const { api, calls } = fakeUpdates({ isEnabled: false });
    expect(await fetchUpdateQuietly({ updates: api, storage: new MemoryStorage(), now: () => T0 })).toBe('off');
    expect(calls).toEqual([]);
  });

  it('starts no download once the system ended the background time', async () => {
    const { api, calls } = fakeUpdates();
    const ended = new AbortController();
    ended.abort();
    expect(await fetchUpdateQuietly({ updates: api, storage: new MemoryStorage(), now: () => T0, signal: ended.signal })).toBe('expired');
    expect(calls).toEqual([]);
    const late = new AbortController();
    const slow = fakeUpdates({
      checkForUpdateAsync: async () => {
        late.abort();
        return { isAvailable: true };
      },
    });
    expect(await fetchUpdateQuietly({ updates: slow.api, storage: new MemoryStorage(), now: () => T0, signal: late.signal })).toBe('expired');
    expect(slow.calls).toEqual([]);
  });

  it('never throws: an update server that fails, a store that fails, a download that fails', async () => {
    const offline = fakeUpdates({
      checkForUpdateAsync: async () => {
        throw new Error('ERR_UPDATES_CHECK');
      },
    });
    const storage = new MemoryStorage();
    expect(await fetchUpdateQuietly({ updates: offline.api, storage, now: () => T0 })).toBe('failed');
    // A failed check is no answer: the next run asks again.
    expect(await storage.get(UPDATE_CHECK_KEY)).toBeNull();
    const broken = fakeUpdates({
      fetchUpdateAsync: async () => {
        throw new Error('ERR_UPDATES_FETCH');
      },
    });
    expect(await fetchUpdateQuietly({ updates: broken.api, storage: new MemoryStorage(), now: () => T0 })).toBe('failed');
    const disk = async (): Promise<never> => {
      throw new Error('disk');
    };
    const badStore = { get: disk, set: disk, remove: disk };
    expect(await fetchUpdateQuietly({ updates: fakeUpdates().api, storage: badStore, now: () => T0 })).toBe('fetched');
    const odd = fakeUpdates({ checkForUpdateAsync: async () => null as unknown as { isAvailable: boolean } });
    expect(await fetchUpdateQuietly({ updates: odd.api, storage: new MemoryStorage(), now: () => T0 })).toBe('none');
  });
});
