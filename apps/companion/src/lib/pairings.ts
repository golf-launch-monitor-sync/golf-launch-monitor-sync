// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The targets this phone is paired with. What a pairing says about the target (its address, name,
 * limits, where a sync may jump back to) is kept in ordinary storage; its import token, which writes
 * into the player's account there, only in the secure store.
 *
 * One pairing per target and provider: pairing again replaces the old one (whose token the caller
 * revokes at the target).
 */

import { base64url, readJson, sha256, utf8, type Pairing, type Storage } from '@glmsync/core';
import type { Secrets } from './secrets.ts';

export type StoredPairing = Omit<Pairing, 'token'> & { key: string };
export type KeyedPairing = Pairing & { key: string };

const INDEX = 'glmsync/companion/pairings';
const tokenSlot = (key: string) => `glmsync.pairing.${key}`;
const MAX_PAIRINGS = 20;

/** A short, stable name for a target and provider, usable as a secure-store key. */
export function pairingKey(base: string, provider: string): string {
  return base64url(sha256(utf8(`${base.replace(/\/+$/, '')}|${provider}`))).slice(0, 22);
}

function readIndex(v: unknown): StoredPairing[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (p): p is StoredPairing =>
      !!p &&
      typeof p === 'object' &&
      typeof (p as StoredPairing).key === 'string' &&
      typeof (p as StoredPairing).base === 'string' &&
      typeof (p as StoredPairing).provider === 'string' &&
      typeof (p as StoredPairing).account_salt === 'string' &&
      !!(p as StoredPairing).target &&
      typeof (p as StoredPairing).target.name === 'string' &&
      Array.isArray((p as StoredPairing).target.return_prefixes) &&
      !!(p as StoredPairing).limits,
  );
}

export class Pairings {
  private items: KeyedPairing[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly secrets: Secrets,
    private readonly storage: Storage,
  ) {}

  /** Read the pairings; one whose token is gone from the secure store is dropped. */
  async load(): Promise<void> {
    const index = readIndex(await readJson(this.storage, INDEX));
    const out: KeyedPairing[] = [];
    for (const p of index) {
      let token: string | null = null;
      try {
        token = await this.secrets.get(tokenSlot(p.key));
      } catch {
        token = null;
      }
      if (token) out.push({ ...p, token });
    }
    this.items = out;
    if (out.length !== index.length) await this.writeIndex();
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

  list(): readonly KeyedPairing[] {
    return this.items;
  }

  get(key: string): KeyedPairing | null {
    return this.items.find((p) => p.key === key) ?? null;
  }

  /** The pairings of a target address (any provider). */
  ofTarget(base: string): KeyedPairing[] {
    const b = base.replace(/\/+$/, '');
    return this.items.filter((p) => p.base.replace(/\/+$/, '') === b);
  }

  usesProvider(provider: string): boolean {
    return this.items.some((p) => p.provider === provider);
  }

  private async writeIndex() {
    const index: StoredPairing[] = this.items.map(({ token: _, ...rest }) => rest);
    await this.storage.set(INDEX, JSON.stringify(index));
  }

  /**
   * Keep a new pairing; the one it replaces (same target and provider) is returned so its token can
   * be revoked. The token goes into the secure store first: a pairing without one is never listed.
   */
  async add(pairing: Pairing): Promise<{ added: KeyedPairing; replaced: KeyedPairing | null }> {
    const key = pairingKey(pairing.base, pairing.provider);
    const replaced = this.get(key);
    if (!replaced && this.items.length >= MAX_PAIRINGS) throw new Error('Too many pairings on this phone.');
    await this.secrets.set(tokenSlot(key), pairing.token);
    const added: KeyedPairing = { ...pairing, key };
    this.items = [...this.items.filter((p) => p.key !== key), added];
    await this.writeIndex();
    this.tell();
    return { added, replaced };
  }

  /** Remember what the target bound the pairing to (its `account_ref`), once it says. */
  async bind(key: string, accountRef: string): Promise<void> {
    const p = this.get(key);
    if (!p || p.account_ref === accountRef) return;
    this.items = this.items.map((x) => (x.key === key ? { ...x, account_ref: accountRef } : x));
    await this.writeIndex();
    this.tell();
  }

  async remove(key: string): Promise<void> {
    this.items = this.items.filter((p) => p.key !== key);
    // The listing first: should removing the token fail, the pairing is gone all the same, and a
    // token left behind is never read again (only listed pairings are), and overwritten by a new one.
    await this.writeIndex();
    this.tell();
    try {
      await this.secrets.remove(tokenSlot(key));
    } catch {
      // see above
    }
  }
}
