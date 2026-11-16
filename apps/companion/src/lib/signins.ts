// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The player's sign-in at each provider - on this phone, and nowhere else.
 *
 * A sign-in is kept in the secure store for as long as the provider's own key lasts (Trackman's
 * about a week) and goes only to the provider; no target and no server of this project ever sees it.
 * When it runs out, or the provider rejects it, the key goes - nothing is kept that could renew it
 * on its own: no password, no refresh token, no cookie of ours.
 *
 * Next to it a mark says this phone held a key for this provider before, and of which account
 * (`had`). Only then may the app try to renew an expired key quietly, in a hidden sign-in window
 * (the provider's own page with the cookies it left on this phone), and only a key of that same
 * account is taken from it: on a phone where someone else is signed in to the provider, the window
 * would otherwise bring their key. Taking the sign-in away ("forget") removes the mark as well.
 *
 * The port of the Birdie Box Caddie's `session.ts`, without its per-user slots: this app holds one
 * player's sign-ins.
 */

import { PROVIDER_ID } from '@glmsync/core';
import type { Secrets } from './secrets.ts';

export interface SignIn {
  token: string;
  /** The provider account's stable id (Trackman: the token's `sub`), null if it has none. */
  subject: string | null;
  /** The name the provider gave for "Is this you?", shown in the app. */
  player: string | null;
  /** When the player signed in or the key was renewed (ms). */
  at: number;
}

export interface Had {
  subject: string | null;
}

export interface ProviderKeys {
  subject(provider: string, token: string): string | null;
  /** When a key runs out (ms); null: it doesn't say (then the provider's first refusal tells). */
  expiresAt(provider: string, token: string): number | null;
}

/** A minute of slack, so a sync doesn't start on a key that dies halfway through. */
export const SLACK_MS = 60_000;

const slot = (p: string) => `glmsync.signin.${p}`;
const mark = (p: string) => `glmsync.had.${p}`;

function readSignIn(raw: string | null): SignIn | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<SignIn>;
    if (typeof v.token !== 'string' || !v.token) return null;
    return {
      token: v.token,
      subject: typeof v.subject === 'string' ? v.subject : null,
      player: typeof v.player === 'string' ? v.player : null,
      at: typeof v.at === 'number' ? v.at : 0,
    };
  } catch {
    return null;
  }
}

function readHad(raw: string | null): Had | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Had>;
    return { subject: typeof v.subject === 'string' ? v.subject : null };
  } catch {
    return null;
  }
}

export class SignIns {
  private readonly items = new Map<string, SignIn>();
  private readonly marks = new Map<string, Had>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;

  constructor(
    private readonly secrets: Secrets,
    private readonly keys: ProviderKeys,
    readonly providers: readonly string[],
    opts: { now?: () => number } = {},
  ) {
    for (const p of providers) if (!PROVIDER_ID.test(p)) throw new Error(`Not a provider id: ${p}`);
    this.now = opts.now ?? Date.now;
  }

  /** Read what this phone keeps; a key that ran out while the app was closed is dropped (its mark stays). */
  async load(): Promise<void> {
    for (const p of this.providers) {
      let item: SignIn | null = null;
      let had: Had | null = null;
      try {
        item = readSignIn(await this.secrets.get(slot(p)));
        had = readHad(await this.secrets.get(mark(p)));
      } catch {
        // The secure store refused (locked phone, a broken entry): as if signed out.
      }
      this.items.delete(p);
      this.marks.delete(p);
      if (had) this.marks.set(p, had);
      if (item) {
        this.items.set(p, item);
        if (!had) this.marks.set(p, { subject: item.subject });
        if (!this.valid(p)) await this.expire(p);
      }
    }
    this.tell();
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

  get(provider: string): SignIn | null {
    return this.items.get(provider) ?? null;
  }

  /** Whether there is a key that should still work (with a minute to spare). */
  valid(provider: string, now = this.now()): boolean {
    const item = this.items.get(provider);
    if (!item) return false;
    const exp = this.keys.expiresAt(provider, item.token);
    return exp === null || exp > now + SLACK_MS;
  }

  /** The key, if it should still work. */
  credential(provider: string): string | null {
    return this.valid(provider) ? (this.items.get(provider)?.token ?? null) : null;
  }

  /** This phone held a key for the provider before: the account it was of. */
  had(provider: string): Had | null {
    return this.marks.get(provider) ?? null;
  }

  /** Whether a quiet renewal may be tried: a key held before, none that works now. */
  canRenew(provider: string): boolean {
    return !!this.marks.get(provider) && !this.valid(provider);
  }

  /**
   * Whether a key from a quiet renewal may be taken: only one of the account this phone held, and
   * only when that account is known (a key without a subject can't be told apart from someone else's).
   */
  renewalFits(provider: string, token: string): boolean {
    const had = this.marks.get(provider);
    const subject = this.keys.subject(provider, token);
    return !!had && !!had.subject && subject === had.subject;
  }

  /** A new or renewed key. Throws when the secure store won't take it (then nothing was kept). */
  async set(provider: string, token: string, player: string | null = null): Promise<SignIn> {
    if (!this.providers.includes(provider)) throw new Error(`Not a provider of this app: ${provider}`);
    const subject = this.keys.subject(provider, token);
    const before = this.items.get(provider);
    const item: SignIn = {
      token,
      subject,
      // A renewal keeps the name the player confirmed, as long as it is the same account.
      player: player ?? (before && before.subject === subject ? before.player : null),
      at: this.now(),
    };
    await this.secrets.set(slot(provider), JSON.stringify(item));
    await this.secrets.set(mark(provider), JSON.stringify({ subject } satisfies Had));
    this.items.set(provider, item);
    this.marks.set(provider, { subject });
    this.tell();
    return item;
  }

  /** The key ran out or was rejected: it goes; the mark stays, so it may be renewed quietly. */
  async expire(provider: string): Promise<void> {
    this.items.delete(provider);
    try {
      await this.secrets.remove(slot(provider));
    } catch {
      // Gone from memory; a key left in the store is dropped again at the next load (it ran out).
    }
    this.tell();
  }

  /** The player took the sign-in away (or the last target using it disconnected): key and mark go. */
  async forget(provider: string): Promise<void> {
    this.items.delete(provider);
    this.marks.delete(provider);
    // Both removals are tried even if one fails: "forget" must not leave the key behind.
    const results = await Promise.allSettled([this.secrets.remove(slot(provider)), this.secrets.remove(mark(provider))]);
    this.tell();
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw (failed as PromiseRejectedResult).reason;
  }
}
