// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A recording: the exchanges of one portal merged by address, what its pages keep in storage, and - as hashes only - the
 * words of a person and the values used as ids that the pages saw. From it, the file: the shape of the traffic, each
 * literal word checked once more against those hashes (a path part, a key, a cookie's name that turned out to be a
 * person's name or an id becomes a placeholder), numbers only as ranges rounded outward, and short recurring values
 * only where the player ticked them in the preview.
 */

import { hashOf, isPersonal, roundOut } from './classify.ts';
import type { BodyShape, Exchange, Seen, StorageSeen } from './exchange.ts';
import { MAX_HASHES, merge, type Shape } from './shape.ts';

export const FORMAT = 'glmsync-shape/1';
/** At most this many addresses a recording; what comes after is counted, not kept. */
export const MAX_ENDPOINTS = 400;

export interface BodyMerged {
  json?: Shape;
  form?: string[];
  size?: [number, number];
  skipped?: Record<string, number>;
}

export interface Endpoint {
  method: string;
  host: string;
  path: string;
  operation?: string;
  operationType?: string;
  variables?: Shape;
  calls: number;
  transports: string[];
  statuses: Record<string, number>;
  query: string[];
  request: { headers: string[]; auth: string[]; types: string[]; body?: BodyMerged };
  response: { headers: string[]; types: string[]; body?: BodyMerged };
}

export interface StorageMerged {
  host: string;
  local: Record<string, Shape>;
  session: Record<string, Shape>;
  cookies: string[];
}

export interface Recording {
  portal: string;
  started: number;
  stopped?: number;
  endpoints: Record<string, Endpoint>;
  storage: Record<string, StorageMerged>;
  personal: string[];
  ids: string[];
  /** Exchanges not kept: past `MAX_ENDPOINTS`, or not readable. */
  dropped: number;
}

export function newRecording(portal: string, now: number): Recording {
  return { portal, started: now, endpoints: {}, storage: {}, personal: [], ids: [], dropped: 0 };
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])].sort();
const span = (a: [number, number], b: [number, number]): [number, number] => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];

export function endpointKey(e: { method: string; host: string; path: string; operation?: string | undefined }): string {
  return `${e.method} ${e.host}${e.path}${e.operation ? `#${e.operation}` : ''}`;
}

function bodyMerged(b: BodyShape | undefined): BodyMerged | undefined {
  if (!b) return undefined;
  if ('json' in b) return { json: b.json };
  if ('form' in b) return { form: b.form };
  if ('other' in b) return { size: [b.other.size, b.other.size] };
  return { skipped: { [b.skipped]: 1 } };
}

export function mergeBody(a: BodyMerged | undefined, b: BodyMerged | undefined): BodyMerged | undefined {
  if (!a || !b) return a ?? b;
  const out: BodyMerged = {};
  if (a.json || b.json) out.json = a.json && b.json ? merge(a.json, b.json) : (a.json ?? b.json)!;
  if (a.form || b.form) out.form = union(a.form ?? [], b.form ?? []);
  if (a.size || b.size) out.size = a.size && b.size ? span(a.size, b.size) : (a.size ?? b.size)!;
  if (a.skipped || b.skipped) {
    const s: Record<string, number> = { ...(a.skipped ?? {}) };
    for (const [k, n] of Object.entries(b.skipped ?? {})) s[k] = (s[k] ?? 0) + n;
    out.skipped = s;
  }
  return out;
}

function endpointOf(x: Exchange): Endpoint {
  const e: Endpoint = {
    method: x.method,
    host: x.host,
    path: x.path,
    calls: 1,
    transports: [x.transport],
    statuses: { [String(x.status)]: 1 },
    query: x.query,
    request: { headers: x.request.headers, auth: x.request.auth ? [x.request.auth] : [], types: x.request.type ? [x.request.type] : [] },
    response: { headers: x.response.headers, types: x.response.type ? [x.response.type] : [] },
  };
  if (x.graphql) {
    e.operation = x.graphql.operation;
    if (x.graphql.type) e.operationType = x.graphql.type;
    if (x.graphql.variables) e.variables = x.graphql.variables;
  }
  const rq = bodyMerged(x.request.body);
  if (rq) e.request.body = rq;
  const rs = bodyMerged(x.response.body);
  if (rs) e.response.body = rs;
  return e;
}

export function mergeEndpoint(a: Endpoint, b: Endpoint): Endpoint {
  const statuses = { ...a.statuses };
  for (const [k, n] of Object.entries(b.statuses)) statuses[k] = (statuses[k] ?? 0) + n;
  const out: Endpoint = {
    method: a.method,
    host: a.host,
    path: a.path,
    calls: a.calls + b.calls,
    transports: union(a.transports, b.transports),
    statuses,
    query: union(a.query, b.query),
    request: { headers: union(a.request.headers, b.request.headers), auth: union(a.request.auth, b.request.auth), types: union(a.request.types, b.request.types) },
    response: { headers: union(a.response.headers, b.response.headers), types: union(a.response.types, b.response.types) },
  };
  const op = a.operation ?? b.operation;
  if (op) out.operation = op;
  const opType = a.operationType ?? b.operationType;
  if (opType) out.operationType = opType;
  const vars = a.variables && b.variables ? merge(a.variables, b.variables) : (a.variables ?? b.variables);
  if (vars) out.variables = vars;
  const rq = mergeBody(a.request.body, b.request.body);
  if (rq) out.request.body = rq;
  const rs = mergeBody(a.response.body, b.response.body);
  if (rs) out.response.body = rs;
  return out;
}

function mergeStores(a: Record<string, Shape>, b: Record<string, Shape>): Record<string, Shape> {
  const out = { ...a };
  for (const [k, s] of Object.entries(b)) out[k] = out[k] ? merge(out[k], s) : s;
  return out;
}

function addAll(list: string[], more: readonly string[]): string[] {
  if (!more.length) return list;
  const set = new Set(list);
  for (const h of more) {
    if (set.size >= MAX_HASHES) break;
    if (typeof h === 'string' && /^[0-9a-z]{1,16}$/.test(h)) set.add(h);
  }
  return [...set];
}

/** What one page saw, into the recording (in place; returned for convenience). */
export function observe(r: Recording, seen: Seen, personal: readonly string[] = [], ids: readonly string[] = []): Recording {
  r.personal = addAll(r.personal, personal);
  r.ids = addAll(r.ids, ids);
  if (seen.kind === 'storage') {
    const had = r.storage[seen.host];
    r.storage[seen.host] = had
      ? { host: seen.host, local: mergeStores(had.local, seen.local), session: mergeStores(had.session, seen.session), cookies: union(had.cookies, seen.cookies) }
      : { host: seen.host, local: seen.local, session: seen.session, cookies: seen.cookies };
    return r;
  }
  const e = endpointOf(seen);
  const key = endpointKey(e);
  const had = r.endpoints[key];
  if (had) r.endpoints[key] = mergeEndpoint(had, e);
  else if (Object.keys(r.endpoints).length < MAX_ENDPOINTS) r.endpoints[key] = e;
  else r.dropped++;
  return r;
}

export function calls(r: Recording): number {
  return Object.values(r.endpoints).reduce((n, e) => n + e.calls, 0);
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/** A field with short recurring values, offered in the preview. `id` names it for the tick. */
export interface Candidate {
  id: string;
  endpoint: string;
  field: string;
  values: string[];
}

interface Masks {
  personal: ReadonlySet<string>;
  ids: ReadonlySet<string>;
}

function masksOf(r: Recording): Masks {
  return { personal: new Set(r.personal), ids: new Set(r.ids) };
}

/** A literal word checked once more, now that the whole recording's hashes are known. */
function word(w: string, m: Masks, placeholder: string): string {
  if (w.startsWith('{')) return w;
  if (isPersonal(w, m.personal)) return placeholder;
  return m.ids.has(hashOf(w)) ? placeholder : w;
}

function maskPath(path: string, m: Masks): string {
  return path
    .split('/')
    .map((s) => (s ? word(s, m, '{value}') : s))
    .join('/');
}

function maskHost(host: string, m: Masks): string {
  return host
    .split('.')
    .map((l) => word(l, m, '{id}'))
    .join('.');
}

const maskNames = (names: readonly string[], m: Masks) => [...new Set(names.map((n) => word(n, m, '{name}')))].sort();

/**
 * Candidates the player may tick: fields seen at least twice whose values repeat, none of them a person's word. Only
 * answers' bodies have them.
 */
export function candidates(r: Recording): Candidate[] {
  const m = masksOf(r);
  const out: Candidate[] = [];
  for (const e of Object.values(masked(r, m))) {
    const label = endpointKey(e);
    if (e.response.body?.json) collect(e.response.body.json, '$', label, out, m);
  }
  return out;
}

function offered(s: Shape, m: Masks): string[] | null {
  const st = s.string;
  if (!st || st.open || st.secret || !st.values) return null;
  const entries = Object.entries(st.values);
  if (!entries.length || st.n < 2) return null;
  // Recurring: at least one value seen more than once.
  if (!entries.some(([, n]) => n > 1)) return null;
  if (entries.some(([v]) => isPersonal(v, m.personal) || m.ids.has(hashOf(v)))) return null;
  return entries.map(([v]) => v).sort();
}

function collect(s: Shape, at: string, endpoint: string, out: Candidate[], m: Masks): void {
  const values = offered(s, m);
  if (values) out.push({ id: `${endpoint} ${at}`, endpoint, field: at, values });
  if (s.array?.items) collect(s.array.items, `${at}[]`, endpoint, out, m);
  if (s.object) {
    for (const [k, f] of Object.entries(s.object.fields)) collect(f, `${at}.${k}`, endpoint, out, m);
    if (s.object.map) collect(s.object.map, `${at}.{key}`, endpoint, out, m);
  }
}

/** The endpoints with their words masked, merged again where masking made two addresses one. */
function masked(r: Recording, m: Masks): Record<string, Endpoint> {
  const out: Record<string, Endpoint> = {};
  for (const e of Object.values(r.endpoints)) {
    const x: Endpoint = {
      ...e,
      host: maskHost(e.host, m),
      path: maskPath(e.path, m),
      query: maskNames(e.query, m),
      request: { ...e.request, ...(e.request.body ? { body: maskBody(e.request.body, m) } : {}) },
      response: { ...e.response, ...(e.response.body ? { body: maskBody(e.response.body, m) } : {}) },
      ...(e.variables ? { variables: maskShape(e.variables, m) } : {}),
    };
    const key = endpointKey(x);
    out[key] = out[key] ? mergeEndpoint(out[key], x) : x;
  }
  return out;
}

function maskBody(b: BodyMerged, m: Masks): BodyMerged {
  return { ...b, ...(b.json ? { json: maskShape(b.json, m) } : {}), ...(b.form ? { form: maskNames(b.form, m) } : {}) };
}

/** Keys that turned out to be a person's word or an id go into the object's `map`. */
function maskShape(s: Shape, m: Masks): Shape {
  const out: Shape = { ...s };
  if (s.array?.items) out.array = { ...s.array, items: maskShape(s.array.items, m) };
  if (s.object) {
    const fields: Record<string, Shape> = {};
    let map = s.object.map ? maskShape(s.object.map, m) : undefined;
    for (const [k, f] of Object.entries(s.object.fields)) {
      const v = maskShape(f, m);
      if (word(k, m, '{key}') === k) fields[k] = v;
      else map = map ? merge(map, v) : v;
    }
    out.object = { n: s.object.n, fields, ...(map ? { map } : {}) };
  }
  return out;
}

/** A shape as the file writes it: plain, every type that was seen, ranges rounded outward, values only if ticked. */
export function render(s: Shape, release: (at: string) => boolean, at = '$'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (s.null) out.null = true;
  if (s.boolean) out.boolean = true;
  if (s.number) {
    const n = s.number;
    if (n.hidden) out.number = { integer: n.integer, hidden: n.hidden };
    else if (n.min !== undefined && n.max !== undefined) {
      const [min, max] = roundOut(n.min, n.max);
      out.number = { integer: n.integer, about: [min, max] };
    } else out.number = { integer: n.integer };
  }
  if (s.string) {
    const st = s.string;
    const o: Record<string, unknown> = { looks: st.looks };
    if (st.secret) o.secret = true;
    else if (st.length) o.length = roundOut(st.length[0], st.length[1]);
    if (st.jwt) o.jwt = st.jwt;
    if (st.values && !st.open && release(at)) o.values = Object.keys(st.values).sort();
    out.string = o;
  }
  if (s.array) {
    const a = s.array;
    out.array = { length: roundOut(a.length[0], a.length[1]), ...(a.items ? { items: render(a.items, release, `${at}[]`) } : {}) };
  }
  if (s.object) {
    const o = s.object;
    const fields: Record<string, unknown> = {};
    const optional: string[] = [];
    for (const k of Object.keys(o.fields).sort()) {
      const f = o.fields[k]!;
      fields[k] = render(f, release, `${at}.${k}`);
      if (f.n < o.n) optional.push(k);
    }
    out.object = { fields, ...(optional.length ? { optional } : {}), ...(o.map ? { map: render(o.map, release, `${at}.{key}`) } : {}) };
  }
  return out;
}

function renderBody(b: BodyMerged | undefined, release: (at: string) => boolean): Record<string, unknown> | undefined {
  if (!b) return undefined;
  const out: Record<string, unknown> = {};
  if (b.json) out.json = render(b.json, release);
  if (b.form) out.form = b.form;
  if (b.size) out.size = roundOut(b.size[0], b.size[1]);
  if (b.skipped) out.skipped = Object.keys(b.skipped).sort();
  return out;
}

export interface FileMeta {
  portal: string;
  portalName: string;
  madeWith: string;
}

/** The file: the shape of the traffic, nothing of the player but what they ticked. */
export function toFile(r: Recording, meta: FileMeta, released: ReadonlySet<string> = new Set()): Record<string, unknown> {
  const m = masksOf(r);
  const endpoints = masked(r, m);
  const list = Object.keys(endpoints)
    .sort()
    .map((key) => {
      const e = endpoints[key]!;
      const release = (at: string) => released.has(`${key} ${at}`);
      const out: Record<string, unknown> = { method: e.method, host: e.host, path: e.path };
      if (e.operation) out.graphql = { operation: e.operation, ...(e.operationType ? { type: e.operationType } : {}), ...(e.variables ? { variables: render(e.variables, () => false) } : {}) };
      out.calls = e.calls;
      out.via = e.transports;
      out.statuses = Object.keys(e.statuses).sort();
      if (e.query.length) out.query = e.query;
      const rq: Record<string, unknown> = { headers: e.request.headers };
      if (e.request.auth.length) rq.auth = e.request.auth;
      if (e.request.types.length) rq.types = e.request.types;
      const rqb = renderBody(e.request.body, () => false);
      if (rqb) rq.body = rqb;
      out.request = rq;
      const rs: Record<string, unknown> = { headers: e.response.headers };
      if (e.response.types.length) rs.types = e.response.types;
      const rsb = renderBody(e.response.body, release);
      if (rsb) rs.body = rsb;
      out.response = rs;
      return out;
    });
  const storage = Object.keys(r.storage)
    .sort()
    .map((host) => {
      const s = r.storage[host]!;
      const store = (x: Record<string, Shape>) =>
        Object.fromEntries(
          Object.keys(x)
            .map((k) => [word(k, m, '{key}'), x[k]!] as const)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, render(maskShape(v, m), () => false)]),
        );
      return { host: maskHost(host, m), local: store(s.local), session: store(s.session), cookies: maskNames(s.cookies, m) };
    });
  const minutes = r.stopped ? Math.max(0, Math.round((r.stopped - r.started) / 60_000)) : undefined;
  return {
    format: FORMAT,
    portal: meta.portal,
    portal_name: meta.portalName,
    recorded: new Date(r.started).toISOString().slice(0, 10),
    ...(minutes !== undefined ? { minutes } : {}),
    made_with: meta.madeWith,
    about:
      'Only the shape of the traffic: addresses with ids replaced, names of fields, parameters, headers and cookies, types, ' +
      'lengths and number ranges rounded outward. No sign-in, token, cookie value, name, e-mail address or number of the ' +
      'player; short values only where the player ticked them.',
    endpoints: list,
    storage,
    ...(released.size ? { released: [...released].sort() } : {}),
    ...(r.dropped ? { not_kept: r.dropped } : {}),
  };
}

/** The file's name: `shape-<portal>-<date>.json`. */
export function fileName(portal: string, now: number): string {
  return `shape-${portal.replace(/[^a-z0-9-]/g, '')}-${new Date(now).toISOString().slice(0, 10)}.json`;
}

export type { Seen, StorageSeen };
