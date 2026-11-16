// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The click checks' world: everything the browser would reach on the network, answered in the test
 * instead - the web app from its build, a made-up Trackman portal and API, and a made-up target app.
 * Nothing leaves the machine; all data is synthetic.
 */

import type { BrowserContext, Route } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../packages/core/src/http.ts';
import { FakeTarget } from '../../packages/core/src/testing/index.ts';
import { GRAPHQL_URL } from '../../packages/provider-trackman/src/client.ts';
import { FakeTrackman, fakeToken } from '../../packages/provider-trackman/src/testing.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WEB_DIST = join(ROOT, 'apps', 'web', 'dist');
export const WEB = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync';
export const PORTAL = 'https://portal.trackmangolf.com/';
export const TARGET = 'https://app.example.org/lm/v1';
export const CODE = 'K7M2PQ9X';

export function pairUrl(target = TARGET, code = CODE): string {
  return `${WEB}/pair#target=${encodeURIComponent(target)}&code=${code}`;
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function canonical(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase().replace(/(^|-)([a-z])/g, (_, d: string, c: string) => d + c.toUpperCase())] = v;
  return out;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

/** Answers a request with a fake's `fetch` (the target API, Trackman's GraphQL). */
async function answer(route: Route, fetchImpl: FetchLike): Promise<void> {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = req.postData();
  try {
    const res = await fetchImpl(req.url(), { method: req.method(), headers: canonical(await req.allHeaders()), ...(body !== null ? { body } : {}) });
    const retry = res.headers.get('Retry-After');
    return route.fulfill({ status: res.status, body: await res.text(), headers: { 'content-type': 'application/json', ...CORS, ...(retry ? { 'retry-after': retry } : {}) } });
  } catch {
    return route.abort('connectionfailed');
  }
}

export interface Portal {
  /** The key the made-up portal holds (null: signed out). */
  token: string | null;
  /** Where it keeps it: in storage, or only in its calls to the API. */
  mode: 'storage' | 'fetch';
}

export class World {
  readonly tm = new FakeTrackman();
  readonly target = new FakeTarget({ base: TARGET });
  readonly portal: Portal = { token: null, mode: 'storage' };

  constructor() {
    this.tm.profile = { fullName: 'Alex Example' };
    this.tm.activities = [
      { id: 'S2', time: '2026-11-15T17:00:00Z', kind: 'RANGE_PRACTICE', location: { name: 'Example Range' } },
      { id: 'S1', time: '2026-11-12T17:00:00Z', kind: 'SIMULATOR' },
    ];
    for (const a of this.tm.activities) {
      this.tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', time: a.time, measurement: { carry: 140, ballSpeed: 50 } }, { club: 'Driver', time: a.time, measurement: { carry: 210, ballSpeed: 68 } }] });
    }
  }

  /** A key for `sub`, good for a week, that the made-up Trackman takes. */
  key(sub = 'player-0001', hours = 24 * 7): string {
    const t = fakeToken(sub, { exp: Math.round(Date.now() / 1000 + hours * 3600), iss: 'https://login.trackmangolf.com' });
    this.tm.tokens.add(t);
    return t;
  }

  /** The made-up portal: a page that keeps its key in storage, or sends it with its first call. */
  private portalPage(): string {
    const token = JSON.stringify(this.portal.token);
    const script =
      this.portal.mode === 'storage'
        ? `if (${token}) localStorage.setItem('session', JSON.stringify({ user: { access_token: ${token} } })); else localStorage.clear();`
        : `localStorage.clear(); if (${token}) fetch('https://api.trackmangolf.com/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + ${token}, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query Profile { me { profile { fullName } } }' }) });`;
    return `<!doctype html><html><head><title>Portal</title></head><body><h1>Made-up portal</h1><script>${script}</script></body></html>`;
  }

  async route(context: BrowserContext): Promise<void> {
    // Anything not answered below never reaches a network (Playwright tries the routes added last first).
    await context.route((url) => url.protocol === 'http:' || url.protocol === 'https:', (route) => route.abort('blockedbyclient'));
    await context.route(`${WEB}/**`, (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/golf-launch-monitor-sync/, '') || '/';
      let file = path.endsWith('/') ? `${path}index.html` : path;
      if (!extname(file)) file += '.html';
      const full = normalize(join(WEB_DIST, file));
      if (!full.startsWith(WEB_DIST) || !existsSync(full)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, body: readFileSync(full), headers: { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream' } });
    });
    await context.route('https://portal.trackmangolf.com/**', (route) => route.fulfill({ status: 200, body: this.portalPage(), headers: { 'content-type': 'text/html' } }));
    await context.route(`${GRAPHQL_URL}*`, (route) => answer(route, this.tm.fetch));
    await context.route('https://app.example.org/**', (route) => answer(route, this.target.fetch));
  }

  /** Every request that reached the made-up target, as text: a Trackman key must never be in it. */
  targetSaw(): string {
    return JSON.stringify(this.target.received);
  }
}
