// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The test sign-ins kept for apps that only ask this one to sign in (spec 1.28.0, spec/test-mode.md *Only signing in
 * for a target*): per pairing, what the tester confirmed - the asking app's test code, the scenario's made-up account,
 * the test's end, how long each handed-over sign-in lasts, this phone's browser. Handed over again with a new end at
 * every question while the test lasts (lib/handover.ts).
 *
 * The code is the target's secret (spec: like a pairing code), so it lies in the secure store, beside the pairings'
 * tokens; ordinary storage keeps only which pairings have one. Gone when the test is over, the pairing goes or the
 * tester ends it. Nothing here fetches: the asking app plays the scenario back itself.
 */

import { base64url, readJson, sha256, utf8, type Storage } from '@glmsync/core';
import type { Secrets } from '@glmsync/engine';
import { instantMs, TEST_CODE } from '@glmsync/spec';
import type { TestHeld } from './handover';

const INDEX = 'glmsync/companion/test-signins';
/** A pairing's key holds a URL; the secure store takes only plain names. */
const slot = (key: string) => `glmsync.testsignin.${base64url(sha256(utf8(key))).slice(0, 32)}`;
const SUBJECT = /^[\x21-\x7e]{1,200}$/;
const USER_AGENT = /^[\x20-\x7e]{1,512}$/;

function readHeld(raw: string | null): TestHeld | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TestHeld>;
    return valid(v) ? held(v) : null;
  } catch {
    return null;
  }
}

function valid(v: Partial<TestHeld>): v is TestHeld {
  return (
    typeof v.code === 'string' &&
    TEST_CODE.test(v.code) &&
    typeof v.subject === 'string' &&
    SUBJECT.test(v.subject) &&
    typeof v.userAgent === 'string' &&
    USER_AGENT.test(v.userAgent) &&
    instantMs(v.validUntil) !== null &&
    (v.signinValidS === undefined || (typeof v.signinValidS === 'number' && Number.isInteger(v.signinValidS) && v.signinValidS > 0))
  );
}

/** Only the fields of a test sign-in, nothing else that came along. */
const held = (v: TestHeld): TestHeld => ({
  code: v.code,
  subject: v.subject,
  userAgent: v.userAgent,
  validUntil: v.validUntil,
  ...(v.signinValidS !== undefined ? { signinValidS: v.signinValidS } : {}),
});

export class TestSignIns {
  private readonly items = new Map<string, TestHeld>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(
    private readonly secrets: Secrets,
    private readonly storage: Storage,
    opts: { now?: () => number } = {},
  ) {
    this.now = opts.now ?? Date.now;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private tell() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // a listener's trouble is its own
      }
    }
  }

  private over(h: TestHeld, now = this.now()): boolean {
    const until = instantMs(h.validUntil);
    return until === null || now >= until;
  }

  /** Read what this phone keeps, for the pairings it still has; the rest (over, its pairing gone, broken) goes. Never throws. */
  async load(pairings: readonly string[]): Promise<void> {
    let keys: string[] = [];
    try {
      const index = await readJson(this.storage, INDEX);
      keys = Array.isArray(index) ? index.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      keys = [];
    }
    this.items.clear();
    for (const key of keys) {
      let h: TestHeld | null = null;
      try {
        h = readHeld(await this.secrets.get(slot(key)));
      } catch {
        h = null; // the secure store refused (a locked phone): as if none
      }
      if (h && pairings.includes(key) && !this.over(h)) this.items.set(key, h);
      else await this.drop(key);
    }
    await this.writeIndex().catch(() => undefined);
    this.tell();
  }

  /** The pairings that have one kept (over or not). */
  keys(): string[] {
    return [...this.items.keys()];
  }

  /** The pairing's test sign-in while its test lasts. */
  get(key: string): TestHeld | null {
    const h = this.items.get(key);
    return h && !this.over(h) ? h : null;
  }

  /** The tester confirmed the account: kept for the pairing. Throws when it isn't one or the phone won't keep it (then nothing is). */
  async set(key: string, value: TestHeld): Promise<void> {
    if (!valid(value)) throw new TypeError('Not a test sign-in.');
    const h = held(value);
    await this.secrets.set(slot(key), JSON.stringify(h));
    this.items.set(key, h);
    try {
      await this.writeIndex();
    } catch (e) {
      this.items.delete(key);
      await this.secrets.remove(slot(key)).catch(() => undefined);
      throw e;
    }
    this.tell();
  }

  /** The tester ended the test, or its pairing went: the code leaves this phone. Never throws. */
  async forget(key: string): Promise<void> {
    const had = this.items.delete(key);
    await this.drop(key);
    await this.writeIndex().catch(() => undefined);
    if (had) this.tell();
  }

  private async drop(key: string) {
    try {
      await this.secrets.remove(slot(key));
    } catch {
      // Left in the store, it is never read again without its line in the index.
    }
  }

  private async writeIndex() {
    await this.storage.set(INDEX, JSON.stringify([...this.items.keys()]));
  }
}
