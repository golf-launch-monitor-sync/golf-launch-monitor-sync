// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * For tests (here, in the providers and in the clients): a made-up target that answers the target
 * API (spec/api/target-api.yaml) in memory, and a clock that runs as fast as the test wants. Nothing
 * here reaches a network.
 */

import { readSignIn, readWake, validateBatch, type Batch, type Reason, type SignIn, type WakeRegistration } from '@glmsync/spec';
import type { ImportLimits } from '../api.ts';
import type { FetchLike, ResponseLike } from '../http.ts';

/** A clock that only moves when slept on: a day of syncs in milliseconds. */
export class VirtualClock {
  constructor(public t = Date.parse('2026-11-16T08:00:00Z')) {}
  now = (): number => this.t;
  sleep = async (ms: number): Promise<void> => {
    if (ms > 0) this.t += ms;
  };
  advance(ms: number): void {
    this.t += ms;
  }
}

export function response(status: number, body: unknown, headers: Record<string, string> = {}): ResponseLike {
  const text = typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body);
  const h = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (name) => h.get(name.toLowerCase()) ?? null }, text: async () => text };
}

export interface Received {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface PlanAsked {
  provider: string;
  reason: Reason;
  client: string | null;
  /** The client's sign-in as it said it (1.5.0), read as a target reads it. */
  signin: SignIn | null;
  /** The client's version as it named it with the plan (1.22.0). */
  version: string | null;
}

/** A sign-in a client told, with the plan or a status (1.5.0). */
export interface SignInTold {
  via: 'plan' | 'status';
  signin: SignIn;
}

export interface FakeTargetOptions {
  base?: string;
  name?: string;
  limits?: ImportLimits;
  /** The plan's body for each ask; default: always due, everything wanted. */
  plan?: (ask: PlanAsked, target: FakeTarget) => Record<string, unknown>;
  /** A path whose answer waits until its promise settles (a first sync held under way, for the click checks). */
  hold?: Record<string, Promise<unknown>>;
  /** A status to answer a path with instead (e.g. { '/import': 503 }). */
  fail?: Record<string, { status: number; body?: unknown; headers?: Record<string, string> }>;
  /** false: a target that offers no wake (answers 404 there, as one older than 1.9.0 does). */
  wake?: boolean;
  /** false: a target that offers no test scenarios (answers 404 there, as one older than 1.8.0 does). */
  tests?: boolean;
}

/** A target in memory, as the OpenAPI describes it. */
export class FakeTarget {
  readonly base: string;
  readonly name: string;
  readonly limits: ImportLimits;
  readonly codes = new Set<string>(['K7M2PQ9X']);
  readonly tokens = new Set<string>();
  readonly received: Received[] = [];
  readonly imports: Batch[] = [];
  readonly asked: PlanAsked[] = [];
  /** Every sign-in a client told, in order. */
  readonly signins: SignInTold[] = [];
  /** The wake addresses clients registered (1.9.0), by token. */
  readonly wakes = new Map<string, WakeRegistration>();
  /** What it stores: external id -> the item. */
  readonly sessions = new Map<string, Batch['sessions'][number]>();
  readonly rounds = new Map<string, Batch['rounds'][number]>();
  accountRef: string | null = null;
  disconnected = false;
  /** Test mode (1.8.0): the scenarios it hands out, by test code; codes whose test is over. */
  readonly scenarios = new Map<string, unknown>();
  readonly expiredCodes = new Set<string>();
  /** Whether the paired account is a test account: only then a scenario, and only then a batch with `test`. */
  testAccount = false;
  salt = 'fake-target-salt-0001';
  private seq = 0;

  constructor(readonly opts: FakeTargetOptions = {}) {
    this.base = opts.base ?? 'https://app.example.org/lm/v1';
    this.name = opts.name ?? 'Example App';
    this.limits = opts.limits ?? { max_bytes: 5_000_000, max_sessions: 50, max_shots: 20_000, max_rounds: 50, max_round_shots: 5_000 };
  }

  known(): string[] {
    return [...this.sessions.keys(), ...this.rounds.keys()];
  }

  fetch: FetchLike = async (url, init) => {
    const headers = init.headers;
    const rec: Received = { method: init.method, url, headers };
    if (init.body !== undefined) rec.body = init.body;
    this.received.push(rec);
    if (!url.startsWith(this.base)) return response(404, { error: { code: 'bad_request' } });
    const u = new URL(url);
    const path = u.pathname.slice(new URL(this.base).pathname.length);
    const held = this.opts.hold?.[path];
    if (held) await held.catch(() => undefined);
    const failing = this.opts.fail?.[path];
    if (failing) return response(failing.status, failing.body ?? { error: { code: 'bad_request', message: 'made to fail' } }, failing.headers);
    if (path === '/pair' && init.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as { code?: string; provider?: string };
      if (!body.code || !this.codes.has(body.code)) return response(404, { error: { code: 'code_invalid', message: 'No such code.' } });
      this.codes.delete(body.code);
      const token = `tok_${'x'.repeat(40)}_${++this.seq}`;
      this.tokens.add(token);
      this.disconnected = false;
      return response(200, {
        token,
        target: { name: this.name, return_prefixes: ['exampleapp://', 'https://app.example.org/', 'https://bad.example'] },
        account_salt: this.salt,
        ...(this.accountRef ? { account_ref: this.accountRef } : {}),
        limits: this.limits,
      });
    }
    const auth = headers.Authorization ?? '';
    if (!this.tokens.has(auth.replace(/^Bearer /, ''))) return response(401, { error: { code: 'token_invalid' } });
    if (path === '/plan' && init.method === 'GET') {
      const ask: PlanAsked = {
        provider: u.searchParams.get('provider') ?? '',
        reason: (u.searchParams.get('reason') ?? 'timer') as Reason,
        client: u.searchParams.get('client'),
        signin: readSignIn(u.searchParams.getAll('signin')),
        version: u.searchParams.get('version'),
      };
      this.asked.push(ask);
      if (ask.signin) this.signins.push({ via: 'plan', signin: ask.signin });
      if (this.disconnected) return response(200, { due: false, disconnected: true });
      const plan = this.opts.plan
        ? this.opts.plan(ask, this)
        : { due: true, plan_id: `pl_${++this.seq}`, known_ids: this.known(), rounds: true, round_shots: true, max_sessions: 40 };
      return response(200, { ...(this.accountRef ? { account_ref: this.accountRef } : {}), ...plan });
    }
    if (path === '/test-scenario' && init.method === 'GET' && this.opts.tests !== false) {
      const code = headers['X-Test-Code'];
      if (!code || !/^[0-9A-Za-z-]{6,64}$/.test(code)) return response(400, { error: { code: 'bad_request', message: 'No test code.' } });
      if (!this.testAccount) return response(403, { error: { code: 'not_test_account', message: 'No test account.' } });
      if (this.expiredCodes.has(code)) return response(410, { error: { code: 'code_expired', message: 'The test is over.' } });
      const scenario = this.scenarios.get(code);
      if (scenario === undefined) return response(404, { error: { code: 'code_invalid', message: 'No such code.' } });
      return response(200, scenario);
    }
    if (path === '/import' && init.method === 'POST') {
      const body = init.body ?? '';
      if (new TextEncoder().encode(body).length > this.limits.max_bytes) return response(413, { error: { code: 'too_large' } });
      let data: unknown;
      try {
        data = JSON.parse(body);
      } catch {
        return response(400, { error: { code: 'bad_request' } });
      }
      const v = validateBatch(data);
      if (!v.ok) return response(422, { error: { code: 'invalid_batch', message: JSON.stringify(v.errors).slice(0, 400) } });
      const batch = v.batch;
      if (this.disconnected) return response(409, { error: { code: 'disconnected' } });
      if (this.accountRef && batch.account_ref !== this.accountRef) return response(409, { error: { code: 'other_account' } });
      if (batch.test && !this.testAccount) return response(403, { error: { code: 'test_data', message: 'Test data only for a test account.' } });
      if (batch.sessions.length > this.limits.max_sessions || batch.rounds.length > this.limits.max_rounds) {
        return response(413, { error: { code: 'too_large' } });
      }
      this.accountRef ??= batch.account_ref;
      this.imports.push(batch);
      let sessions = 0;
      let shots = 0;
      let rounds = 0;
      let roundShots = 0;
      let duplicates = 0;
      for (const s of batch.sessions) {
        if (this.sessions.has(s.external_id)) duplicates += 1;
        else {
          this.sessions.set(s.external_id, s);
          sessions += 1;
          shots += s.shots.length;
        }
      }
      for (const r of batch.rounds) {
        const had = this.rounds.get(r.external_id);
        if (had && !(r.shots && !had.shots)) duplicates += 1;
        else {
          if (!had) rounds += 1;
          this.rounds.set(r.external_id, { ...had, ...r });
          if (r.shots) roundShots += 1;
        }
      }
      return response(200, { sessions, shots, rounds, round_shots: roundShots, duplicates });
    }
    if (path === '/known' && init.method === 'GET') return response(200, { external_ids: this.known() });
    if (path === '/status' && init.method === 'GET') {
      const signin = readSignIn(u.searchParams.getAll('signin'));
      if (signin) this.signins.push({ via: 'status', signin });
      return response(200, { target: { name: this.name }, connected: !this.disconnected, provider: 'demo' });
    }
    // The wake (1.9.0): kept per token, as a target keeps it; `opts.wake === false` is a target without one.
    if (path === '/wake' && this.opts.wake !== false) {
      const token = auth.replace(/^Bearer /, '');
      if (init.method === 'PUT') {
        if (this.disconnected) return response(409, { error: { code: 'disconnected' } });
        const reg = readWake(JSON.parse(init.body ?? 'null'));
        if (!reg) return response(400, { error: { code: 'bad_request' } });
        this.wakes.set(token, reg);
        return response(204, '');
      }
      if (init.method === 'DELETE') {
        this.wakes.delete(token);
        return response(204, '');
      }
    }
    if (path === '/token' && init.method === 'DELETE') {
      this.wakes.delete(auth.replace(/^Bearer /, ''));
      this.tokens.delete(auth.replace(/^Bearer /, ''));
      return response(204, '');
    }
    return response(404, { error: { code: 'bad_request' } });
  };
}
export * from './hcp.ts';
export * from './pro.ts';
