// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Large texts in the browser: a test scenario (spec/test-mode.md) can be up to 64 MiB, far more than the extension's
 * storage or a page's localStorage takes, so it lies in IndexedDB - of the extension's own origin, or of the web app's
 * address, which no other site can read. It is made up and holds no sign-in.
 *
 * Every failure is thrown (no IndexedDB in this window, the disk full, a database another version left): the caller
 * says it couldn't keep the test, rather than starting one whose data is silently gone at the next start.
 */

import type { Blobs } from '@glmsync/provider-trackman';

const DB = 'glmsync';
const STORE = 'blobs';

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed.'));
  });
}

export class IdbBlobs implements Blobs {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly name = DB) {}

  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise<IDBDatabase>((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
          if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB here.');
          req = indexedDB.open(this.name, 1);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        };
        req.onsuccess = () => {
          const db = req.result;
          // Another tab of a newer version wants the database: let it, and open afresh next time.
          db.onversionchange = () => {
            db.close();
            this.db = null;
          };
          resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened.'));
        req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab.'));
      });
      // A failed open is tried again next time (the window may allow it later).
      this.db.catch(() => {
        this.db = null;
      });
    }
    return this.db;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    const result = done(fn(tx.objectStore(STORE)));
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted (full?).'));
    });
    const [value] = await Promise.all([result, finished]);
    return value;
  }

  async get(name: string): Promise<string | null> {
    const v = await this.run('readonly', (s) => s.get(name) as IDBRequest<unknown>);
    return typeof v === 'string' ? v : null;
  }

  async set(name: string, text: string): Promise<void> {
    await this.run('readwrite', (s) => s.put(text, name));
  }

  async remove(name: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(name));
  }
}
