// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode's keeping, for every client (spec/test-mode.md): a connected app's test scenario in place of the
 * provider, for one pairing. The tester enters the app's test code (or opens its link); the scenario comes from that
 * app with the pairing's import token, and after "Is this your account?" the pairing syncs from it as it would from
 * Trackman - the real provider code against the made-up Trackman (`replay`), at the plan's pace, through the guard,
 * every batch marked `test`. The companion app, the extension and the web app keep their tests here alike.
 *
 * Kept only until the tester ends it, the pairing ends or the scenario's `valid_until` has passed. The scenario can
 * be large (up to 64 MiB), so it lies in `Blobs` (a file of the companion app's own, IndexedDB in a browser), not in
 * storage or a secure store; it is made up and holds no sign-in. What a screen needs about it (its name, its account,
 * its end) is in storage.
 */

import { readJson, type Storage } from '@glmsync/core';
import { instantMs, readTestScenario, type TestScenario } from '@glmsync/spec';
import { replay, type Replay } from './replay.ts';

/** Large texts kept apart from storage (the companion's document folder, a browser's IndexedDB; memory in tests). */
export interface Blobs {
  get(name: string): Promise<string | null>;
  set(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

export class MemoryBlobs implements Blobs {
  readonly data = new Map<string, string>();
  async get(name: string) {
    return this.data.get(name) ?? null;
  }
  async set(name: string, text: string) {
    this.data.set(name, text);
  }
  async remove(name: string) {
    this.data.delete(name);
  }
}

/** What the screen shows of a pairing's test, without the scenario's data. */
export interface TestMode {
  /** The pairing's key. */
  key: string;
  /** The scenario's name, beside the badge. */
  name: string;
  /** The made-up account (the guard counts under it). */
  subject: string;
  /** The name "Is this your account?" showed. */
  player: string | null;
  valid_until: string;
  /** When the tester said yes (ms). */
  at: number;
}

/** The listing's key in storage, unless a client names its own (the companion's, kept so its tests stay where they are). */
const INDEX = 'glmsync/companion/tests';
/** A pairing's key is the client's own; whatever it holds is made safe for a file name. */
export const blobName = (key: string) => `glmsync-test-${key.replace(/[^A-Za-z0-9_-]/g, '_')}.json`;

function readIndex(v: unknown): TestMode[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (m): m is TestMode =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as TestMode).key === 'string' &&
      typeof (m as TestMode).name === 'string' &&
      typeof (m as TestMode).subject === 'string' &&
      typeof (m as TestMode).valid_until === 'string' &&
      typeof (m as TestMode).at === 'number' &&
      ((m as TestMode).player === null || typeof (m as TestMode).player === 'string'),
  );
}

export interface TestsOptions {
  now?: () => number;
  /** How the scenario's response times are waited for (the platform's, a virtual clock's in tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Where in storage the listing is kept. */
  index?: string;
}

export class Tests {
  private items: TestMode[] = [];
  /** The playback of each test, made once per runtime: it keeps the history's list between chunks. */
  private readonly playing = new Map<string, Replay>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(
    private readonly storage: Storage,
    private readonly blobs: Blobs,
    private readonly opts: TestsOptions = {},
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

  private over(m: TestMode, now = this.now()): boolean {
    const until = instantMs(m.valid_until);
    return until === null || now >= until;
  }

  /** Read what this device keeps; a test that is over goes (with its file). Never throws. */
  async load(): Promise<void> {
    let index: TestMode[] = [];
    try {
      index = readIndex(await readJson(this.storage, this.opts.index ?? INDEX));
    } catch {
      index = [];
    }
    this.items = index;
    for (const m of index.filter((x) => this.over(x))) await this.end(m.key);
    this.tell();
  }

  /** The pairing's test, while it lasts. */
  of(key: string): TestMode | null {
    const m = this.items.find((x) => x.key === key);
    return m && !this.over(m) ? m : null;
  }

  list(): readonly TestMode[] {
    return this.items.filter((m) => !this.over(m));
  }

  private replayOf(scenario: TestScenario): Replay {
    return replay(scenario, { now: this.now, ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}) });
  }

  /**
   * The playback for the pairing's test, or null when it has none - or none any more: over, its file gone or no
   * longer a scenario (then the test ends here, and the pairing goes on as without one). Never throws.
   */
  async provider(key: string): Promise<Replay | null> {
    const m = this.items.find((x) => x.key === key);
    if (!m) return null;
    if (this.over(m)) {
      await this.end(key);
      return null;
    }
    const cached = this.playing.get(key);
    if (cached) return cached;
    let text: string | null = null;
    try {
      text = await this.blobs.get(blobName(key));
    } catch {
      text = null;
    }
    let read: ReturnType<typeof readTestScenario> | null = null;
    try {
      read = text === null ? null : readTestScenario(JSON.parse(text), new Date(this.now()).toISOString());
    } catch {
      read = null;
    }
    if (!read?.ok || read.scenario.subject !== m.subject || read.scenario.provider !== 'trackman') {
      await this.end(key);
      return null;
    }
    const r = this.replayOf(read.scenario);
    this.playing.set(key, r);
    return r;
  }

  /**
   * The tester said yes: the pairing syncs from the scenario from now on. The file first, then the listing: a
   * listing without its file is never kept (`provider` ends it). Throws when the phone won't keep it.
   */
  async start(key: string, scenario: TestScenario, player: string | null): Promise<TestMode> {
    const r = this.replayOf(scenario); // throws for another provider's scenario, before anything is written
    await this.blobs.set(blobName(key), JSON.stringify(scenario));
    const m: TestMode = { key, name: scenario.name, subject: scenario.subject, player, valid_until: scenario.valid_until, at: this.now() };
    this.items = [...this.items.filter((x) => x.key !== key), m];
    try {
      await this.writeIndex();
    } catch (e) {
      this.items = this.items.filter((x) => x.key !== key);
      await this.blobs.remove(blobName(key)).catch(() => undefined);
      throw e;
    }
    this.playing.set(key, r);
    this.tell();
    return m;
  }

  /** The test ends (the tester signed out of it, the pairing ended, it is over): listing, playback and file go. */
  async end(key: string): Promise<void> {
    const had = this.items.some((x) => x.key === key);
    this.items = this.items.filter((x) => x.key !== key);
    this.playing.delete(key);
    if (had) {
      try {
        await this.writeIndex();
      } catch {
        // Gone from memory; a listing left behind finds no file at the next start and ends there.
      }
    }
    try {
      await this.blobs.remove(blobName(key));
    } catch {
      // A file left behind is never read again without its listing, and the next test's replaces it.
    }
    if (had) this.tell();
  }

  private async writeIndex() {
    await this.storage.set(this.opts.index ?? INDEX, JSON.stringify(this.items));
  }
}

