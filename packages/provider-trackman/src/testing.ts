// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A made-up Trackman: it answers the queries of queries.ts in Trackman's shapes, from synthetic data it is given,
 * and records every request. Invented for the tests and the clients' click checks - nothing here was recorded from a
 * real account - and it reaches no network. Since test mode (spec/test-mode.md) it also runs inside the apps, where
 * `replay` (replay.ts) fills it with a target's scenario: so it uses nothing a phone's engine lacks (no `Buffer`).
 */

import { base64url, utf8, type FetchLike, type ResponseLike } from '@glmsync/core';
import { GRAPHQL_URL } from './client.ts';

export type Json = Record<string, unknown>;

export interface TrackmanRequest {
  /** The query's name: Activities, Session, Rounds, RoundShots, Who, Profile. */
  name: string;
  /** The whole query as sent. */
  query: string;
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
  const b64 = (s: string) => base64url(utf8(s));
  return `${b64('{"alg":"none"}')}.${b64(JSON.stringify({ sub, ...extra }))}.sig`;
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Waits `ms`, or rejects as soon as `signal` aborts (an answer the client stopped waiting for). */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((done, fail) => {
    if (signal?.aborted) return fail(new Error('aborted'));
    if (ms <= 0) return done();
    const onAbort = () => {
      clearTimeout(timer);
      fail(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      done();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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
  /** At most this many requests are kept in `requests` (the oldest go): a fake inside an app runs for days. */
  keep = Number.POSITIVE_INFINITY;
  /** Refuse a round's shots asked for with their ball and club data, without naming a field. */
  refuseMeasured = false;
  /** Fields of a round shot's measurement this fake doesn't know: a query asking any of them is refused, naming each. */
  refuseFields: string[] = [];
  /**
   * How an activity type answers a session's query, by `__typename` (spec 1.20.0): `own` - its strokes come only by
   * its own fragment, the shared interface `SessionActivity` answers it without them (Trackman's tests and combines,
   * as far as a client can tell); `noStrokes` - it has none, and a fragment of its own asking for them is refused (a
   * video); `fields` - the fields its strokes' measurement has, a query asking another is refused naming each.
   * Unlisted: the interface answers it whole, as every type before.
   */
  types = new Map<string, { own?: boolean; noStrokes?: boolean; fields?: string[] }>();
  /** Answer a query with something else (a status, a broken body), once per call. */
  override?: (req: TrackmanRequest) => ResponseLike | Error | null;
  /** How long each answer takes (ms), by the request; none: at once. */
  delay?: (req: TrackmanRequest) => number;
  /**
   * From this moment (ms) every sign-in is refused with 401, as Trackman refuses a key that ran out (spec 1.28.0: a test
   * sign-in handed to a target app runs out at its `expires_at`). None: the keys in `tokens` never run out here.
   */
  expiresAt?: number | undefined;
  /** How it waits for `delay` (tests pass a virtual clock's). */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void> = wait;

  constructor(readonly now: () => number = Date.now) {}

  /**
   * Its answers from data in Trackman's own shapes (a test scenario's `data`, spec/test-mode.md): `activities` and
   * `scorecards` (newest first), `nodes` and `shotHoles` (by id). Untrusted like any answer: what isn't of the shape
   * is left out, never thrown about; the mapping later reads every value as Trackman's own.
   */
  load(data: unknown): this {
    const d = isObj(data) ? data : {};
    const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
    const byId = (v: unknown) => new Map(isObj(v) ? Object.entries(v) : []);
    this.activities = list(d.activities);
    this.scorecards = list(d.scorecards);
    this.nodes = byId(d.nodes);
    this.shotHoles = byId(d.shotHoles);
    return this;
  }

  count(name?: string): number {
    return name ? this.requests.filter((r) => r.name === name).length : this.requests.length;
  }

  fetch: FetchLike = async (url, init) => {
    if (url !== GRAPHQL_URL) throw new TypeError(`not Trackman: ${url}`);
    const body = JSON.parse(init.body ?? '{}') as { query?: string; variables?: Json };
    const name = /query (\w+)/.exec(body.query ?? '')?.[1] ?? '?';
    const token = (init.headers.Authorization ?? '').replace(/^Bearer /, '');
    const req: TrackmanRequest = { name, query: body.query ?? '', variables: body.variables ?? {}, token, at: this.now(), headers: init.headers, credentials: init.credentials };
    this.requests.push(req);
    if (this.requests.length > this.keep) this.requests.splice(0, this.requests.length - this.keep);
    const ms = this.delay?.(req) ?? 0;
    if (ms > 0) await this.sleep(ms, init.signal);
    const o = this.override?.(req);
    if (o instanceof Error) throw o;
    if (o) return o;
    if (!this.tokens.has(token)) return respond(401, { errors: [{ message: 'Unauthorized' }] });
    if (this.expiresAt !== undefined && this.now() >= this.expiresAt) return respond(401, { errors: [{ message: 'Unauthorized' }] });
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
        // As Trackman does since Nov 2026: fragments of several types in one query clash on their
        // strokes' `time` (non-null on one type), and the query is refused as a whole.
        if ((body.query ?? '').split('... on ').length > 2) {
          return respond(200, {
            errors: [{ message: 'Fields `time` conflict because they return conflicting types `DateTime` and `DateTime!`.' }],
          });
        }
        const node = this.nodes.has(String(v.id)) ? this.nodes.get(String(v.id)) : { __typename: 'SimulatorSessionActivity', strokes: [] };
        // As GraphQL does: a fragment gives its fields only to its own type, or to the interface's for a type that
        // implements it; another type's fragment gives nothing but `__typename`.
        const on = /\.\.\. on (\w+)/.exec(body.query ?? '')?.[1] ?? '';
        const type = isObj(node) && typeof node.__typename === 'string' ? node.__typename : on;
        const t = this.types.get(type) ?? {};
        if (on === type) {
          if (t.noStrokes && /\bstrokes\b/.test(body.query ?? '')) {
            return respond(200, { errors: [{ message: `The field \`strokes\` does not exist on the type \`${type}\`.` }] });
          }
          if (t.fields) {
            const asked = (/measurement \{([^}]*)\}/.exec(body.query ?? '')?.[1] ?? '').split(/\s+/).filter(Boolean);
            const unknown = asked.filter((f) => !t.fields?.includes(f));
            if (unknown.length) return respond(200, { errors: unknown.map((f) => ({ message: `The field \`${f}\` does not exist on the type \`StrokeMeasurement\`.` })) });
          }
          return respond(200, { data: { node } });
        }
        if (on === 'SessionActivity' && !t.own && !t.noStrokes) return respond(200, { data: { node } });
        return respond(200, { data: { node: { __typename: type } } });
      }
      case 'Rounds':
        return respond(200, { data: { me: { scorecards: this.scorecards.slice(skip, skip + take) } } });
      case 'RoundShots':
        if (this.refuseMeasured && (body.query ?? '').includes('ballSpeed')) {
          return respond(200, { errors: [{ message: 'Unexpected Execution Error' }] });
        }
        {
          const unknown = this.refuseFields.filter((f) => new RegExp(`\\b${f}\\b`).test(body.query ?? ''));
          if (unknown.length) {
            return respond(200, { errors: unknown.map((f) => ({ message: `The field \`${f}\` does not exist on the type \`ShotMeasurement\`.` })) });
          }
        }
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
