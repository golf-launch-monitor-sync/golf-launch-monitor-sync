// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * For tests: a made-up target of kind `pro` (a pro's own pages, spec/prores.md) in memory, speaking the handicap target
 * API: it pairs provider `pro`, plans `manual` as due, keeps one page per site (`other_account` for another), and asks
 * about a page whose name isn't its player's (`other_player`) until the batch says the player confirmed it. Nothing here
 * reaches a network.
 */

import type { ProresBatch } from '@glmsync/spec';
import type { FetchLike } from '../http.ts';
import { response, type Received } from './index.ts';

export class FakeProTarget {
  readonly base: string;
  readonly received: Received[] = [];
  readonly imports: ProresBatch[] = [];
  readonly tokens = new Set<string>();
  readonly codes = new Set<string>(['P7M2PQ9X']);
  readonly accounts = new Map<string, string>();
  readonly plans: string[] = [];
  readonly salt = 'fake-pro-salt-0000001';
  /** The player's name as this app knows it. */
  player = 'Max Mustermann';
  due = true;
  disconnected = false;
  /** A status to answer an import with instead. */
  fail: number | null = null;

  constructor(opts: { base?: string } = {}) {
    this.base = opts.base ?? 'https://app.example.org/hcp/v1';
  }

  fetch: FetchLike = async (url, init) => {
    this.received.push({ method: init.method.toUpperCase(), url, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    if (!url.startsWith(`${this.base}/`)) return response(404, { error: { code: 'bad_request', message: 'not here' } });
    const u = new URL(url);
    const path = u.pathname.slice(new URL(this.base).pathname.length);
    if (path === '/pair') {
      const b = JSON.parse(init.body ?? '{}') as { code?: string; provider?: string };
      if (b.provider !== 'pro') return response(400, { error: { code: 'provider_unknown', message: 'no' } });
      if (!b.code || !this.codes.has(b.code)) return response(404, { error: { code: 'code_invalid', message: 'no' } });
      this.codes.delete(b.code);
      const token = `pro-token-${this.tokens.size + 1}-${'x'.repeat(32)}`;
      this.tokens.add(token);
      return response(200, { token, target: { name: 'Example App' }, account_salt: this.salt, limits: { max_bytes: 2_097_152, max_results: 500 } });
    }
    const auth = init.headers.Authorization ?? init.headers.authorization ?? '';
    if (!this.tokens.has(auth.replace(/^Bearer /, ''))) return response(401, { error: { code: 'token_invalid', message: 'no' } });
    if (path === '/plan') {
      this.plans.push(u.searchParams.get('reason') ?? '');
      if (this.disconnected) return response(200, { due: false, disconnected: true });
      return response(200, { due: this.due, plan_id: `pp_${this.plans.length}`, cards_have: [] });
    }
    if (path === '/token') {
      this.tokens.delete(auth.replace(/^Bearer /, ''));
      return response(204, '');
    }
    if (path === '/status') return response(200, { target: { name: 'Example App' }, connected: !this.disconnected });
    if (path === '/import') {
      if (this.fail) return response(this.fail, { error: { code: 'unavailable', message: 'down' } });
      const b = JSON.parse(init.body ?? '{}') as ProresBatch;
      if (b.format !== 'prores/1' || b.provider !== 'pro') return response(400, { error: { code: 'bad_request', message: 'not a pro batch' } });
      const had = this.accounts.get(b.site);
      if (had && had !== b.account_ref) return response(409, { error: { code: 'other_account', message: 'another page' } });
      if (b.player.name.toLowerCase() !== this.player.toLowerCase() && b.player.confirmed !== true) {
        return response(409, { error: { code: 'other_player', message: 'ask the player' } });
      }
      this.accounts.set(b.site, b.account_ref);
      this.imports.push(b);
      return response(200, { read: 0, new: 0, changed: 0, same: 0, skipped: 0, failed: 0, errors: [] });
    }
    return response(404, { error: { code: 'bad_request', message: 'no' } });
  };
}
