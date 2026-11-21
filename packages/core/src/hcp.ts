// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap target API (spec/hcp.md, spec/api/hcp-api.yaml): pairing for an import token, the plan, a dgvhcp/1
 * batch, the status, disconnecting. Kept apart from the launch monitor API (target.ts): its own pairing (no
 * `return_prefixes`, other limits), its own plan (`cards_have`), its own result - and a token of one never calls
 * the other.
 *
 * As there, the target is untrusted: every answer is read field by field, a value of the wrong kind is dropped,
 * and an answer that isn't one is `bad_answer`. The import token goes to its target and nowhere else.
 */

import { validTarget, type Reason } from '@glmsync/spec';
import { ACCOUNT_REF, CLIENT_KINDS, PROVIDER_ID, type ClientKind } from './api.ts';
import { TargetError } from './errors.ts';
import { defaultFetch, parseJson, type FetchLike } from './http.ts';
import { call, errorOf, trimBase } from './target.ts';
import { when } from './values.ts';

/** A dgvhcp/1 batch as a client builds it (the schema, spec/hcp/dgvhcp-1.schema.json, is the authority). */
export interface HcpBatch {
  format: 'dgvhcp/1';
  provider: string;
  account_ref: string;
  generated_at: string;
  generator?: { name: string; version?: string };
  sync?: { plan_id?: string; reason?: Reason };
  sheet: 'history' | 'scoring' | 'mixed';
  index?: { value: number; as_of: string; low?: number };
  results: HcpResult[];
  notice?: { code: 'signed_out' | 'guard_limit' | 'partial' | 'changed_page'; message?: string };
}

/** One result in the field names of dgvhcp/1; only what the record gives (never null). */
export interface HcpResult {
  played_on: string;
  ref?: string;
  name?: string;
  club_name?: string;
  club_no?: string;
  course_no?: string;
  country?: string;
  round_no?: number;
  holes_read?: 9 | 18;
  kind?: 'tournament' | 'private' | 'foreign' | 'adjustment';
  hcp_relevant?: boolean;
  status?: 'TA' | 'NA' | 'NRA' | 'NRO' | 'DQA' | 'DQO';
  format?: 'single' | 'rpr';
  art?: 'Z' | 'S' | 'H' | 'P' | 'G';
  tee?: string;
  par?: number;
  cr?: number;
  slope?: number;
  hcp_index?: number;
  ch?: number;
  ph?: number;
  gbe?: number;
  stableford_net?: number;
  sd?: number;
  pcc?: number;
  exceptional?: number;
  counting?: boolean;
  place?: number;
  field?: number;
}

export interface HcpLimits {
  max_bytes: number;
  max_results: number;
}

/** What a client keeps of a pairing with a handicap target: like a password (the token). */
export interface HcpPairing {
  base: string;
  token: string;
  provider: string;
  target: { name: string };
  account_salt: string;
  account_ref?: string;
  limits: HcpLimits;
  paired_at: string;
}

export interface HcpPlan {
  due: boolean;
  busy?: boolean;
  disconnected?: boolean;
  account_ref?: string;
  plan_id?: string;
  lease_until?: string;
  cards_have: string[];
  max_cards?: number;
  last_import_at?: string;
}

export interface HcpImportResult {
  read: number;
  new: number;
  changed: number;
  same: number;
  skipped: number;
  failed: number;
}

export interface HcpStatus {
  connected: boolean;
  name: string;
  account_ref?: string;
}

/** Never more than the schema allows in one batch, whatever a target says. */
export const HCP_MAX_RESULTS = 500;
/** A batch below this can't carry one result: a target naming less is no target to talk to. */
const MIN_BYTES = 4096;
const MAX_CARDS_HAVE = 5000;

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown, lo: number, hi: number): string | null => (typeof v === 'string' && v.length >= lo && v.length <= hi ? v : null);
const count = (v: unknown, lo = 0): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo ? v : null);

export function readHcpLimits(data: unknown): HcpLimits | null {
  const l = obj(data);
  const bytes = count(l?.max_bytes, 1);
  const results = count(l?.max_results, 1);
  if (bytes === null || results === null || bytes < MIN_BYTES) return null;
  return { max_bytes: bytes, max_results: Math.min(results, HCP_MAX_RESULTS) };
}

/** The answer to POST /pair, or null when it isn't one. */
export function readHcpPairing(data: unknown, base: string, provider: string, now: number): HcpPairing | null {
  const p = obj(data);
  const token = str(p?.token, 32, 256);
  const salt = str(p?.account_salt, 16, 128);
  const name = str(obj(p?.target)?.name, 1, 100);
  const limits = readHcpLimits(p?.limits);
  if (!p || !token || !salt || !name || !limits) return null;
  const out: HcpPairing = { base, token, provider, target: { name }, account_salt: salt, limits, paired_at: new Date(now).toISOString() };
  if (typeof p.account_ref === 'string' && ACCOUNT_REF.test(p.account_ref)) out.account_ref = p.account_ref;
  return out;
}

export function readHcpPlan(data: unknown): HcpPlan {
  const p = obj(data);
  const plan: HcpPlan = { due: p?.due === true, cards_have: [] };
  if (!p) return plan;
  if (p.busy === true) {
    plan.busy = true;
    plan.due = false; // another client holds the lease: never both
  }
  if (p.disconnected === true) {
    plan.disconnected = true;
    plan.due = false;
  }
  if (typeof p.account_ref === 'string' && ACCOUNT_REF.test(p.account_ref)) plan.account_ref = p.account_ref;
  const id = str(p.plan_id, 1, 200);
  if (id) plan.plan_id = id;
  const lease = when(p.lease_until);
  if (lease) plan.lease_until = lease;
  const last = when(p.last_import_at);
  if (last) plan.last_import_at = last;
  if (Array.isArray(p.cards_have)) {
    plan.cards_have = p.cards_have.slice(0, MAX_CARDS_HAVE).filter((c): c is string => typeof c === 'string' && c.length >= 1 && c.length <= 100);
  }
  const max = count(p.max_cards);
  if (max !== null) plan.max_cards = max;
  return plan;
}

export function readHcpImportResult(data: unknown): HcpImportResult | null {
  const r = obj(data);
  if (!r) return null;
  const keys = ['read', 'new', 'changed', 'same', 'skipped', 'failed'] as const;
  const out: Partial<HcpImportResult> = {};
  for (const k of keys) {
    const v = count(r[k]);
    if (v === null) return null;
    out[k] = v;
  }
  return out as HcpImportResult;
}

export function readHcpStatus(data: unknown): HcpStatus | null {
  const s = obj(data);
  const name = str(obj(s?.target)?.name, 1, 100);
  if (!s || !name || typeof s.connected !== 'boolean') return null;
  const out: HcpStatus = { connected: s.connected, name };
  if (typeof s.account_ref === 'string' && ACCOUNT_REF.test(s.account_ref)) out.account_ref = s.account_ref;
  return out;
}

export interface HcpPairOptions {
  target: string;
  code: string;
  provider: string;
  client: { kind: ClientKind; name: string; version?: string };
  fetch?: FetchLike;
  signal?: AbortSignal;
  now?: () => number;
}

/** POST /pair of a handicap target: a pairing code for an import token. Keep the result like a password. */
export async function pairHcp(opts: HcpPairOptions): Promise<HcpPairing> {
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
    { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ code: opts.code, provider: opts.provider, client }) },
    { signal: opts.signal, now },
  );
  if (x.status !== 200) throw errorOf(x);
  const pairing = readHcpPairing(parseJson(x.body), base, opts.provider, now());
  if (!pairing) throw new TargetError('bad_answer', 'The target answered the pairing with something else.');
  return pairing;
}

/** A paired handicap target, spoken to with its import token. */
export class HcpTarget {
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(
    readonly pairing: HcpPairing,
    opts: { fetch?: FetchLike; now?: () => number } = {},
  ) {
    if (!validTarget(pairing.base)) throw new TargetError('bad_request', 'Not a target address this client talks to.');
    this.fetchImpl = opts.fetch ?? defaultFetch();
    this.now = opts.now ?? Date.now;
  }

  private send(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Accept: 'application/json', Authorization: `Bearer ${this.pairing.token}` };
    const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return call(this.fetchImpl, `${trimBase(this.pairing.base)}${path}`, init, { now: this.now });
  }

  async plan(reason: Reason, client: ClientKind): Promise<HcpPlan> {
    const x = await this.send('GET', `/plan?${new URLSearchParams({ reason, client }).toString()}`);
    if (x.status !== 200) throw errorOf(x);
    const body = parseJson(x.body);
    if (!obj(body)) throw new TargetError('bad_answer', 'The target answered the plan with something else.');
    return readHcpPlan(body);
  }

  async import(batch: HcpBatch): Promise<HcpImportResult> {
    const x = await this.send('POST', '/import', batch);
    if (x.status !== 200) throw errorOf(x);
    const result = readHcpImportResult(parseJson(x.body));
    if (!result) throw new TargetError('bad_answer', 'The target answered the import with something else.');
    return result;
  }

  async status(): Promise<HcpStatus> {
    const x = await this.send('GET', '/status');
    if (x.status !== 200) throw errorOf(x);
    const status = readHcpStatus(parseJson(x.body));
    if (!status) throw new TargetError('bad_answer', 'The target answered the status with something else.');
    return status;
  }

  /** DELETE /token: this client disconnects itself. A token already gone counts as revoked. */
  async revoke(): Promise<void> {
    const x = await this.send('DELETE', '/token');
    if (x.status === 204 || x.status === 200 || x.status === 401) return;
    throw errorOf(x);
  }
}
