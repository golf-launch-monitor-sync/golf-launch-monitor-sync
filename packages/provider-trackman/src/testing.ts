// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A made-up Trackman for tests (here and in the clients' click checks): it answers the queries of
 * queries.ts in Trackman's shapes, from synthetic data it is given, and records every request. It is
 * invented for the tests - nothing here was recorded from a real account - and reaches no network.
 */

import type { FetchLike, ResponseLike } from '@glmsync/core';
import { GRAPHQL_URL } from './client.ts';

export type Json = Record<string, unknown>;

export interface TrackmanRequest {
  /** The query's name: Activities, Session, Rounds, RoundShots, Who, Profile. */
  name: string;
  variables: Json;
  token: string;
  at: number;
  headers: Record<string, string>;
  credentials: string | undefined;
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): ResponseLike {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, headers: { get: (n) => headers[n] ?? headers[n.toLowerCase()] ?? null }, text: async () => text };
}

/** A token Trackman would hand out: a JWT whose payload carries `sub` (not signed; nobody checks here). */
export function fakeToken(sub: string, extra: Json = {}): string {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify({ sub, ...extra }))}.sig`;
}

export class FakeTrackman {
  /** Newest first, as Trackman lists them. */
  activities: Json[] = [];
  /** Each session's node by activity id; missing: an empty one. */
  nodes = new Map<string, unknown>();
  /** Scorecards, newest first; `holes` only in the RoundShots answer when `shotHoles` has them. */
  scorecards: Json[] = [];
  shotHoles = new Map<string, unknown>();
  profile: Json = { fullName: 'Test Player' };
  tokens = new Set<string>();
  readonly requests: TrackmanRequest[] = [];
  /** Answer a query with something else (a status, a broken body), once per call. */
  override?: (req: TrackmanRequest) => ResponseLike | Error | null;

  constructor(readonly now: () => number = Date.now) {}

  count(name?: string): number {
    return name ? this.requests.filter((r) => r.name === name).length : this.requests.length;
  }

  fetch: FetchLike = async (url, init) => {
    if (url !== GRAPHQL_URL) throw new TypeError(`not Trackman: ${url}`);
    const body = JSON.parse(init.body ?? '{}') as { query?: string; variables?: Json };
    const name = /query (\w+)/.exec(body.query ?? '')?.[1] ?? '?';
    const token = (init.headers.Authorization ?? '').replace(/^Bearer /, '');
    const req: TrackmanRequest = { name, variables: body.variables ?? {}, token, at: this.now(), headers: init.headers, credentials: init.credentials };
    this.requests.push(req);
    const o = this.override?.(req);
    if (o instanceof Error) throw o;
    if (o) return o;
    if (!this.tokens.has(token)) return respond(401, { errors: [{ message: 'Unauthorized' }] });
    const v = req.variables;
    const skip = Number(v.skip ?? 0);
    const take = Number(v.take ?? 100);
    switch (name) {
      case 'Activities': {
        const from = typeof v.timeFrom === 'string' ? Date.parse(v.timeFrom) : -Infinity;
        const all = this.activities.filter((a) => !(Date.parse(String(a.time)) < from));
        return respond(200, { data: { me: { activities: { totalCount: all.length, items: all.slice(skip, skip + take) } } } });
      }
      case 'Session': {
        const node = this.nodes.has(String(v.id)) ? this.nodes.get(String(v.id)) : { __typename: 'SimulatorSessionActivity', strokes: [] };
        return respond(200, { data: { node } });
      }
      case 'Rounds':
        return respond(200, { data: { me: { scorecards: this.scorecards.slice(skip, skip + take) } } });
      case 'RoundShots':
        return respond(200, {
          data: {
            me: {
              scorecards: this.scorecards.slice(skip, skip + take).map((sc) => ({
                id: sc.id,
                startedAt: sc.startedAt,
                createdAt: sc.createdAt,
                holes: this.shotHoles.has(String(sc.id)) ? this.shotHoles.get(String(sc.id)) : [],
              })),
            },
          },
        });
      case 'Who':
        return respond(200, {
          data: { me: { profile: this.profile, activities: { totalCount: this.activities.length, items: this.activities.slice(0, 1) } } },
        });
      case 'Profile':
        return respond(200, { data: { me: { profile: this.profile } } });
      default:
        return respond(400, { errors: [{ message: 'Unknown query' }] });
    }
  };
}

export { respond };
