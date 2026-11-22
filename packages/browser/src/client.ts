// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The browser clients' common part (the extension's background and the web app's page): the
 * player's provider key, the targets they paired with, "Is this you?", and the syncs - each one
 * the target's plan first, then the provider through the load guard (@glmsync/core).
 *
 * What it keeps:
 * - in the **vault** (the extension's own storage, the page's localStorage): the import tokens of
 *   the pairings and the provider key. Neither ever leaves for anywhere but where it belongs: an
 *   import token goes to its target, the key to the provider (core and the provider module see to
 *   that, and their tests check it).
 * - in **storage**: the guard's counts and log, what each target last answered, which provider
 *   accounts the player said were theirs - nothing of the key, nothing of the data.
 * - in **blobs** (IndexedDB): a test scenario of a paired app while its test lasts (test mode, spec/test-mode.md):
 *   made up, and for that pairing only - the provider key and the other pairings go on as before.
 *
 * Every method is serialised: an alarm, a click and a key from the portal never run into each other.
 * Nothing here throws at the caller for something that can happen (a target down, a key run out);
 * that is a state to show.
 */

import {
  accountRefOf,
  base64url,
  FileTarget,
  Guard,
  guardAccount,
  GuardLimitError,
  HttpTarget,
  pair,
  ProviderAuthError,
  providerContext,
  sha256,
  sync,
  TargetError,
  utf8,
  type FetchLike,
  type FileOut,
  type GuardCounts,
  type GuardLogExport,
  type ImportResult,
  type Notice,
  type Pairing,
  type Storage,
  type SyncOutcome,
} from '@glmsync/core';
import { FORMAT, parseLink, parsePairFragment, readTestScenario, TEST_CODE, type Batch, type Reason, type SignIn, type TestScenario } from '@glmsync/spec';
import { MemoryBlobs, replay, subjectOf, Tests, trackman, type Blobs, type Replay, type TrackmanProvider, type Who } from '@glmsync/provider-trackman';
import { liveUntil } from '@glmsync/provider-trackman/portal';

export type ClientKind = 'extension' | 'web';

export interface ClientOptions {
  storage: Storage;
  vault: Storage;
  kind: ClientKind;
  /** Shown to a target at pairing, e.g. "Golf Stats Sync for Chrome and Edge". */
  name: string;
  version: string;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  provider?: TrackmanProvider;
  /** Where a test scenario is kept (IndexedDB in the browser; memory when none is given). */
  blobs?: Blobs;
}

/** What a target last answered, kept per pairing (no token here). */
export interface Last {
  at: string;
  reason: Reason;
  status: SyncOutcome['status'] | 'told_expired';
  result?: ImportResult;
  notice?: Notice;
  /** For `failed`: what went wrong (a target's error code, or `error`). */
  error?: string;
  more?: boolean;
}

export interface Entry {
  id: string;
  base: string;
  name: string;
  provider: string;
  paired_at: string;
  /** The provider account the target has connected, as it said at pairing or in a plan. */
  account_ref?: string;
  last?: Last;
  last_synced_at?: string;
  /** The older history: done, or when its next chunk may be asked for (ms). */
  history?: { done?: boolean; next_at?: number };
  other_account?: boolean;
  /** The `exp` (ms) of the key whose running out this target was told about. */
  told_expired?: number;
  /** What this target took from here since pairing, all syncs together (the wizard's "10 sessions, 6 rounds"). */
  brought?: { sessions: number; rounds: number; shots: number };
  /** Sessions of the older history still to come, as the last history chunk's provider could tell. */
  left?: number;
}

export type KeyState =
  | { state: 'none' }
  /** Ran out, or the provider refused it: the player signs in again. */
  | { state: 'expired'; until: number | null }
  /** A first key of this account: "Is this you?" (`who` null when it couldn't be asked yet). */
  | { state: 'confirm'; until: number; who: Who | null; error?: 'unavailable' | 'guard' }
  /** Another account than the one a target has connected. */
  | { state: 'other'; until: number }
  | { state: 'ready'; until: number };

/** A pairing's test while it lasts (spec/test-mode.md): what its card shows. */
export interface TestState {
  /** The scenario's name. */
  name: string;
  /** Whose made-up account "Is this your account?" showed. */
  player: string | null;
  valid_until: string;
  /** When the tester said yes (ms). */
  at: number;
  /** The guard's counts under the scenario's own account (each code a fresh guard). */
  counts: GuardCounts | null;
}

/** A test code fetched for a pairing, waiting for "Is this your account?"; nothing synced before the yes. */
export interface TestAsking {
  id: string;
  /** The target app's name. */
  target: string;
  /** The scenario's name. */
  name: string;
  who: Who;
  valid_until: string;
  at: number;
}

/**
 * What a test code brought: `code` not one / not the app's; `unpaired` no pairing (for that target); `which` several
 * pairings and none picked; then the target's answers (spec/test-mode.md) and the client's own trouble.
 */
export type TestError =
  | 'code'
  | 'unpaired'
  | 'which'
  | 'unavailable'
  | 'not_test_account'
  | 'expired'
  | 'rate_limited'
  | 'unreachable'
  | 'revoked'
  | 'provider'
  | 'answer'
  | 'not_kept'
  | 'gone';

export type TestOutcome = { ok: true; id: string } | { ok: false; error: TestError };

export interface Farewell {
  name: string;
  at: string;
  why: 'disconnected' | 'revoked';
}

export interface ClientStatus {
  kind: ClientKind;
  provider: { id: string; name: string; notice?: string };
  key: KeyState;
  /** The player said no to "Is this you?" for an account here (another may be signed in to the portal). */
  rejected: boolean;
  pairings: (Entry & { host: string; signin: SignIn; test?: TestState })[];
  /** A test code fetched, waiting for the tester's yes. */
  testAsking: TestAsking | null;
  /** Pairings a sync runs for right now. */
  running: string[];
  /** Connections the target app ended since the player last looked. */
  ended: Farewell[];
  counts: GuardCounts | null;
  /** What the icon should say: sign in, answer "Is this you?", or nothing. */
  attention: 'sign_in' | 'confirm' | 'other_account' | null;
}

export type PairOutcome =
  | { ok: true; id: string; name: string; replaced: boolean }
  | { ok: false; error: 'link' | 'provider' | 'code' | 'unreachable' | 'refused' | 'rate_limited' | 'answer' };

export type KeyOutcome =
  /** Not a key that can be used (unreadable, or ran out already). */
  | { ok: false; error: 'invalid' | 'expired' | 'rejected' }
  /**
   * `changed`: a new key; `ready`: syncs may run with it (start one with reason `connect`); `asking`: "Is
   * this you?" is now open for an account it wasn't open for before - also when it was open for another.
   */
  | { ok: true; changed: boolean; ready: boolean; asking: boolean };

export interface RunReport {
  outcomes: { id: string; name: string; outcome: SyncOutcome | { status: 'skipped'; why: string } | { status: 'told_expired' } }[];
}

const PAIRINGS = 'glmsync/pairings';
const ENTRIES = 'glmsync/entries';
const ENDED = 'glmsync/ended';
const KEY = 'glmsync/key/';
const CONFIRMED = 'glmsync/confirmed/';
const REJECTED = 'glmsync/rejected/';
const WHO = 'glmsync/who/';
const TESTS = 'glmsync/tests';
const TEST_ASKING = 'glmsync/test-asking';
/** Pairing ids are 16 base64url characters: this never names a pairing's own file. */
const TEST_ASKING_BLOB = 'glmsync-test-asking.json';

/** A history chunk that brought something: the next one is asked about after this long. */
const BACKFILL_STEP_MS = 60_000;
/** A target that couldn't be reached: its history waits this long before it is asked again. */
const BACKFILL_RETRY_MS = 15 * 60_000;
const MAX_FAREWELLS = 5;

async function readList<T>(s: Storage, key: string): Promise<T[]> {
  try {
    const raw = await s.get(key);
    const v = raw === null ? [] : (JSON.parse(raw) as unknown);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return []; // unreadable: start afresh rather than stop working
  }
}

const hostOf = (base: string) => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

/**
 * What the tester typed into *Enter a test code*: the code (spaces taken out), or the test link the app's page shows
 * (`glmsync://test?…`, which a browser can't open but a tester can copy) - its target then picks the pairing.
 */
export function readTestInput(typed: unknown): { code: string; target?: string } | null {
  if (typeof typed !== 'string') return null;
  const s = typed.trim();
  if (/^glmsync:/i.test(s)) {
    const r = parseLink(s);
    if (!r.ok || r.action !== 'test') return null;
    return r.target ? { code: r.code, target: r.target } : { code: r.code };
  }
  const code = s.replace(/\s+/g, '');
  return TEST_CODE.test(code) ? { code } : null;
}

/** A pairing's id: stable per target address, so pairing again replaces it. */
export function pairingId(base: string): string {
  return base64url(sha256(utf8(`glmsync-pairing|${base.replace(/\/+$/, '')}`))).slice(0, 16);
}

export class BrowserClient {
  readonly guard: Guard;
  readonly provider: TrackmanProvider;
  /** Test mode's scenarios, per pairing (spec/test-mode.md). */
  readonly tests: Tests;
  private readonly blobs: Blobs;
  private testsLoaded: Promise<void> | null = null;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  /** Pairings a sync runs for right now (in memory: a run ends with the background that ran it). */
  private readonly active = new Set<string>();

  constructor(private readonly opts: ClientOptions) {
    this.now = opts.now ?? Date.now;
    this.provider = opts.provider ?? trackman();
    this.guard = new Guard({
      storage: opts.storage,
      now: this.now,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
      ...(opts.random ? { random: opts.random } : {}),
    });
    this.blobs = opts.blobs ?? new MemoryBlobs();
    this.tests = new Tests(opts.storage, this.blobs, { now: this.now, index: TESTS, ...(opts.sleep ? { sleep: opts.sleep } : {}) });
  }

  /** The tests kept here, read once per runtime (a test that is over goes then). */
  private async testsReady(): Promise<void> {
    this.testsLoaded ??= this.tests.load();
    await this.testsLoaded;
  }

  /** The ids of the pairings in test mode now. */
  private async testing(): Promise<Set<string>> {
    await this.testsReady();
    return new Set(this.tests.list().map((m) => m.key));
  }

  /** One at a time: whatever comes in while something runs waits its turn. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // -------------------------------------------------------------------------
  // What is kept
  // -------------------------------------------------------------------------

  private async pairings(): Promise<Pairing[]> {
    return readList<Pairing>(this.opts.vault, PAIRINGS);
  }

  private async entries(): Promise<Entry[]> {
    return readList<Entry>(this.opts.storage, ENTRIES);
  }

  private async saveEntries(list: Entry[]): Promise<void> {
    await this.opts.storage.set(ENTRIES, JSON.stringify(list));
  }

  private async update(id: string, change: (e: Entry) => Entry): Promise<void> {
    const list = await this.entries();
    await this.saveEntries(list.map((e) => (e.id === id ? change(e) : e)));
  }

  private async key(): Promise<{ token: string; at: string; refused: boolean; hash?: string } | null> {
    try {
      const raw = await this.opts.vault.get(KEY + this.provider.id);
      const v = raw ? (JSON.parse(raw) as { token?: unknown; at?: unknown; refused?: unknown; hash?: unknown }) : null;
      if (!v || typeof v.token !== 'string' || !v.token) return null;
      return { token: v.token, at: String(v.at ?? ''), refused: v.refused === true, ...(typeof v.hash === 'string' ? { hash: v.hash } : {}) };
    } catch {
      return null;
    }
  }

  private async accounts(prefix: string): Promise<string[]> {
    return readList<string>(this.opts.storage, prefix + this.provider.id);
  }

  private async addAccount(prefix: string, account: string): Promise<void> {
    const list = (await this.accounts(prefix)).filter((a) => a !== account);
    await this.opts.storage.set(prefix + this.provider.id, JSON.stringify([...list, account].slice(-20)));
  }

  private async farewell(f: Farewell): Promise<void> {
    const list = await readList<Farewell>(this.opts.storage, ENDED);
    await this.opts.storage.set(ENDED, JSON.stringify([...list, f].slice(-MAX_FAREWELLS)));
  }

  /** Drop a pairing here (the target already ended it, or the player did). */
  private async forget(id: string): Promise<void> {
    await this.opts.vault.set(PAIRINGS, JSON.stringify((await this.pairings()).filter((p) => pairingId(p.base) !== id)));
    await this.saveEntries((await this.entries()).filter((e) => e.id !== id));
    // A test lasts only as long as its pairing.
    await this.testsReady();
    await this.tests.end(id);
    if ((await this.asking())?.id === id) await this.dropAsking();
  }

  // -------------------------------------------------------------------------
  // The key
  // -------------------------------------------------------------------------

  private refs(subject: string, pairings: Pairing[]): Map<string, string> {
    return new Map(pairings.map((p) => [pairingId(p.base), accountRefOf(p.account_salt, this.provider.id, subject)]));
  }

  private async keyState(): Promise<KeyState> {
    const key = await this.key();
    if (!key) return { state: 'none' };
    const subject = subjectOf(key.token);
    const until = liveUntil(key.token, this.now());
    if (!subject || until === null || key.refused) return { state: 'expired', until: null };
    const account = guardAccount(this.provider.id, subject);
    // A pairing in test mode syncs from its scenario: what it has connected says nothing about this key.
    const testing = await this.testing();
    const [pairings, entries] = [await this.pairings(), (await this.entries()).filter((e) => !testing.has(e.id))];
    const refs = this.refs(subject, pairings);
    const known = entries.filter((e) => e.account_ref);
    // The target has this account connected already: it is theirs, no need to ask.
    if (known.some((e) => refs.get(e.id) === e.account_ref)) return { state: 'ready', until };
    // Every target that knows an account knows another one.
    if (known.length && known.length === entries.length) return { state: 'other', until };
    if ((await this.accounts(CONFIRMED)).includes(account)) return { state: 'ready', until };
    let who: Who | null = null;
    let error: 'unavailable' | 'guard' | undefined;
    try {
      const raw = await this.opts.storage.get(WHO + this.provider.id);
      const stored = raw ? (JSON.parse(raw) as { account?: string; who?: Who; error?: 'unavailable' | 'guard' }) : null;
      if (stored?.account === account) {
        who = stored.who ?? null;
        error = stored.error;
      }
    } catch {
      // asked again below
    }
    return error ? { state: 'confirm', until, who, error } : { state: 'confirm', until, who };
  }

  /**
   * The provider refused this key: keep only what tells whose it was and when it ran out (no
   * signature, so it opens nothing), and a fingerprint, so the same key from the portal again is
   * not tried again.
   */
  private async markRefused(token: string): Promise<void> {
    const at = new Date(this.now()).toISOString();
    await this.opts.vault.set(KEY + this.provider.id, JSON.stringify({ token: expiredMark(token), at, refused: true, hash: fingerprint(token) }));
  }

  /** "Is this you?": the account's name, its number of activities and the newest - through the guard. */
  private async askWho(token: string, subject: string): Promise<void> {
    const account = guardAccount(this.provider.id, subject);
    let stored: { account: string; who?: Who; error?: 'unavailable' | 'guard' };
    try {
      await this.guard.beginRun(account);
      const ctx = providerContext({ guard: this.guard, account, reason: 'connect', now: this.now, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) });
      stored = { account, who: await this.provider.who(ctx, token) };
    } catch (e) {
      if (e instanceof ProviderAuthError) {
        await this.markRefused(token);
        throw e;
      }
      stored = { account, error: e instanceof GuardLimitError ? 'guard' : 'unavailable' };
    }
    await this.opts.storage.set(WHO + this.provider.id, JSON.stringify(stored));
  }

  /**
   * A key from the portal (the extension's content script) or pasted (the web app). The same key
   * again changes nothing and asks nobody - the portal hands it over on every page it loads.
   */
  setKey(token: string): Promise<KeyOutcome> {
    return this.serial(async () => {
      const t = typeof token === 'string' ? token.trim() : '';
      const subject = subjectOf(t);
      if (!subject) return { ok: false, error: 'invalid' } as const;
      if (liveUntil(t, this.now()) === null) return { ok: false, error: 'expired' } as const;
      const account = guardAccount(this.provider.id, subject);
      if ((await this.accounts(REJECTED)).includes(account)) return { ok: false, error: 'rejected' } as const;
      const had = await this.key();
      // The portal still holds a key Trackman refused: nothing to try with it.
      if (had?.refused && had.hash === fingerprint(t)) return { ok: false, error: 'expired' } as const;
      if (had?.token === t && !had.refused) {
        const s = await this.keyState();
        return { ok: true, changed: false, ready: s.state === 'ready', asking: false } as const;
      }
      const before = had ? subjectOf(had.token) : null;
      const wasAsking = (await this.keyState()).state === 'confirm';
      await this.opts.vault.set(KEY + this.provider.id, JSON.stringify({ token: t, at: new Date(this.now()).toISOString() }));
      let s = await this.keyState();
      if (s.state === 'confirm' && (before !== subject || !s.who)) {
        try {
          await this.askWho(t, subject);
        } catch (e) {
          if (e instanceof ProviderAuthError) return { ok: false, error: 'expired' } as const;
          throw e;
        }
        s = await this.keyState();
      }
      // A second account signed in while the first one's question was still open (the player switched
      // accounts in the portal tab): the question is a new one, and is put to the player again.
      const asking = s.state === 'confirm' && (!wasAsking || before !== subject);
      return { ok: true, changed: true, ready: s.state === 'ready', asking } as const;
    });
  }

  /** Ask "Is this you?" again (it couldn't be asked before). */
  retryWho(): Promise<KeyState> {
    return this.serial(async () => {
      const key = await this.key();
      const subject = key ? subjectOf(key.token) : null;
      if (key && subject && (await this.keyState()).state === 'confirm') {
        try {
          await this.askWho(key.token, subject);
        } catch (e) {
          if (!(e instanceof ProviderAuthError)) throw e;
        }
      }
      return this.keyState();
    });
  }

  /**
   * The player's answer to "Is this you?". Yes: syncs may run (start one with `connect`). No: the
   * key is dropped, and keys of that account are refused until the player says otherwise.
   */
  confirm(yes: boolean): Promise<KeyState> {
    return this.serial(async () => {
      const key = await this.key();
      const subject = key ? subjectOf(key.token) : null;
      if (!key || !subject) return this.keyState();
      const account = guardAccount(this.provider.id, subject);
      if (yes) {
        await this.addAccount(CONFIRMED, account);
      } else {
        await this.addAccount(REJECTED, account);
        await this.opts.vault.remove(KEY + this.provider.id);
      }
      await this.opts.storage.remove(WHO + this.provider.id);
      return this.keyState();
    });
  }

  /** Accounts the player said weren't theirs may be offered again (they signed in to the right one). */
  forgetRejected(): Promise<void> {
    return this.serial(() => this.opts.storage.remove(REJECTED + this.provider.id));
  }

  /** Forget the key here (signing out of this client; the portal's own sign-in is untouched). */
  dropKey(): Promise<void> {
    return this.serial(() => this.opts.vault.remove(KEY + this.provider.id));
  }

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  /**
   * The pairing page's fragment, read strictly (spec/deep-links.md); null when it isn't one. `kind` (1.10.0): `hcp` for
   * a handicap target (the extension's `HcpClient` pairs it), left out for launch monitor data.
   */
  static readFragment(fragment: string): { target: string; code: string; provider?: string; kind?: 'hcp' } | null {
    const r = parsePairFragment(fragment);
    if (!r.ok || r.action !== 'pair') return null;
    return { target: r.target, code: r.code, ...(r.provider ? { provider: r.provider } : {}), ...(r.kind === 'hcp' ? { kind: 'hcp' as const } : {}) };
  }

  /** POST /pair with the code; pairing the same target again replaces the old pairing (and ends its token). */
  offerPairing(offer: { target: string; code: string; provider?: string }): Promise<PairOutcome> {
    return this.serial(async () => {
      const provider = offer.provider ?? this.provider.id;
      if (provider !== this.provider.id) return { ok: false, error: 'provider' } as const;
      let pairing: Pairing;
      try {
        pairing = await pair({
          target: offer.target,
          code: offer.code,
          provider,
          client: { kind: this.opts.kind, name: this.opts.name, version: this.opts.version },
          ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
          now: this.now,
        });
      } catch (e) {
        if (!(e instanceof TargetError)) throw e;
        const map: Partial<Record<TargetError['code'], Extract<PairOutcome, { ok: false }>['error']>> = {
          bad_request: 'link',
          code_invalid: 'code',
          provider_unknown: 'provider',
          rate_limited: 'rate_limited',
          unreachable: 'unreachable',
          unavailable: 'unreachable',
          bad_answer: 'answer',
        };
        return { ok: false, error: map[e.code] ?? 'refused' } as const;
      }
      const id = pairingId(pairing.base);
      const old = (await this.pairings()).find((p) => pairingId(p.base) === id);
      if (old) {
        // Its token would otherwise stay valid in the target for nothing.
        await new HttpTarget(old, this.targetOpts()).revoke().catch(() => undefined);
      }
      await this.opts.vault.set(PAIRINGS, JSON.stringify([...(await this.pairings()).filter((p) => pairingId(p.base) !== id), pairing]));
      const entry: Entry = {
        id,
        base: pairing.base,
        name: pairing.target.name,
        provider,
        paired_at: pairing.paired_at,
        ...(pairing.account_ref ? { account_ref: pairing.account_ref } : {}),
      };
      await this.saveEntries([...(await this.entries()).filter((e) => e.id !== id), entry]);
      return { ok: true, id, name: pairing.target.name, replaced: !!old } as const;
    });
  }

  /** The player ends a pairing here: the target is told (its token revoked), whatever it answers. */
  removePairing(id: string): Promise<void> {
    return this.serial(async () => {
      const p = (await this.pairings()).find((x) => pairingId(x.base) === id);
      if (p) await new HttpTarget(p, this.targetOpts()).revoke().catch(() => undefined);
      await this.forget(id);
    });
  }

  private targetOpts(): { fetch?: FetchLike; now: () => number } {
    return { ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}), now: this.now };
  }

  // -------------------------------------------------------------------------
  // Syncs
  // -------------------------------------------------------------------------

  /**
   * Ask each target's plan (or one target's: `only`), and sync where it says so. `backfill` asks
   * only targets whose older history isn't done and whose next chunk is due by now.
   */
  run(reason: Reason, only?: string): Promise<RunReport> {
    return this.serial(async () => {
      const report: RunReport = { outcomes: [] };
      const pairings = (await this.pairings()).filter((p) => !only || pairingId(p.base) === only);
      for (const p of pairings) {
        const id = pairingId(p.base);
        const entry = (await this.entries()).find((e) => e.id === id);
        if (!entry) continue;
        report.outcomes.push({ id, name: entry.name, outcome: await this.runOne(p, entry, reason) });
      }
      return report;
    });
  }

  private async runOne(p: Pairing, entry: Entry, reason: Reason): Promise<RunReport['outcomes'][number]['outcome']> {
    const now = this.now();
    if (reason === 'backfill' && (entry.history?.done || (entry.history?.next_at ?? 0) > now)) return { status: 'skipped', why: 'history' };
    const test = await this.testOf(entry.id);
    if (test) return this.runTest(p, entry, reason, test);
    const key = await this.key();
    const state = await this.keyState();
    if (state.state === 'expired' && key) return this.tellExpired(p, entry, key.token, reason);
    if (state.state !== 'ready' || !key) {
      // Nothing to fetch with: no plan (it would take the lease from another device of the player),
      // but the target hears where the sign-in stands.
      if (reason !== 'backfill') {
        const gone = await this.tellSignIn(p, entry, reason, state.state);
        if (gone) return gone;
      }
      return { status: 'skipped', why: state.state };
    }

    this.active.add(entry.id);
    try {
      const outcome = await sync({
        target: new HttpTarget(p, this.targetOpts()),
        provider: this.provider,
        credential: key.token,
        reason,
        client: this.opts.kind,
        signin: 'ready',
        guard: this.guard,
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
        now: this.now,
        generator: { name: this.opts.name, version: this.opts.version },
      });
      await this.record(p, entry, reason, outcome, key.token);
      // Signed in, but with another account than the target's: it heard "ready" with the plan, so it hears this too.
      if (outcome.status === 'other_account') await this.tellSignIn(p, entry, reason, 'other');
      return outcome;
    } finally {
      this.active.delete(entry.id);
    }
  }

  /** The pairing's test, while it lasts: the scenario played back (null: none, or none any more). */
  private async testOf(id: string): Promise<Replay | null> {
    await this.testsReady();
    const r = await this.tests.provider(id);
    return r && r.id === this.provider.id ? r : null;
  }

  /**
   * A sync of a pairing in test mode: exactly what a sync with Trackman runs (the plan first, the guard, the chunks),
   * with the scenario's made-up Trackman answering and its made-up sign-in; every batch says `test: true`.
   */
  private async runTest(p: Pairing, entry: Entry, reason: Reason, test: Replay): Promise<SyncOutcome> {
    this.active.add(entry.id);
    try {
      const outcome = await sync({
        target: new HttpTarget(p, this.targetOpts()),
        provider: test,
        credential: test.credential,
        reason,
        client: this.opts.kind,
        signin: 'ready',
        guard: this.guard,
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
        now: this.now,
        generator: { name: this.opts.name, version: this.opts.version },
      });
      await this.record(p, entry, reason, outcome, test.credential, true);
      return outcome;
    } finally {
      this.active.delete(entry.id);
    }
  }

  /**
   * GET /status with the client's sign-in (spec 1.5.0): a target hears where it stands without a plan, so no
   * lease is taken. Also how a client that can't fetch notices the player ended the connection in the app.
   * Answers the outcome when the pairing is gone, else null (a target that can't be reached is asked again later).
   */
  private async tellSignIn(p: Pairing, entry: Entry, reason: Reason, signin: SignIn): Promise<{ status: 'disconnected' } | { status: 'failed'; error: TargetError } | null> {
    try {
      const st = await new HttpTarget(p, this.targetOpts()).status(signin);
      if (!st.connected) {
        await this.record(p, entry, reason, { status: 'disconnected' }, '');
        return { status: 'disconnected' };
      }
    } catch (e) {
      if (e instanceof TargetError && e.code === 'token_invalid') {
        await this.record(p, entry, reason, { status: 'failed', error: e }, '');
        return { status: 'failed', error: e };
      }
    }
    return null;
  }

  /**
   * Every target hears where the sign-in stands now, when it can't fetch with it (the player hasn't answered
   * "Is this you?", said no, or signed in with another account). With a sign-in that can fetch, the sync that
   * follows tells it with its plan.
   */
  report(): Promise<void> {
    return this.serial(async () => {
      const state = await this.keyState();
      if (state.state === 'ready') return;
      const testing = await this.testing();
      for (const p of await this.pairings()) {
        // A pairing in test mode is signed in with its scenario: the provider's sign-in isn't its business.
        if (testing.has(pairingId(p.base))) continue;
        const entry = (await this.entries()).find((e) => e.id === pairingId(p.base));
        if (entry) await this.tellSignIn(p, entry, 'timer', state.state);
      }
    });
  }

  /**
   * When the guard lets the next request to the provider go, if it holds for longer than its pauses between
   * requests (an hour's or a day's requests used up, or backing off after errors); else null.
   */
  async guardHold(): Promise<number | null> {
    const key = await this.key();
    const subject = key ? subjectOf(key.token) : null;
    try {
      const c = await this.guard.check(guardAccount(this.provider.id, subject));
      if (c.ok || c.until === null) return null;
      return c.reasons.some((r) => r === 'backoff' || r === 'per_hour' || r === 'per_day') ? c.until : null;
    } catch {
      return null; // the guard says it itself when the sync asks it
    }
  }

  private async record(p: Pairing, entry: Entry, reason: Reason, outcome: SyncOutcome, token: string, test = false): Promise<void> {
    const id = entry.id;
    const now = this.now();
    const at = new Date(now).toISOString();
    if (outcome.status === 'disconnected' || (outcome.status === 'failed' && outcome.error instanceof TargetError && outcome.error.code === 'token_invalid')) {
      await this.forget(id);
      await this.farewell({ name: entry.name, at, why: outcome.status === 'disconnected' ? 'disconnected' : 'revoked' });
      // The player ended the connection in the target app: this client lets go of the provider sign-in
      // too, unless another target still needs it.
      if (outcome.status === 'disconnected' && !(await this.pairings()).length) await this.opts.vault.remove(KEY + this.provider.id);
      return;
    }
    const last: Last = { at, reason, status: outcome.status };
    const history = { ...entry.history };
    let accountRef = entry.account_ref;
    let other = false;
    let toldExpired = entry.told_expired;
    switch (outcome.status) {
      case 'not_due':
      case 'busy':
        if (outcome.plan.account_ref) accountRef = outcome.plan.account_ref;
        if (outcome.plan.history?.done !== undefined) history.done = outcome.plan.history.done;
        if (reason === 'backfill') {
          if (outcome.plan.history?.done) history.done = true;
          history.next_at = now + Math.max(BACKFILL_STEP_MS / 2, (outcome.plan.wait_s ?? BACKFILL_STEP_MS / 1000) * 1000);
        }
        // A plan that wasn't due says nothing new about the last sync: keep what it said.
        if (entry.last && entry.last.status === 'synced') return this.update(id, (e) => ({ ...e, ...(accountRef ? { account_ref: accountRef } : {}), history }));
        break;
      case 'other_account':
        other = true;
        break;
      case 'synced': {
        last.result = outcome.result;
        last.more = outcome.more;
        if (outcome.notice) last.notice = outcome.notice;
        const subject = subjectOf(token);
        if (subject) accountRef = accountRefOf(p.account_salt, this.provider.id, subject);
        if (reason === 'backfill') {
          // Whether the history is done is the target's to say (its next plan does): it also
          // counts the rounds' shots, which a chunk without more sessions may still owe.
          const until = outcome.notice?.until ? Date.parse(outcome.notice.until) : NaN;
          history.next_at = Number.isFinite(until) && until > now ? until : now + BACKFILL_STEP_MS;
        } else if (history.done === undefined || outcome.more) {
          history.done = false;
        }
        if (outcome.notice?.code === 'auth_expired' && !test) {
          // Trackman refused the sign-in: the target has been told with this batch (a test's is made up: never).
          toldExpired = (liveUntil(token, 0) ?? 0) || now;
          await this.markRefused(token);
        }
        break;
      }
      case 'failed':
        last.error = outcome.error instanceof TargetError ? outcome.error.code : 'error';
        if (reason === 'backfill') history.next_at = now + BACKFILL_RETRY_MS;
        break;
      default:
        break;
    }
    await this.update(id, (e) => {
      const next: Entry = { ...e, last, history, other_account: other };
      if (accountRef) next.account_ref = accountRef;
      if (outcome.status === 'synced') {
        next.last_synced_at = at;
        const b = e.brought ?? { sessions: 0, rounds: 0, shots: 0 };
        next.brought = { sessions: b.sessions + outcome.result.sessions, rounds: b.rounds + outcome.result.rounds, shots: b.shots + outcome.result.shots };
        if (outcome.left !== undefined) next.left = outcome.left;
        else if (reason === 'backfill' && !outcome.more) delete next.left;
      }
      if (toldExpired !== undefined) next.told_expired = toldExpired;
      return next;
    });
  }

  /**
   * The key ran out: the target hears it once (an empty batch with `auth_expired`, when its plan is
   * due), so the app can say "sign in again" too. Nothing is asked of the provider.
   */
  private async tellExpired(p: Pairing, entry: Entry, token: string, reason: Reason): Promise<RunReport['outcomes'][number]['outcome']> {
    const subject = subjectOf(token);
    const exp = liveUntil(token, 0) ?? 0;
    if (!subject || reason === 'backfill') return { status: 'skipped', why: 'expired' };
    const target = new HttpTarget(p, this.targetOpts());
    if (entry.told_expired === exp) {
      // Told already. Whether the app still wants this connection is asked without taking a plan's
      // lease (another device of the player may still be signed in and fetch).
      try {
        const st = await target.status('expired');
        if (!st.connected) {
          await this.record(p, entry, reason, { status: 'disconnected' }, token);
          return { status: 'disconnected' };
        }
      } catch (e) {
        if (e instanceof TargetError && e.code === 'token_invalid') {
          await this.record(p, entry, reason, { status: 'failed', error: e }, token);
          return { status: 'failed', error: e };
        }
      }
      return { status: 'skipped', why: 'expired' };
    }
    try {
      const plan = await target.plan(this.provider.id, reason, this.opts.kind, 'expired');
      if (plan.disconnected) {
        await this.record(p, entry, reason, { status: 'disconnected' }, token);
        return { status: 'disconnected' };
      }
      if (!plan.due) return { status: 'skipped', why: 'expired' };
      const batch: Batch = {
        format: FORMAT,
        provider: this.provider.id,
        account_ref: accountRefOf(p.account_salt, this.provider.id, subject),
        generated_at: new Date(this.now()).toISOString(),
        generator: { name: this.opts.name, version: this.opts.version },
        sync: { ...(plan.plan_id ? { plan_id: plan.plan_id } : {}), reason },
        sessions: [],
        rounds: [],
        notice: { code: 'auth_expired', message: 'Sign in to the provider again.' },
      };
      await target.import(batch);
    } catch (e) {
      if (e instanceof TargetError && e.code === 'token_invalid') {
        await this.record(p, entry, reason, { status: 'failed', error: e }, token);
        return { status: 'failed', error: e };
      }
      return { status: 'skipped', why: 'expired' }; // asked again next time
    }
    await this.update(entry.id, (e) => ({ ...e, told_expired: exp, last: { at: new Date(this.now()).toISOString(), reason, status: 'told_expired' } }));
    return { status: 'told_expired' };
  }

  /** When the next history chunk may be asked about (ms), or null when no target's history waits. */
  async nextBackfill(): Promise<number | null> {
    const times = (await this.entries()).filter((e) => e.history && e.history.done === false).map((e) => e.history?.next_at ?? this.now());
    return times.length ? Math.max(this.now(), Math.min(...times)) : null;
  }

  /**
   * A sync into a file (the web app's *download*): `manual` brings what is new since the last file,
   * `backfill` the next chunk of the older history. Needs a key the player confirmed.
   */
  toFile(reason: 'manual' | 'backfill', write: (file: FileOut) => Promise<void>): Promise<SyncOutcome | { status: 'skipped'; why: string }> {
    return this.serial(async () => {
      const key = await this.key();
      const state = await this.keyState();
      if (state.state !== 'ready' || !key) return { status: 'skipped', why: state.state };
      const target = await FileTarget.open({ storage: this.opts.storage, provider: this.provider.id, write, now: this.now });
      return sync({
        target,
        provider: this.provider,
        credential: key.token,
        reason,
        client: this.opts.kind,
        guard: this.guard,
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
        now: this.now,
        generator: { name: this.opts.name, version: this.opts.version },
      });
    });
  }

  // -------------------------------------------------------------------------
  // What a client shows
  // -------------------------------------------------------------------------

  /**
   * Not in the queue: it only reads what is kept, and the popup must not wait for a sync to end before it can
   * show that one runs (a "Yes, that's me" seemed to do nothing for seconds, 18 Nov).
   */
  async status(): Promise<ClientStatus> {
    const key = await this.keyState();
    const entries = await this.entries();
    await this.testsReady();
    const tests = new Map(this.tests.list().map((m) => [m.key, m]));
    const testStates = new Map<string, TestState>();
    for (const [id, m] of tests) {
      let tc: GuardCounts | null = null;
      try {
        tc = await this.guard.counts(guardAccount(this.provider.id, m.subject));
      } catch {
        tc = null;
      }
      testStates.set(id, { name: m.name, player: m.player, valid_until: m.valid_until, at: m.at, counts: tc });
    }
    // What needs the player's attention is about the provider's sign-in: pairings in test mode don't need it.
    const real = entries.filter((e) => !tests.has(e.id));
    const stored = await this.key();
    const subject = stored ? subjectOf(stored.token) : null;
    let counts: GuardCounts | null = null;
    if (subject) {
      try {
        counts = await this.guard.counts(guardAccount(this.provider.id, subject));
      } catch {
        counts = null;
      }
    }
    let attention: ClientStatus['attention'] = null;
    if (key.state === 'confirm') attention = 'confirm';
    else if (key.state === 'other' || real.some((e) => e.other_account)) attention = 'other_account';
    else if (real.length && (key.state === 'none' || key.state === 'expired')) attention = 'sign_in';
    const asking = await this.asking();
    return {
      kind: this.opts.kind,
      provider: { id: this.provider.id, name: this.provider.name, ...(this.provider.notice ? { notice: this.provider.notice } : {}) },
      key,
      rejected: (await this.accounts(REJECTED)).length > 0,
      pairings: entries.map((e) => {
        const test = testStates.get(e.id);
        // In test mode the pairing is signed in with its scenario.
        return { ...e, host: hostOf(e.base), signin: test ? 'ready' : signinOf(key, e), ...(test ? { test } : {}) };
      }),
      testAsking: asking && entries.some((e) => e.id === asking.id) && !over(asking.valid_until, this.now()) ? asking : null,
      running: [...this.active],
      ended: await readList<Farewell>(this.opts.storage, ENDED),
      counts,
      attention,
    };
  }

  // -------------------------------------------------------------------------
  // Test mode (spec/test-mode.md)
  // -------------------------------------------------------------------------

  private async asking(): Promise<TestAsking | null> {
    try {
      const raw = await this.opts.storage.get(TEST_ASKING);
      const v = raw ? (JSON.parse(raw) as Partial<TestAsking>) : null;
      if (!v || typeof v.id !== 'string' || typeof v.name !== 'string' || typeof v.target !== 'string' || typeof v.valid_until !== 'string' || typeof v.at !== 'number' || !v.who) return null;
      return v as TestAsking;
    } catch {
      return null;
    }
  }

  private async dropAsking(): Promise<void> {
    await this.opts.storage.remove(TEST_ASKING);
    await this.blobs.remove(TEST_ASKING_BLOB).catch(() => undefined);
  }

  /**
   * A test code (or the test link) for one of this client's pairings: the scenario comes from that app with the
   * pairing's import token, and "Is this your account?" is asked about it through the guard, under the scenario's own
   * account - nothing synced, nothing changed for the pairing before the yes (`confirmTest`). `id` picks the pairing
   * when there are several and the link names none. Never throws for what can happen: a reason to show.
   */
  fetchTest(typed: string, id?: string): Promise<TestOutcome> {
    return this.serial(async () => {
      const input = readTestInput(typed);
      if (!input) return { ok: false, error: 'code' } as const;
      const pairings = await this.pairings();
      if (!pairings.length) return { ok: false, error: 'unpaired' } as const;
      let p: Pairing | undefined;
      if (input.target) p = pairings.find((x) => pairingId(x.base) === pairingId(input.target as string));
      else if (id) p = pairings.find((x) => pairingId(x.base) === id);
      else if (pairings.length === 1) p = pairings[0];
      else return { ok: false, error: 'which' } as const;
      if (!p) return { ok: false, error: 'unpaired' } as const;
      const pid = pairingId(p.base);
      const entry = (await this.entries()).find((e) => e.id === pid);
      if (!entry) return { ok: false, error: 'unpaired' } as const;
      let scenario: TestScenario;
      try {
        scenario = await new HttpTarget(p, this.targetOpts()).testScenario(input.code);
      } catch (e) {
        if (!(e instanceof TargetError)) return { ok: false, error: 'unreachable' } as const;
        if (e.code === 'token_invalid') {
          // The app no longer knows this pairing: it goes here too, as after a sync.
          await this.record(p, entry, 'manual', { status: 'failed', error: e }, '');
          return { ok: false, error: 'revoked' } as const;
        }
        const map: Partial<Record<TargetError['code'], TestError>> = {
          bad_request: 'code',
          code_invalid: 'code',
          test_unavailable: 'unavailable',
          not_test_account: 'not_test_account',
          code_expired: 'expired',
          rate_limited: 'rate_limited',
          unreachable: 'unreachable',
          unavailable: 'unreachable',
          bad_answer: 'answer',
        };
        return { ok: false, error: map[e.code] ?? 'unreachable' } as const;
      }
      if (scenario.provider !== this.provider.id || entry.provider !== this.provider.id) return { ok: false, error: 'provider' } as const;
      let who: Who;
      try {
        const r = replay(scenario, { now: this.now, ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}) });
        const account = guardAccount(r.id, r.subject(r.credential));
        await this.guard.beginRun(account);
        const ctx = providerContext({ guard: this.guard, account, reason: 'connect', now: this.now });
        who = await r.who(ctx, r.credential);
      } catch {
        return { ok: false, error: 'answer' } as const;
      }
      try {
        await this.blobs.set(TEST_ASKING_BLOB, JSON.stringify(scenario));
        const asking: TestAsking = { id: pid, target: entry.name, name: scenario.name, who, valid_until: scenario.valid_until, at: this.now() };
        await this.opts.storage.set(TEST_ASKING, JSON.stringify(asking));
      } catch {
        await this.dropAsking().catch(() => undefined);
        return { ok: false, error: 'not_kept' } as const;
      }
      return { ok: true, id: pid } as const;
    });
  }

  /**
   * The tester's answer to "Is this your account?" for a test. Yes: the pairing syncs from the scenario from now on
   * (start one with `connect`), until `endTest`, the pairing ends or the scenario's `valid_until`. No: it is dropped.
   */
  confirmTest(yes: boolean): Promise<TestOutcome> {
    return this.serial(async () => {
      const asking = await this.asking();
      if (!asking) return { ok: false, error: 'gone' } as const;
      try {
        if (!yes) return { ok: true, id: asking.id } as const;
        if (!(await this.pairings()).some((p) => pairingId(p.base) === asking.id)) return { ok: false, error: 'unpaired' } as const;
        let text: string | null;
        try {
          text = await this.blobs.get(TEST_ASKING_BLOB);
        } catch {
          text = null;
        }
        let read: ReturnType<typeof readTestScenario> | null = null;
        try {
          read = text === null ? null : readTestScenario(JSON.parse(text), new Date(this.now()).toISOString());
        } catch {
          read = null;
        }
        if (!read?.ok) return { ok: false, error: read?.error === 'expired' ? 'expired' : 'not_kept' } as const;
        try {
          await this.testsReady();
          await this.tests.start(asking.id, read.scenario, asking.who.player);
        } catch {
          return { ok: false, error: 'not_kept' } as const;
        }
        return { ok: true, id: asking.id } as const;
      } finally {
        await this.dropAsking().catch(() => undefined);
      }
    });
  }

  /** The tester ends a pairing's test: the scenario leaves this browser; the pairing stays. */
  endTest(id: string): Promise<void> {
    return this.serial(async () => {
      await this.testsReady();
      await this.tests.end(id);
    });
  }

  /** The player saw that a target ended the connection. */
  clearEnded(): Promise<void> {
    return this.serial(() => this.opts.storage.remove(ENDED));
  }

  /** The guard's log of the last 14 days, for the player to keep (spec/guard.md). */
  exportLog(): Promise<GuardLogExport> {
    return this.serial(() => this.guard.exportLog());
  }
}

function over(validUntil: string, now: number): boolean {
  const t = Date.parse(validUntil);
  return !Number.isFinite(t) || now >= t;
}

/** Where the sign-in stands for one target (spec 1.5.0): "other" also when only this target knows another account. */
export function signinOf(key: KeyState, entry: Pick<Entry, 'other_account'>): SignIn {
  return key.state === 'ready' && entry.other_account ? 'other' : key.state;
}

/**
 * What stays of a key Trackman refused: its claims (whose account it was, when it ran out) with
 * the signature cut off, so it can no longer open anything but the target can still be told.
 */
function fingerprint(token: string): string {
  return base64url(sha256(utf8(`glmsync-refused|${token}`))).slice(0, 22);
}

function expiredMark(token: string): string {
  const [head, body] = token.split('.');
  return `${head ?? ''}.${body ?? ''}.`;
}
