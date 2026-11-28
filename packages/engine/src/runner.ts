// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Everything the engine does with targets and providers, without a screen: pairing, a sync for each
 * pairing, the older history a chunk at a time, a sync into a file, "Is this you?". The companion app
 * runs it; an app that embeds the engine runs the same.
 *
 * The rules of the project hold here as everywhere (CLAUDE.md §2):
 * - the target's plan first, every time: nothing here fetches on its own initiative, a timer or a
 *   link only asks; `sync` from @glmsync/core asks the provider only when the plan says "due";
 * - every request to a provider through the one guard of this app, whose counts outlive restarts;
 * - the provider's sign-in goes to the provider only; a target gets batches and nothing else;
 * - every call to the provider carries the User-Agent of the browser the player signed in with on this
 *   device, when one was kept with the sign-in (signins.ts), and nothing else of the device or the app.
 *
 * One thing at a time: runs are queued, so a timer in the background and a "fetch now" from a target
 * app never fetch side by side (the plan's lease keeps different apps apart, this keeps one app's -
 * which is why the target lets this app take its own lease over, spec 1.13.0). A "fetch now" while a
 * sync is under way joins it instead of fetching the same sessions once more after it (SY-5); only if
 * that one fetched nothing (not due, busy) does the tap fetch itself.
 * Nothing here throws at a timer: every way a run ends is recorded for the screen; a plan that was
 * busy or not due goes beside the last real result, never over it.
 */

import {
  accountRefOf,
  cleanUserAgent,
  FileTarget,
  GuardLimitError,
  guardAccount,
  HttpTarget,
  pair,
  providerContext,
  readJson,
  sync,
  TargetError,
  type ClientKind,
  type FetchLike,
  type FileOut,
  type Guard,
  type GuardCounts,
  type Holder,
  type ImportResult,
  type Provider,
  type ProviderContext,
  type Storage,
  type SyncOutcome,
} from '@glmsync/core';
import { FORMAT, type Batch, type NoticeCode, type Reason, type TestScenario } from '@glmsync/spec';
import { replay } from '@glmsync/provider-trackman';
import type { BackgroundRun } from './longRun.ts';
import type { KeyedPairing, Pairings } from './pairings.ts';
import type { SignIns } from './signins.ts';
import { TestModeError, type TestMode, type Tests } from './tests.ts';

/** How the engine names itself to a target unless the app gives a client of its own (the companion app's). */
export const CLIENT: ClientKind = 'companion';
export const CLIENT_NAME = 'Golf Stats Sync';
export const GENERATOR = 'Golf Stats Sync companion';

export interface WhoAnswer {
  player: string | null;
  activities: { count: number; last: string | null; place: string | null } | null;
}

/** A provider as this app uses it: a sync's provider, and "Is this you?". */
export interface AppProvider extends Provider<string> {
  who(ctx: ProviderContext, token: string): Promise<WhoAnswer>;
}

export type RunStatus = SyncOutcome['status'] | 'signed_out' | 'unpaired';

/** How the last run of a pairing (or of the file) ended, for the screen. */
export interface LastRun {
  at: number;
  reason: Reason;
  status: RunStatus;
  result?: ImportResult;
  notice?: NoticeCode;
  /** RFC 3339, with `notice` (guard limit, provider unavailable). */
  until?: string;
  /** A failed run's kind (a target error code, or the error's name); never a message from outside. */
  error?: string;
  more?: boolean;
  /** What the target took from here since pairing, all runs together (the wizard's "10 sessions, 6 rounds"). */
  total?: { sessions: number; rounds: number };
  /** Sessions of the older history still to come, as the last history chunk's provider could tell. */
  left?: number;
  /** The target's plan said the history only fills gaps (spec 1.21.0): nothing older comes, so no count of it. */
  older?: false;
  /** For a busy run: who holds the lease (spec 1.13.0). */
  holder?: Holder;
  /** A later run that fetched nothing (busy, not due), kept beside this one instead of over it. */
  aside?: { at: number; status: 'busy' | 'not_due'; holder?: Holder };
}

export type SyncReport = { key: string; run: LastRun }[];

/** A run that fetched nothing: it goes beside the last real one. */
const idle = (status: RunStatus): status is 'busy' | 'not_due' => status === 'busy' || status === 'not_due';

export interface RunnerOptions {
  pairings: Pairings;
  signIns: SignIns;
  guard: Guard;
  storage: Storage;
  providers: Readonly<Record<string, AppProvider>>;
  /** Test mode's scenarios, per pairing (spec/test-mode.md); none: no test mode. */
  tests?: Tests;
  /** For targets and providers alike (tests pass their fakes). */
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The share sheet (`toFile`). */
  writeFile?: (file: FileOut) => Promise<void>;
  version?: string;
  /** The last background runs (longRun.ts), which go into the exported log. */
  background?: { list(): Promise<BackgroundRun[]> };
  /** How the app names itself to a target (default: the companion app, `CLIENT` and `CLIENT_NAME`). */
  client?: { kind: ClientKind; name: string };
  /** The generator every batch names (default `GENERATOR`). */
  generator?: string;
}

// The names the companion app wrote first stay, so a phone keeps what it had (in another app's storage they meet nothing).
const RUNS = 'glmsync/companion/runs';
const MAX_RUNS = 40;
/** A history chunk the target let go just now: the next may go at the earliest after this. */
const CHUNK_PAUSE_S = 60;
/** The screen waits for the next history chunk only this long; the background goes on later. */
const MAX_FOREGROUND_WAIT_S = 30 * 60;

const errorKind = (e: unknown) =>
  e instanceof TargetError ? e.code : e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error';

export class Runner {
  private queue: Promise<unknown> = Promise.resolve();
  /** The sync queued or under way (the last one asked), for a tap to join. */
  private pending: { reason: Reason; target?: string; done: Promise<SyncReport> } | null = null;
  /** A tap's own sync, once it had to wait: a second tap joins it. */
  private tapped: { target?: string; done: Promise<SyncReport> } | null = null;
  private aborter = new AbortController();
  private runs: Record<string, LastRun> = {};
  private loaded = false;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly generator: { name: string; version?: string };
  private readonly client: { kind: ClientKind; name: string };

  constructor(private readonly opts: RunnerOptions) {
    this.now = opts.now ?? Date.now;
    this.generator = { name: opts.generator ?? GENERATOR, ...(opts.version ? { version: opts.version } : {}) };
    this.client = opts.client ?? { kind: CLIENT, name: CLIENT_NAME };
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

  /** One at a time, in the order asked. A run that fails doesn't hold up the next. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Stops what runs now (the player took a sign-in away); later runs go ahead as usual. */
  stop(): void {
    this.aborter.abort();
    this.aborter = new AbortController();
  }

  private get signal() {
    return this.aborter.signal;
  }

  // --- what happened last -------------------------------------------------------------------

  async loadRuns(): Promise<void> {
    try {
      const v = await readJson(this.opts.storage, RUNS);
      this.runs = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, LastRun>) : {};
    } catch {
      this.runs = {};
    }
    this.loaded = true;
    this.tell();
  }

  lastRun(key: string): LastRun | null {
    return this.runs[key] ?? null;
  }

  private async record(key: string, given: LastRun) {
    if (!this.loaded) await this.loadRuns();
    // What came adds up across runs, and how much is still to come stays until a chunk says otherwise.
    const before = this.runs[key];
    if (idle(given.status) && before && !idle(before.status)) {
      // Nothing fetched this time: what the last real run brought stays, this goes beside it.
      const aside: NonNullable<LastRun['aside']> = { at: given.at, status: given.status as 'busy' | 'not_due' };
      if (given.holder) aside.holder = given.holder;
      // Its plan still said where the history stands (spec 1.21.0).
      const kept: LastRun = { ...before, aside };
      if (given.older === false) {
        kept.older = false;
        delete kept.left;
      } else delete kept.older;
      return this.keep(key, kept);
    }
    const run: LastRun = { ...given };
    if (run.older === false) delete run.left;
    const total = before?.total ?? { sessions: 0, rounds: 0 };
    if (run.status === 'synced' && run.result) run.total = { sessions: total.sessions + run.result.sessions, rounds: total.rounds + run.result.rounds };
    else if (before?.total) run.total = before.total;
    if (run.left === undefined && before?.left !== undefined && run.older !== false && !(run.reason === 'backfill' && run.status === 'synced' && !run.more)) run.left = before.left;
    await this.keep(key, run);
  }

  private async keep(key: string, run: LastRun) {
    const runs = { ...this.runs, [key]: run };
    const keys = Object.keys(runs).sort((a, b) => (runs[b]?.at ?? 0) - (runs[a]?.at ?? 0));
    this.runs = Object.fromEntries(keys.slice(0, MAX_RUNS).map((k) => [k, runs[k] as LastRun]));
    this.tell();
    try {
      await this.opts.storage.set(RUNS, JSON.stringify(this.runs));
    } catch {
      // Only what the screen shows: kept in memory until the next run.
    }
  }

  // --- pairing ------------------------------------------------------------------------------

  /** A pairing code for an import token; the pairing it replaces is revoked at the target. */
  pair(link: { target: string; code: string; provider?: string }, name = this.client.name): Promise<KeyedPairing> {
    return this.serial(async () => {
      const provider = link.provider ?? 'trackman';
      if (!this.opts.providers[provider]) throw new TargetError('provider_unknown', 'This app has no such provider.');
      const pairing = await pair({
        target: link.target,
        code: link.code,
        provider,
        client: { kind: this.client.kind, name, ...(this.opts.version ? { version: this.opts.version } : {}) },
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        signal: this.signal,
        now: this.now,
      });
      const { added, replaced } = await this.opts.pairings.add(pairing);
      if (replaced) await this.revoke(replaced);
      return added;
    });
  }

  private async revoke(p: KeyedPairing) {
    try {
      await new HttpTarget(p, { ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}), now: this.now }).revoke();
    } catch {
      // The target can't be reached now: the token is gone from this phone anyway, and the player
      // sees the connection in the target app, where it can be ended too.
    }
  }

  /** The player ends a pairing here: the token is revoked at the target and leaves this phone. */
  unpair(key: string): Promise<void> {
    return this.serial(async () => {
      const p = this.opts.pairings.get(key);
      if (!p) return;
      await this.revoke(p);
      await this.opts.pairings.remove(key);
      await this.opts.tests?.end(key); // a test lasts only as long as its pairing
      await this.record(key, { at: this.now(), reason: 'manual', status: 'unpaired' });
    });
  }

  /** The target ended the pairing (disconnected, or the token revoked there). */
  private async dropped(p: KeyedPairing) {
    // Kept as ended, so the list says it and where to pair again (Reginald's test of 27 Nov).
    await this.opts.pairings.end(p.key, this.now());
    await this.opts.tests?.end(p.key);
    // The last target using this sign-in is gone: so is the sign-in (spec: "disconnected").
    if (!this.opts.pairings.usesProvider(p.provider)) {
      try {
        await this.opts.signIns.forget(p.provider);
      } catch {
        // Gone from memory; the store is tried again when the player signs out.
      }
    }
  }

  // --- syncing ------------------------------------------------------------------------------

  private target(p: KeyedPairing) {
    return new HttpTarget(p, { ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}), now: this.now, signal: this.signal });
  }

  /** A sync for each pairing (or each of one target), one after the other. A manual one joins a sync under way. */
  syncAll(reason: Reason, only: { target?: string } = {}): Promise<SyncReport> {
    if (reason === 'manual') return this.tap(only);
    return this.queued(reason, only);
  }

  /** The sync queued or under way, if any: what a tap now would wait for ("waiting for the fetch under way"). */
  syncing(): { reason: Reason } | null {
    return this.pending ? { reason: this.pending.reason } : null;
  }

  private queued(reason: Reason, only: { target?: string }): Promise<SyncReport> {
    const done = this.serial(async () => {
      const pairings = only.target ? this.opts.pairings.ofTarget(only.target) : [...this.opts.pairings.list()];
      const out: SyncReport = [];
      for (const p of pairings) {
        const run = await this.syncOne(p, reason);
        out.push({ key: p.key, run });
      }
      return out;
    });
    const mine = { reason, ...(only.target ? { target: only.target } : {}), done };
    this.pending = mine;
    this.tell();
    const off = () => {
      if (this.pending === mine) {
        this.pending = null;
        this.tell();
      }
    };
    done.then(off, off);
    return done;
  }

  /**
   * "Fetch now": a tap while a sync of the same pairings is queued or under way waits for it and takes its outcome
   * when it fetched (Reginald, 25 Nov: a tap fetched the same 8 sessions again while the first sync's batch was still
   * on its way). Only when that one fetched nothing - not due, or another device holds the lease - does the tap ask a
   * plan of its own, which is never busy. A second tap meanwhile joins the first.
   */
  private tap(only: { target?: string }): Promise<SyncReport> {
    const same = (x: { target?: string } | null) => !!x && (x.target === undefined || x.target === only.target);
    if (this.tapped && same(this.tapped)) return this.tapped.done;
    const before = this.pending && same(this.pending) ? this.pending.done : null;
    if (!before) return this.queued('manual', only);
    const done = (async () => {
      const out = await before.catch((): SyncReport => []);
      if (out.length && out.every((o) => o.run.status === 'synced')) return out;
      return this.queued('manual', only);
    })();
    const mine = { ...(only.target ? { target: only.target } : {}), done };
    this.tapped = mine;
    const off = () => {
      if (this.tapped === mine) this.tapped = null;
    };
    done.then(off, off);
    return done;
  }

  /** The pairing's test, if it has one that lasts: the scenario played back, and its made-up sign-in. */
  private async testOf(p: KeyedPairing): Promise<{ provider: AppProvider; credential: string } | null> {
    const r = (await this.opts.tests?.provider(p.key)) ?? null;
    return r && r.id === p.provider ? { provider: r, credential: r.credential } : null;
  }

  private async syncOne(p: KeyedPairing, reason: Reason): Promise<LastRun> {
    const provider = this.opts.providers[p.provider];
    const test = await this.testOf(p);
    let run: LastRun;
    if (test) {
      run = await this.fetchFor(p, test.provider, test.credential, reason, true);
    } else if (!provider) {
      run = { at: this.now(), reason, status: 'failed', error: 'provider_unknown' };
    } else {
      const credential = this.opts.signIns.credential(p.provider);
      run = credential ? await this.fetchFor(p, provider, credential, reason, false, this.userAgent(p.provider)) : await this.signedOut(p, reason);
    }
    await this.record(p.key, run);
    return run;
  }

  /** The User-Agent kept with the provider's sign-in on this device, for its calls; null: none (a test, an older sign-in). */
  private userAgent(providerId: string): string | null {
    return this.opts.signIns.get(providerId)?.userAgent ?? null;
  }

  private async fetchFor(p: KeyedPairing, provider: AppProvider, credential: string, reason: Reason, test = false, userAgent: string | null = null): Promise<LastRun> {
    const outcome = await sync({
      target: this.target(p),
      provider,
      credential,
      reason,
      client: this.client.kind,
      // A sign-in is kept here only once the player said it is theirs: it can fetch (spec 1.5.0).
      signin: 'ready',
      guard: this.opts.guard,
      ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
      signal: this.signal,
      now: this.now,
      ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
      generator: this.generator,
      ...(userAgent ? { userAgent } : {}),
    });
    const run: LastRun = { at: this.now(), reason, status: outcome.status };
    if (outcome.status === 'busy' && outcome.plan.holder) run.holder = outcome.plan.holder;
    if ((outcome.status === 'busy' || outcome.status === 'not_due') && outcome.plan.history?.older === false) run.older = false;
    // The target heard "ready" with the plan; its account is another one, which it hears too (no lease taken).
    if (outcome.status === 'other_account') await this.target(p).status('other').catch(() => undefined);
    if (outcome.status === 'synced') {
      run.result = outcome.result;
      run.more = outcome.more;
      if (outcome.older === false) run.older = false;
      if (outcome.notice) {
        run.notice = outcome.notice.code;
        if (outcome.notice.until) run.until = outcome.notice.until;
      }
      // The provider refused the sign-in: it goes, the mark stays for a quiet renewal (a test's is made up: never).
      if (outcome.notice?.code === 'auth_expired' && !test) await this.opts.signIns.expire(p.provider);
      // What the target has bound the pairing to: used to warn before a sign-in of another account.
      const subject = provider.subject(credential);
      if (subject && outcome.result.sessions + outcome.result.rounds + outcome.result.duplicates > 0) {
        await this.opts.pairings.bind(p.key, accountRefOf(p.account_salt, p.provider, subject));
      }
    } else if (outcome.status === 'disconnected') {
      await this.dropped(p);
    } else if (outcome.status === 'failed') {
      run.error = errorKind(outcome.error);
      if (outcome.error instanceof TargetError && outcome.error.code === 'token_invalid') {
        await this.dropped(p);
        run.status = 'disconnected';
      }
    }
    return run;
  }

  /**
   * No sign-in that works: nothing is asked of the provider. When the target's plan says a sync is
   * due, the target hears why none comes (an empty batch with `auth_expired`, which also releases the
   * lease), so the target app can tell the player to sign in again here.
   */
  private async signedOut(p: KeyedPairing, reason: Reason): Promise<LastRun> {
    const run: LastRun = { at: this.now(), reason, status: 'signed_out', notice: 'auth_expired' };
    try {
      const target = this.target(p);
      // Where the sign-in stands (spec 1.5.0): ran out here, or never made on this phone.
      const plan = await target.plan(p.provider, reason, this.client.kind, this.opts.signIns.had(p.provider) ? 'expired' : 'none');
      if (plan.disconnected) {
        await this.dropped(p);
        return { at: this.now(), reason, status: 'disconnected' };
      }
      if (!plan.due) return run;
      const subject = this.opts.signIns.had(p.provider)?.subject ?? null;
      const ref = plan.account_ref ?? p.account_ref ?? (subject ? accountRefOf(p.account_salt, p.provider, subject) : null);
      if (!ref) return run; // never signed in here: nothing to name, the lease runs out by itself
      const batch: Batch = {
        format: FORMAT,
        provider: p.provider,
        account_ref: ref,
        generated_at: new Date(this.now()).toISOString(),
        generator: this.generator,
        sync: { ...(plan.plan_id ? { plan_id: plan.plan_id } : {}), reason },
        sessions: [],
        rounds: [],
        notice: { code: 'auth_expired', message: 'Sign in to the provider again in the companion app.' },
      };
      await target.import(batch);
    } catch (e) {
      if (e instanceof TargetError && (e.code === 'token_invalid' || e.code === 'disconnected')) {
        await this.dropped(p);
        return { at: this.now(), reason, status: 'disconnected' };
      }
      return { ...run, error: errorKind(e) };
    }
    return run;
  }

  /**
   * One chunk of the older history for each pairing that has a sign-in, as the target plans it.
   * Answers how many seconds until the next chunk may go, or null when nothing is left to do now
   * (history done, not due for long, or the guard holds for a while: the background goes on later).
   */
  backfill(): Promise<number | null> {
    return this.serial(async () => {
      const waits: number[] = [];
      const soonest = (s: number) => waits.push(s);
      for (const p of this.opts.pairings.list()) {
        const test = await this.testOf(p);
        const provider = test?.provider ?? this.opts.providers[p.provider];
        const credential = test?.credential ?? this.opts.signIns.credential(p.provider);
        if (!provider || !credential) continue;
        const userAgent = test ? null : this.userAgent(p.provider);
        const outcome = await sync({
          target: this.target(p),
          provider,
          credential,
          reason: 'backfill',
          client: this.client.kind,
          signin: 'ready',
          guard: this.opts.guard,
          ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
          signal: this.signal,
          now: this.now,
          ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
          generator: this.generator,
          ...(userAgent ? { userAgent } : {}),
        });
        if (outcome.status === 'not_due') {
          if (outcome.plan.history?.done !== true && outcome.plan.wait_s !== undefined) soonest(outcome.plan.wait_s);
          continue;
        }
        if (outcome.status === 'busy') {
          soonest(outcome.plan.wait_s ?? CHUNK_PAUSE_S);
          continue;
        }
        if (outcome.status === 'disconnected') {
          await this.dropped(p);
          continue;
        }
        if (outcome.status !== 'synced') continue;
        await this.record(p.key, { at: this.now(), reason: 'backfill', status: 'synced', result: outcome.result, more: outcome.more, ...(outcome.left !== undefined ? { left: outcome.left } : {}), ...(outcome.older === false ? { older: false as const } : {}), ...(outcome.notice ? { notice: outcome.notice.code, ...(outcome.notice.until ? { until: outcome.notice.until } : {}) } : {}) });
        if (outcome.notice?.code === 'auth_expired') {
          if (!test) await this.opts.signIns.expire(p.provider);
          continue;
        }
        if (outcome.notice?.until) {
          soonest(Math.max(0, (Date.parse(outcome.notice.until) - this.now()) / 1000));
          continue;
        }
        if (!outcome.notice) soonest(CHUNK_PAUSE_S);
      }
      const next = waits.length ? Math.min(...waits) : null;
      return next !== null && next <= MAX_FOREGROUND_WAIT_S ? Math.ceil(next) : null;
    });
  }

  /** A sync into a file (the share sheet), planned gently by the file target: only when asked. */
  toFile(providerId: string): Promise<LastRun> {
    return this.serial(async () => {
      const key = `file:${providerId}`;
      const provider = this.opts.providers[providerId];
      const credential = this.opts.signIns.credential(providerId);
      const write = this.opts.writeFile;
      let run: LastRun;
      if (!provider || !write) run = { at: this.now(), reason: 'manual', status: 'failed', error: 'provider_unknown' };
      else if (!credential) run = { at: this.now(), reason: 'manual', status: 'signed_out', notice: 'auth_expired' };
      else {
        const target = await FileTarget.open({ storage: this.opts.storage, provider: providerId, write, now: this.now });
        const userAgent = this.userAgent(providerId);
        const outcome = await sync({
          target,
          provider,
          credential,
          reason: 'manual',
          client: this.client.kind,
          guard: this.opts.guard,
          ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
          signal: this.signal,
          now: this.now,
          ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}),
          generator: this.generator,
          ...(userAgent ? { userAgent } : {}),
        });
        run = { at: this.now(), reason: 'manual', status: outcome.status };
        if (outcome.status === 'synced') {
          run.result = outcome.result;
          if (outcome.notice) run.notice = outcome.notice.code;
          if (outcome.notice?.code === 'auth_expired') await this.opts.signIns.expire(providerId);
        }
        if (outcome.status === 'failed') run.error = errorKind(outcome.error);
      }
      await this.record(key, run);
      return run;
    });
  }

  // --- the provider account -----------------------------------------------------------------

  /**
   * "Is this you?": through the guard, in a run of its own, with the User-Agent of the window the key came from (null:
   * none). Throws what the provider or guard said.
   */
  who(providerId: string, token: string, userAgent: string | null = null): Promise<WhoAnswer> {
    return this.serial(async () => {
      const provider = this.opts.providers[providerId];
      if (!provider) throw new TargetError('provider_unknown', 'This app has no such provider.');
      const account = guardAccount(providerId, provider.subject(token));
      await this.opts.guard.beginRun(account);
      const ua = cleanUserAgent(userAgent);
      const ctx = providerContext({
        guard: this.opts.guard,
        account,
        reason: 'connect',
        ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
        signal: this.signal,
        now: this.now,
        ...(ua ? { userAgent: ua } : {}),
      });
      return provider.who(ctx, token);
    });
  }

  // --- test mode (spec/test-mode.md) ---------------------------------------------------------

  /**
   * The scenario a paired app hands out for a test code, asked with that pairing's import token. Throws
   * `TestModeError` (`unpaired`; `provider`: a scenario of another provider than the pairing's, or one this app
   * can't play back) and the target's `TargetError` (a pairing the target ended is dropped here as at a sync).
   */
  async testScenario(key: string, code: string): Promise<TestScenario> {
    const p = this.opts.pairings.get(key);
    if (!p) throw new TestModeError('unpaired');
    let scenario: TestScenario;
    try {
      scenario = await this.target(p).testScenario(code);
    } catch (e) {
      if (e instanceof TargetError && (e.code === 'token_invalid' || e.code === 'disconnected')) await this.dropped(p);
      throw e;
    }
    if (scenario.provider !== p.provider || scenario.provider !== 'trackman') throw new TestModeError('provider');
    return scenario;
  }

  /** "Is this your account?" for a scenario: played back through the guard, under its subject, like a sign-in's. */
  testWho(scenario: TestScenario): Promise<WhoAnswer> {
    return this.serial(async () => {
      let r;
      try {
        r = replay(scenario, { now: this.now, ...(this.opts.sleep ? { sleep: this.opts.sleep } : {}) });
      } catch {
        throw new TestModeError('provider');
      }
      const account = guardAccount(r.id, r.subject(r.credential));
      await this.opts.guard.beginRun(account);
      const ctx = providerContext({ guard: this.opts.guard, account, reason: 'connect', signal: this.signal, now: this.now });
      return r.who(ctx, r.credential);
    });
  }

  /** The tester said yes: the pairing syncs from the scenario until the test ends. */
  async startTest(key: string, scenario: TestScenario, player: string | null): Promise<TestMode> {
    if (!this.opts.tests) throw new TestModeError('provider');
    if (!this.opts.pairings.get(key)) throw new TestModeError('unpaired');
    return this.opts.tests.start(key, scenario, player);
  }

  /** The tester signs out of the test: the scenario leaves this phone, a run under way with it stops. */
  async endTest(key: string): Promise<void> {
    this.stop();
    await this.opts.tests?.end(key);
  }

  /** "Today 14 of 300" for a test's made-up account (each code a guard of its own). */
  async testCounts(key: string): Promise<GuardCounts | null> {
    const m = this.opts.tests?.of(key);
    if (!m) return null;
    try {
      return await this.opts.guard.counts(guardAccount('trackman', m.subject));
    } catch {
      return null;
    }
  }

  /** The targets bound to another account of this provider than the one a key opens. */
  otherAccountAt(providerId: string, token: string): string[] {
    const provider = this.opts.providers[providerId];
    const subject = provider?.subject(token) ?? null;
    return this.opts.pairings
      .list()
      .filter((p) => p.provider === providerId && p.account_ref && (!subject || accountRefOf(p.account_salt, providerId, subject) !== p.account_ref))
      .map((p) => p.target.name);
  }

  /** "Today 14 of 300" for the account of the provider's sign-in (or the one held before). */
  async counts(providerId: string): Promise<GuardCounts | null> {
    const subject = this.opts.signIns.get(providerId)?.subject ?? this.opts.signIns.had(providerId)?.subject;
    if (subject === undefined) return null;
    try {
      return await this.opts.guard.counts(guardAccount(providerId, subject));
    } catch {
      return null;
    }
  }

  /**
   * The guard's log of the last days as a file: times, kinds, statuses, durations - never content. Beside it the last
   * background runs (when, how long, how many history chunks, how each ended), to see what iOS allowed at night.
   */
  async logFile(): Promise<FileOut> {
    const log = await this.opts.guard.exportLog();
    const background = (await this.opts.background?.list().catch(() => [])) ?? [];
    const day = new Date(this.now()).toISOString().slice(0, 10);
    return { name: `glmsync-requests-${day}.json`, text: `${JSON.stringify({ ...log, background_runs: background }, null, 2)}\n` };
  }
}

/** Whether a guard limit, rather than the provider, ended things (for the screen's wording). */
export const isGuardLimit = (e: unknown) => e instanceof GuardLimitError;
