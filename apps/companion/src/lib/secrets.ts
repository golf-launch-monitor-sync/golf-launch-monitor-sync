// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Where the app keeps what must not leak: a provider's sign-in and a target's import token. On the
 * phone that is the platform's secure store (Keychain, Keystore: `platform.ts`); here only the
 * interface and what sits on top of it, so the rules can be tested without a phone.
 *
 * The secure store takes keys of `[A-Za-z0-9._-]` only, and is meant for small values (Expo warns
 * past 2 KiB; a provider's token can be longer). `ChunkedSecrets` cuts a long value into pieces and
 * writes the piece count last, so a crash halfway leaves the old value or none - never half of one.
 */

export interface Secrets {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const SECRET_KEY = /^[A-Za-z0-9._-]{1,200}$/;

export class MemorySecrets implements Secrets {
  readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    check(key);
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    check(key);
    this.data.set(key, value);
  }

  async remove(key: string): Promise<void> {
    check(key);
    this.data.delete(key);
  }
}

function check(key: string) {
  if (!SECRET_KEY.test(key)) throw new Error(`Not a key the secure store takes: ${key}`);
}

/** Pieces larger than this go into parts of their own. */
export const CHUNK = 1800;
const MAX_PARTS = 64;

export class ChunkedSecrets implements Secrets {
  constructor(
    private readonly inner: Secrets,
    private readonly chunk = CHUNK,
  ) {}

  private part(key: string, i: number) {
    return `${key}.part${i}`;
  }

  /** How many parts a stored value has: 0 for one kept whole (or none). */
  private async parts(key: string): Promise<number> {
    const head = await this.inner.get(key);
    const m = head ? /^c:(\d{1,2})$/.exec(head) : null;
    return m ? Number(m[1]) : 0;
  }

  async get(key: string): Promise<string | null> {
    const head = await this.inner.get(key);
    if (head === null) return null;
    if (head.startsWith('v:')) return head.slice(2);
    const m = /^c:(\d{1,2})$/.exec(head);
    if (!m) return null; // something else there: as good as nothing
    const n = Number(m[1]);
    const pieces: string[] = [];
    for (let i = 0; i < n; i++) {
      const p = await this.inner.get(this.part(key, i));
      if (p === null) return null; // a part went missing: the value is gone, not guessed at
      pieces.push(p);
    }
    return pieces.join('');
  }

  async set(key: string, value: string): Promise<void> {
    const before = await this.parts(key);
    if (value.length + 2 <= this.chunk) {
      await this.inner.set(key, `v:${value}`);
    } else {
      const n = Math.ceil(value.length / this.chunk);
      if (n > MAX_PARTS) throw new Error('Too large for the secure store.');
      for (let i = 0; i < n; i++) await this.inner.set(this.part(key, i), value.slice(i * this.chunk, (i + 1) * this.chunk));
      // The head last: until it is written, a reader still finds the old value whole.
      await this.inner.set(key, `c:${n}`);
      for (let i = n; i < before; i++) await this.inner.remove(this.part(key, i));
      return;
    }
    for (let i = 0; i < before; i++) await this.inner.remove(this.part(key, i));
  }

  async remove(key: string): Promise<void> {
    const before = await this.parts(key);
    await this.inner.remove(key);
    for (let i = 0; i < before; i++) await this.inner.remove(this.part(key, i));
  }
}
