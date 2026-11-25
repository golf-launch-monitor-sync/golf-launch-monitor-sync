// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages on the phone (spec/prores.md): the extension's `ProClient`, kept in what the phone has -
 * the pairings with their import tokens in the secure store, what each target last answered, the open question and the
 * fingerprints of pages said to be the player's in ordinary storage. The app's world ranking window (RankingsView)
 * hands it the page the player tapped *Send* on.
 *
 * Nothing here runs in the background: a page is read only while the player has it open in the window, on their tap.
 */

import type { FetchLike, Storage } from '@glmsync/core';
import { ProClient } from '@glmsync/browser/pro';
import { keptPage } from './rankingsPage.ts';
import { SlotSecrets } from './hcp.ts';
import type { Secrets } from './secrets.ts';

/** How the app names itself to a target of a pro's pages (the target lists it among the player's tools). */
export function proClientName(os: string | undefined): string {
  return os === 'ios' ? 'Golf Stats Sync for iPhone' : os === 'android' ? 'Golf Stats Sync for Android' : 'Golf Stats Sync';
}

export function makePro(opts: {
  storage: Storage;
  /** The secure store (already chunked: the pairings of several targets can outgrow one entry). */
  secrets: Secrets;
  os?: string;
  version?: string;
  fetch?: FetchLike;
  now?: () => number;
}): ProClient {
  return new ProClient({
    storage: opts.storage,
    vault: new SlotSecrets(opts.secrets),
    kind: 'companion',
    name: proClientName(opts.os),
    version: opts.version ?? '0.0.0',
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
}

const LAST_PAGE = 'glmsync/pro/lastPage';

/**
 * The player's own page, last sent from this phone: the window opens there next time instead of the site's search. Only
 * an address of a player's page is kept, only on this phone, and it goes when the player disconnects the last app for
 * a pro's pages here.
 */
export class LastPage {
  constructor(private readonly storage: Storage) {}

  async get(): Promise<string | null> {
    try {
      return keptPage(await this.storage.get(LAST_PAGE));
    } catch {
      return null; // unreadable: the window starts at the site's search
    }
  }

  async set(url: string): Promise<void> {
    const kept = keptPage(url);
    if (kept) await this.storage.set(LAST_PAGE, kept);
  }

  async clear(): Promise<void> {
    await this.storage.remove(LAST_PAGE);
  }
}
