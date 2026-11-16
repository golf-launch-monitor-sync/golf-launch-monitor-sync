// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The web app's storage: this browser's localStorage for the project's own address, which no other
 * site can read. Holds what the extension keeps in its own storage: the guard's counts, the pairings,
 * and the Trackman key until it runs out. Private windows and switched-off storage keep it in memory
 * for as long as the page is open.
 */

import { MemoryStorage, type Storage } from '@glmsync/core';

export class PageStorage implements Storage {
  private readonly fallback = new MemoryStorage();

  private area(): globalThis.Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const a = this.area();
      return a ? a.getItem(key) : this.fallback.get(key);
    } catch {
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const a = this.area();
      if (a) a.setItem(key, value);
      else await this.fallback.set(key, value);
    } catch {
      await this.fallback.set(key, value); // full or switched off: kept for this page
    }
  }

  async remove(key: string): Promise<void> {
    try {
      this.area()?.removeItem(key);
    } catch {
      // nothing to remove
    }
    await this.fallback.remove(key);
  }
}
