// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Targets: where a sync's data goes. `HttpTarget` speaks the target API (spec/target-api.md) with
 * the import token from pairing; `FileTarget` (file.ts) writes a file. Both plan: a client never
 * fetches from a provider without a plan that says so.
 *
 * The import token goes to the target and nowhere else; the provider's sign-in never goes to a
 * target - no request here carries it.
 */

import {
  readTestScenario,
  readWake,
  TEST_CODE,
  TEST_CODE_HEADER,
  TEST_SCENARIO_MAX_BYTES,
  validTarget,
  type Batch,
  type Reason,
  type SignIn,
  type TestScenario,
  type WakeRegistration,
} from '@glmsync/spec';
import {
  CAN,
  CLIENT_KINDS,
  PROVIDER_ID,
  readImportResult,
  readPairing,
  readPlan,
  readStatus,
  type Can,
  type ClientKind,
  type ImportLimits,
  type ImportResult,
  type Pairing,
  type Plan,
  type TargetStatus,
} from './api.ts';
import { TargetError, type TargetErrorCode } from './errors.ts';
import { defaultFetch, exchange, parseJson, TransportError, type Exchanged, type FetchLike } from './http.ts';
import { utf8Length } from './sha256.ts';
import { externalId } from './values.ts';

/** A scenario may be large (up to 64 MiB): it gets longer than an ordinary answer to arrive. */
export const TEST_SCENARIO_TIMEOUT_MS = 120_000;

/** What a sync needs of a target. */
export interface Target {
  /** Shown in the client ("connected with …"). */
  readonly name: string;
  /** The salt of `account_ref` (spec/olmd.md). */
  readonly salt: string;
  readonly limits: ImportLimits;
  /**
   * Takes the parts of a sync while it still fetches (LMS-AS-6): a target behind the target API, which counts them as
   * they come. A file wants one file per sync, not one per part.
   */
  readonly takesEarlyParts?: boolean;
  /**
   * Whether to fetch now, and what. Asked before anything is asked of a provider. `signin` (1.5.0): where
   * the client's provider sign-in stands, for the target app to show; it changes no plan. `can` (1.20.0): the parts of
   * a plan this client's provider can do beyond earlier versions, so a target plans them (target-api.md, *What a
   * client can*).
   */
  plan(provider: string, reason: Reason, client: ClientKind, signin?: SignIn, can?: readonly Can[], version?: string): Promise<Plan>;
  /** One batch, within `limits`. */
  import(batch: Batch): Promise<ImportResult>;
}

const CODES: ReadonlySet<string> = new Set([
  'bad_request', 'code_invalid', 'token_invalid', 'other_account', 'disconnected', 'too_large', 'invalid_batch',
  'rate_limited', 'provider_unknown', 'test_data', 'test_unavailable', 'not_test_account', 'code_expired',
  'other_player', 'account_inactive', 'wrong_token', 'calendar_full', 'invalid_event', 'too_old', 'too_far_ahead',
]);

/** A target's answer that is no success, as a `TargetError` (shared with the handicap target API, hcp.ts). */
export function errorOf(x: Exchanged): TargetError {
  const body = parseJson(x.body) as { error?: { code?: unknown; message?: unknown } } | undefined;
  const said = body?.error?.code;
  const message = typeof body?.error?.message === 'string' ? body.error.message.slice(0, 500) : `HTTP ${x.status}`;
  let code: TargetErrorCode;
  if (typeof said === 'string' && CODES.has(said)) code = said as TargetErrorCode;
  else if (x.status === 401) code = 'token_invalid';
  else if (x.status === 404) code = 'code_invalid';
  else if (x.status === 410) code = 'code_expired';
  else if (x.status === 413) code = 'too_large';
  else if (x.status === 422) code = 'invalid_batch';
  else if (x.status === 429) code = 'rate_limited';
  else if (x.status >= 500) code = 'unavailable';
  else code = 'bad_request';
  // Whatever the body says, a 401 is a token that no longer works, a 429 a wait, a 5xx a target
  // having a moment.
  if (x.status === 401) code = 'token_invalid';
  if (x.status === 429) code = 'rate_limited';
  if (x.status >= 500) code = 'unavailable';
  return new TargetError(code, message, x.status, x.retryAfterS);
}

/** One request to a target: what goes wrong on the way is a `TargetError` (shared with hcp.ts). */
export async function call(
  fetchImpl: FetchLike,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  opts: { signal?: AbortSignal | undefined; now?: () => number; maxBytes?: number; timeoutMs?: number },
): Promise<Exchanged> {
  try {
    return await exchange(fetchImpl, url, init, opts);
  } catch (e) {
    if (e instanceof TransportError) {
      throw new TargetError(e.kind === 'too_big' ? 'bad_answer' : 'unreachable', `The target: ${e.message}`);
    }
    throw e;
  }
}

export const trimBase = (base: string) => base.replace(/\/+$/, '');

/** What a client's version may look like on the wire (a target reads olmd's `generator.version` the same way). */
const CLIENT_VERSION = /^[0-9A-Za-z.+_-]{1,50}$/;

export interface PairOptions {
  /** The target's base URL from the deep link or the pairing page. */
  target: string;
  code: string;
  provider: string;
  client: { kind: ClientKind; name: string; version?: string };
  fetch?: FetchLike;
  signal?: AbortSignal;
  now?: () => number;
}

/** POST /pair: a pairing code for an import token. Keep the result like a password. */
export async function pair(opts: PairOptions): Promise<Pairing> {
  const base = trimBase(opts.target);
  if (!validTarget(opts.target)) throw new TargetError('bad_request', 'Not a target address this client talks to.');
  if (!/^[0-9A-Za-z-]{6,64}$/.test(opts.code)) throw new TargetError('code_invalid', 'Not a pairing code.');
  if (!PROVIDER_ID.test(opts.provider)) throw new TargetError('bad_request', 'Not a provider id.');
  if (!CLIENT_KINDS.includes(opts.client.kind)) throw new TargetError('bad_request', 'Not a client kind.');
  const client: Record<string, string> = { kind: opts.client.kind, name: opts.client.name.slice(0, 100) || 'Golf Stats Sync' };
  if (opts.client.version) client.version = opts.client.version.slice(0, 50);
  const now = opts.now ?? Date.now;
  const x = await call(
    opts.fetch ?? defaultFetch(),
    `${base}/pair`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ code: opts.code, provider: opts.provider, client }),
    },
    { signal: opts.signal, now },
  );
  if (x.status !== 200) throw errorOf(x);
  const pairing = readPairing(parseJson(x.body), base, opts.provider, now());
  if (!pairing) throw new TargetError('bad_answer', 'The target answered the pairing with something else.');
  return pairing;
}

export class HttpTarget implements Target {
  readonly name: string;
  readonly salt: string;
  readonly limits: ImportLimits;
  readonly takesEarlyParts = true;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private readonly signal: AbortSignal | undefined;

  constructor(
    readonly pairing: Pairing,
    opts: { fetch?: FetchLike; now?: () => number; signal?: AbortSignal } = {},
  ) {
    if (!validTarget(pairing.base)) throw new TargetError('bad_request', 'Not a target address this client talks to.');
    this.name = pairing.target.name;
    this.salt = pairing.account_salt;
    this.limits = pairing.limits;
    this.fetchImpl = opts.fetch ?? defaultFetch();
    this.now = opts.now ?? Date.now;
    this.signal = opts.signal;
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    more: { headers?: Record<string, string>; maxBytes?: number; timeoutMs?: number } = {},
  ): Promise<Exchanged> {
    const headers: Record<string, string> = { ...more.headers, Accept: 'application/json', Authorization: `Bearer ${this.pairing.token}` };
    const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return call(this.fetchImpl, `${trimBase(this.pairing.base)}${path}`, init, {
      signal: this.signal,
      now: this.now,
      ...(more.maxBytes !== undefined ? { maxBytes: more.maxBytes } : {}),
      ...(more.timeoutMs !== undefined ? { timeoutMs: more.timeoutMs } : {}),
    });
  }

  async plan(provider: string, reason: Reason, client: ClientKind, signin?: SignIn, can?: readonly Can[], version?: string): Promise<Plan> {
    const q = new URLSearchParams({ provider, reason, client });
    if (signin) q.set('signin', signin);
    const words = CAN.filter((w) => can?.includes(w));
    if (words.length) q.set('can', words.join(','));
    // The client's version (spec 1.22.0), as at pairing: a target that needs a newer one answers `outdated`, and hears
    // the new version with the first plan after the update (a client told it is too old hands over no batch).
    if (version && CLIENT_VERSION.test(version)) q.set('version', version);
    const x = await this.send('GET', `/plan?${q.toString()}`);
    if (x.status !== 200) throw errorOf(x);
    const body = parseJson(x.body);
    if (!body || typeof body !== 'object') throw new TargetError('bad_answer', 'The target answered the plan with something else.');
    return readPlan(body);
  }

  async import(batch: Batch): Promise<ImportResult> {
    const x = await this.send('POST', '/import', batch);
    if (x.status !== 200) throw errorOf(x);
    const result = readImportResult(parseJson(x.body));
    if (!result) throw new TargetError('bad_answer', 'The target answered the import with something else.');
    return result;
  }

  async known(provider: string, since?: string): Promise<string[]> {
    const q = new URLSearchParams({ provider });
    if (since) q.set('since', since);
    const x = await this.send('GET', `/known?${q.toString()}`);
    if (x.status !== 200) throw errorOf(x);
    const body = parseJson(x.body) as { external_ids?: unknown } | undefined;
    if (!body || !Array.isArray(body.external_ids)) throw new TargetError('bad_answer', 'The target answered with something else.');
    return body.external_ids.map((v) => (typeof v === 'string' ? externalId(v) : null)).filter((v): v is string => !!v);
  }

  /** GET /status; `signin` (1.5.0) tells the target where this client's sign-in stands, taking no lease. */
  async status(signin?: SignIn): Promise<TargetStatus> {
    const x = await this.send('GET', signin ? `/status?${new URLSearchParams({ signin }).toString()}` : '/status');
    if (x.status !== 200) throw errorOf(x);
    const status = readStatus(parseJson(x.body));
    if (!status) throw new TargetError('bad_answer', 'The target answered the status with something else.');
    return status;
  }

  /**
   * PUT /wake (1.9.0, spec/wake.md): the push address this target may wake the client at when a plan is due.
   * True when the target keeps it; false when it offers no wake (404, 405, 501), so the client leaves it be for a
   * while. Throws what any other answer says (a revoked token, `disconnected`, the target having a moment).
   */
  async wake(registration: WakeRegistration): Promise<boolean> {
    const reg = readWake(registration);
    if (!reg) throw new TargetError('bad_request', 'Not a wake address this client sends.');
    const x = await this.send('PUT', '/wake', reg);
    if (x.status === 204 || x.status === 200) return true;
    if (x.status === 404 || x.status === 405 || x.status === 501) return false;
    throw errorOf(x);
  }

  /** DELETE /wake (1.9.0): no more wakes for this client. Nothing to forget (or no wake offered) counts as done. */
  async unwake(): Promise<void> {
    const x = await this.send('DELETE', '/wake');
    if ([200, 204, 401, 404, 405, 501].includes(x.status)) return;
    throw errorOf(x);
  }

  /**
   * GET /test-scenario (1.8.0, spec/test-mode.md): the scenario this target hands out for a test code, read strictly.
   * The code goes in its header, never in the address. Throws a `TargetError`: `bad_request` (not a code),
   * `code_invalid` (no scenario for this code and account), `test_unavailable` (the target offers none: any other
   * 404, or a 405/501 of a target that doesn't know the path), `not_test_account`, `code_expired` (410, or a
   * scenario whose `valid_until` has passed), `bad_answer` (no scenario, or larger than 64 MiB), and whatever any
   * other answer says (a revoked token, a wait).
   */
  async testScenario(code: string): Promise<TestScenario> {
    if (typeof code !== 'string' || !TEST_CODE.test(code)) throw new TargetError('bad_request', 'Not a test code.');
    const x = await this.send('GET', '/test-scenario', undefined, {
      headers: { [TEST_CODE_HEADER]: code },
      maxBytes: TEST_SCENARIO_MAX_BYTES,
      timeoutMs: TEST_SCENARIO_TIMEOUT_MS,
    });
    if (x.status === 404 || x.status === 405 || x.status === 501) {
      const said = (parseJson(x.body) as { error?: { code?: unknown } } | undefined)?.error?.code;
      // Only a 404 that says so is a wrong code; any other is a target without scenarios (spec/test-mode.md).
      if (x.status === 404 && said === 'code_invalid') throw new TargetError('code_invalid', 'No scenario for this code.', 404);
      throw new TargetError('test_unavailable', 'This target offers no test scenarios.', x.status);
    }
    if (x.status !== 200) throw errorOf(x);
    if (utf8Length(x.body) > TEST_SCENARIO_MAX_BYTES) throw new TargetError('bad_answer', 'The scenario is too large.');
    const read = readTestScenario(parseJson(x.body), new Date(this.now()).toISOString());
    if (!read.ok) {
      if (read.error === 'expired') throw new TargetError('code_expired', 'The test is over.');
      throw new TargetError('bad_answer', `The target answered with no scenario (${read.error}).`);
    }
    return read.scenario;
  }

  /** DELETE /token: this client disconnects itself. A token already gone counts as revoked. */
  async revoke(): Promise<void> {
    const x = await this.send('DELETE', '/token');
    if (x.status === 204 || x.status === 200 || x.status === 401) return;
    throw errorOf(x);
  }
}
