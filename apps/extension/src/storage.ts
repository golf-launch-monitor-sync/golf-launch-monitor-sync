// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's storage for @glmsync/core: `chrome.storage.local`, which only the extension itself
 * can read - no web page, not even the portal's. It keeps the guard's counts and log, what the
 * targets said, and (the vault) the import tokens and the Trackman key until it runs out.
 */

import type { Storage } from '@glmsync/core';

export class ExtensionStorage implements Storage {
  constructor(private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}

  async get(key: string): Promise<string | null> {
    const got = await this.area.get(key);
    const v = got[key];
    return typeof v === 'string' ? v : null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.area.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await this.area.remove(key);
  }
}
