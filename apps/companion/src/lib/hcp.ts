// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap record on the phone (spec/hcp.md, *A client that only observes*): the extension's `HcpClient`, kept in
 * what the phone has - the pairings with their import tokens in the secure store, what golf.de's pages showed in
 * ordinary storage, and which golf.de account the pages named only in memory (gone when the app ends, as a browser
 * session is). The app's golf.de window (GolfdeView) hands it what the page script saw; `HcpSender` sends a little
 * after the last new page, as the extension does.
 *
 * Nothing here runs in the background: the record is read only while the player has golf.de open in the window.
 */

import { MemoryStorage, type FetchLike, type Storage } from '@glmsync/core';
import { HcpClient, SEND_AFTER_MS, type HcpView } from '@glmsync/browser/hcp';
import { SECRET_KEY, type Secrets } from '@glmsync/engine';

/**
 * HcpClient names its slots like paths (`glmsync/hcp/pairings`); the secure store takes `[A-Za-z0-9._-]` only. Each
 * slot keeps its own name with `/` written as `.`, and anything else the store wouldn't take is refused, not guessed.
 */
export class SlotSecrets implements Storage {
  constructor(private readonly inner: Secrets) {}

  private slot(key: string): string {
    const s = key.replace(/\//g, '.');
    if (!SECRET_KEY.test(s)) throw new Error(`Not a key the secure store takes: ${key}`);
    return s;
  }

  get(key: string): Promise<string | null> {
    return this.inner.get(this.slot(key));
  }

  set(key: string, value: string): Promise<void> {
    return this.inner.set(this.slot(key), value);
  }

  remove(key: string): Promise<void> {
    return this.inner.remove(this.slot(key));
  }
}

/** How the app names itself to a handicap target (the target lists it among the player's tools). */
export function hcpClientName(os: string | undefined): string {
  return os === 'ios' ? 'Golf Stats Sync for iPhone' : os === 'android' ? 'Golf Stats Sync for Android' : 'Golf Stats Sync';
}

export function makeHcp(opts: {
  storage: Storage;
  /** The secure store (already chunked: the pairings of several targets can outgrow one entry). */
  secrets: Secrets;
  os?: string;
  version?: string;
  fetch?: FetchLike;
  now?: () => number;
}): HcpClient {
  return new HcpClient({
    storage: opts.storage,
    vault: new SlotSecrets(opts.secrets),
    session: new MemoryStorage(),
    kind: 'companion',
    name: hcpClientName(opts.os),
    version: opts.version ?? '0.0.0',
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
}

/**
 * Whether something waits to go by itself: new results, sending by itself on, and a target of this account - not while
 * a run of *Fetch all* goes on (it sends once at its end).
 */
export function sendDue(v: HcpView): boolean {
  return v.fetch_all !== 'running' && v.auto && v.fresh > 0 && v.pairings.some((p) => !p.other_account);
}

type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

/**
 * Sends a little after the last new page (a few pages make one import at the target, which keeps 50 a day), and at
 * once when the player leaves golf.de or the app goes to the back - there a timer may never fire (iOS stops the app).
 * A send's failure is the client's state to show (HcpClient never throws for it); anything else is swallowed here,
 * so a timer never ends in an unhandled rejection.
 */
export class HcpSender {
  private handle: unknown = null;
  private readonly listeners = new Set<(v: HcpView) => void>();

  constructor(
    private readonly hcp: Pick<HcpClient, 'send'>,
    private readonly timers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    private readonly afterMs = SEND_AFTER_MS,
  ) {}

  /** Hears every view a send of this sender brought. */
  subscribe(fn: (v: HcpView) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** A view after something was seen: each new page moves the moment on. */
  seen(v: HcpView): void {
    if (!sendDue(v)) return;
    this.cancel();
    this.handle = this.timers.set(() => {
      this.handle = null;
      void this.run();
    }, this.afterMs);
  }

  /** Whether a send waits for its moment. */
  get waiting(): boolean {
    return this.handle !== null;
  }

  /** Now rather than later, if a send was waiting. */
  async flush(): Promise<HcpView | null> {
    if (this.handle === null) return null;
    this.cancel();
    return this.run();
  }

  /** The player says send: at once, waiting or not. */
  now(): Promise<HcpView | null> {
    this.cancel();
    return this.run();
  }

  cancel(): void {
    if (this.handle !== null) this.timers.clear(this.handle);
    this.handle = null;
  }

  private async run(): Promise<HcpView | null> {
    try {
      const v = await this.hcp.send();
      for (const fn of this.listeners) {
        try {
          fn(v);
        } catch {
          // a listener's trouble is its own
        }
      }
      return v;
    } catch {
      return null;
    }
  }
}
