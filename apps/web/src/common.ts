// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** What the web app's syncing pages share: the client (kept in this browser's storage), and the texts. */

import { BrowserClient, IdbBlobs } from '@glmsync/browser';
import { PageStorage } from './storage.ts';

export { $, lang, t, texts } from './texts.ts';

declare const __VERSION__: string;

const storage = new PageStorage();
export const client = new BrowserClient({
  storage,
  vault: storage,
  kind: 'web',
  name: 'Golf Stats Sync web app',
  version: __VERSION__,
  // A test scenario (test mode) can be far larger than localStorage takes: IndexedDB of this address.
  blobs: new IdbBlobs(),
});

