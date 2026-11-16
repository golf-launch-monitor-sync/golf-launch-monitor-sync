// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Where a client keeps what must outlive a restart (the guard's counts and log, the cursor of a
 * file target): text under a key. Each client brings its own (chrome.storage in the extension,
 * AsyncStorage in the companion app, localStorage in the web app); `MemoryStorage` is for tests and
 * for a run that keeps nothing.
 *
 * Keep provider sign-ins and import tokens out of it: they belong in the platform's secure store.
 */

export interface Storage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class MemoryStorage implements Storage {
  readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key);
  }
}

/** JSON under a key; null when there is none. Throws on a storage that fails (the caller decides). */
export async function readJson(storage: Storage, key: string): Promise<unknown> {
  const raw = await storage.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined; // there, but unreadable
  }
}
