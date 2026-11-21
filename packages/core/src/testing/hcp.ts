// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * For tests: a made-up handicap target (spec/api/hcp-api.yaml) in memory. It plans like the reference (`manual`
 * always due), keeps one account per connection, and merges a result that comes again into the one it has - by its
 * day, holes, rating and score, as a target finds it without trusting a client's ids - so a test can see that pages
 * sent one by one end as one result each. Nothing here reaches a network.
 */

import type { FetchLike } from '../http.ts';
import type { HcpBatch, HcpResult } from '../hcp.ts';
import { response, type Received } from './index.ts';

export interface FakeHcpTargetOptions {
  base?: string;
  name?: string;
  limits?: { max_bytes: number; max_results: number };
  /** A status to answer a path with instead (e.g. { '/import': 503 }). */
  fail?: Record<string, { status: number; body?: unknown }>;
}

/** Which result a target takes a result for: its day, holes, rating and slope, and score. */
export function resultKey(r: HcpResult): string {
  const score = r.status === 'NA' ? 'na' : r.gbe ? `g${r.gbe}` : r.stableford_net !== undefined ? `s${r.stableford_net}` : 'x';
  return [r.played_on, r.holes_read ?? r.par ?? '', `${r.cr ?? ''}/${r.slope ?? ''}`, score, r.round_no && r.round_no > 1 ? `r${r.round_no}` : ''].join('|');
}

export class FakeHcpTarget {
  readonly base: string;
  readonly name: string;
  readonly limits: { max_bytes: number; max_results: number };
  readonly codes = new Set<string>(['H7M2PQ9X']);
  readonly tokens = new Set<string>();
  readonly received: Received[] = [];
  readonly imports: HcpBatch[] = [];
  readonly plans: { reason: string | null; client: string | null }[] = [];
  /** What it keeps: one result per key, merged. */
  readonly results = new Map<string, HcpResult>();
  index: HcpBatch['index'] | null = null;
  notice: HcpBatch['notice'] | null = null;
  accountRef: string | null = null;
  disconnected = false;
  salt = 'fake-hcp-salt-000001';
  private seq = 0;

  constructor(readonly opts: FakeHcpTargetOptions = {}) {
    this.base = opts.base ?? 'https://app.example.org/hcp/v1';
    this.name = opts.name ?? 'Example App';
    this.limits = opts.limits ?? { max_bytes: 2_097_152, max_results: 500 };
  }

  fetch: FetchLike = async (url, init) => {
    const method = init.method.toUpperCase();
    const headers = init.headers;
    this.received.push({ method, url, headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    if (!url.startsWith(`${this.base}/`)) return response(404, { error: { code: 'bad_request', message: 'not here' } });
    const u = new URL(url);
    const path = u.pathname.slice(new URL(this.base).pathname.length);
    const fail = this.opts.fail?.[path];
    if (fail) return response(fail.status, fail.body ?? { error: { code: 'unavailable', message: 'down' } });
    if (path === '/pair' && method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as { code?: string; provider?: string };
      if (body.provider !== 'golfde') return response(400, { error: { code: 'provider_unknown', message: 'no' } });
      if (!body.code || !this.codes.has(body.code)) return response(404, { error: { code: 'code_invalid', message: 'no' } });
      this.codes.delete(body.code);
      const token = `hcp-token-${++this.seq}-${'x'.repeat(32)}`;
      this.tokens.add(token);
      return response(200, { token, target: { name: this.name }, account_salt: this.salt, limits: this.limits, ...(this.accountRef ? { account_ref: this.accountRef } : {}) });
    }
    const auth = headers.Authorization ?? headers.authorization ?? '';
    if (!this.tokens.has(auth.replace(/^Bearer /, ''))) return response(401, { error: { code: 'token_invalid', message: 'no' } });
    if (path === '/plan' && method === 'GET') {
      this.plans.push({ reason: u.searchParams.get('reason'), client: u.searchParams.get('client') });
      if (this.disconnected) return response(200, { due: false, disconnected: true });
      return response(200, { due: u.searchParams.get('reason') === 'manual', plan_id: `hp_${++this.seq}`, cards_have: [], max_cards: 20, ...(this.accountRef ? { account_ref: this.accountRef } : {}) });
    }
    if (path === '/import' && method === 'POST') {
      if (this.disconnected) return response(409, { error: { code: 'disconnected', message: 'ended' } });
      const b = JSON.parse(init.body ?? '{}') as HcpBatch;
      if (b.format !== 'dgvhcp/1' || !Array.isArray(b.results)) return response(422, { error: { code: 'invalid_batch', message: 'no' } });
      if (b.results.length > this.limits.max_results || (init.body ?? '').length > this.limits.max_bytes) return response(413, { error: { code: 'too_large', message: 'no' } });
      if (this.accountRef && this.accountRef !== b.account_ref) return response(409, { error: { code: 'other_account', message: 'no' } });
      this.accountRef ??= b.account_ref;
      this.imports.push(b);
      let fresh = 0;
      let changed = 0;
      let same = 0;
      for (const r of b.results) {
        const k = resultKey(r);
        const had = this.results.get(k);
        const next = { ...had, ...r };
        if (!had) fresh += 1;
        else if (JSON.stringify(had) === JSON.stringify(next)) same += 1;
        else changed += 1;
        this.results.set(k, next);
      }
      if (b.index) this.index = b.index;
      this.notice = b.notice ?? null;
      return response(200, { read: b.results.length, new: fresh, changed, same, skipped: 0, failed: 0 });
    }
    if (path === '/status' && method === 'GET') return response(200, { target: { name: this.name }, connected: !this.disconnected, ...(this.accountRef ? { account_ref: this.accountRef } : {}) });
    if (path === '/token' && method === 'DELETE') {
      this.tokens.delete(auth.replace(/^Bearer /, ''));
      return response(204, '');
    }
    return response(404, { error: { code: 'bad_request', message: 'no such path' } });
  };
}
