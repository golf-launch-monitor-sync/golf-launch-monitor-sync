// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One request and its answer as a shape: made in the portal's page from what the page itself sent and received, so
 * that only the shape leaves the page script - the method, the host, the path with placeholders, the names of query
 * parameters and headers, the scheme of the sign-in (`Bearer`, never the token), the status, the media types and the
 * bodies' shapes. And what the page keeps in its storage, by the same rules: the names, the shapes, no value.
 */

import {
  authScheme,
  headerName,
  hostOf,
  isPersonal,
  mediaType,
  operationName,
  plainKey,
  segmentOf,
} from './classify.ts';
import { shapeOf, type Found, type Shape } from './shape.ts';

/** A body as a shape: JSON's structure, a form's field names, or only its type and size. */
export type BodyShape =
  | { json: Shape }
  | { form: string[] }
  | { other: { size: number } }
  | { skipped: 'too_large' | 'binary' | 'unreadable' | 'not_json' };

export interface Exchange {
  kind: 'exchange';
  transport: 'fetch' | 'xhr';
  method: string;
  host: string;
  /** The path, each part that may be data replaced by `{id}` or `{value}`. */
  path: string;
  query: string[];
  graphql?: { operation: string; type?: string; variables?: Shape };
  /** 0: no answer (the network failed, or the request was cancelled). */
  status: number;
  request: { headers: string[]; auth?: string; type?: string; body?: BodyShape };
  response: { headers: string[]; type?: string; body?: BodyShape };
}

export interface StorageSeen {
  kind: 'storage';
  host: string;
  local: Record<string, Shape>;
  session: Record<string, Shape>;
  /** The names of the cookies the page can read (not those only the server sees); never a value. */
  cookies: string[];
}

export type Seen = Exchange | StorageSeen;

/** Bodies larger than this are not read (a picture, a big download): only their size is told. */
export const MAX_BODY = 5_000_000;

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

export interface RawExchange {
  transport: 'fetch' | 'xhr';
  method: string | undefined;
  url: string;
  /** The page's address, for a relative `url`. */
  base: string;
  requestHeaders: Iterable<[string, string]>;
  requestBody?: RawBody;
  status: number;
  responseHeaders: Iterable<string>;
  responseType?: string | null;
  responseBody?: RawBody;
}

/** What a page has of a body: text, an object already parsed (XHR's `json`), a form's names, or only a size. */
export type RawBody = { text: string } | { parsed: unknown } | { names: string[] } | { size: number } | { skipped: 'too_large' | 'binary' | 'unreadable' };

/** Names of a key kind (a query parameter, a form field, a storage key, a cookie): schema words only. */
export function namesOf(names: Iterable<string>, personal?: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const n of names) out.add(plainKey(n) && !(personal && isPersonal(n, personal)) ? n : '{name}');
  return [...out].sort();
}

export function pathOf(pathname: string, personal?: ReadonlySet<string>): string {
  const parts = pathname.split('/').slice(0, 24);
  return parts
    .map((p) => {
      const s = segmentOf(p);
      return s.startsWith('{') || !personal || !isPersonal(s, personal) ? s : '{value}';
    })
    .join('/');
}

function bodyOf(raw: RawBody | undefined, type: string | null, f: Found, candidates: boolean): BodyShape | undefined {
  if (!raw) return undefined;
  if ('skipped' in raw) return { skipped: raw.skipped };
  if ('size' in raw) return { other: { size: raw.size } };
  if ('names' in raw) return { form: namesOf(raw.names, f.personal) };
  if ('parsed' in raw) return { json: shapeOf(raw.parsed, f, { candidates }) };
  const text = raw.text;
  if (text.length > MAX_BODY) return { skipped: 'too_large' };
  if (type === 'application/x-www-form-urlencoded') {
    try {
      return { form: namesOf(new URLSearchParams(text).keys(), f.personal) };
    } catch {
      return { skipped: 'unreadable' };
    }
  }
  const t = text.trimStart();
  if ((type && /json/.test(type)) || t.startsWith('{') || t.startsWith('[')) {
    try {
      return { json: shapeOf(JSON.parse(text), f, { candidates }) };
    } catch {
      return { skipped: 'not_json' };
    }
  }
  return { other: { size: new TextEncoder().encode(text).length } };
}

/** GraphQL's operation, its kind and its variables' shape - never the query's text (literals may stand in it). */
function graphqlOf(body: unknown, url: URL, f: Found): Exchange['graphql'] | undefined {
  const fromBody = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  const query = typeof fromBody?.query === 'string' ? fromBody.query : url.searchParams.get('query');
  const name = operationName(fromBody?.operationName ?? url.searchParams.get('operationName'));
  const persisted = fromBody?.extensions && typeof fromBody.extensions === 'object' && 'persistedQuery' in (fromBody.extensions as object);
  if (!query && !name && !persisted) return undefined;
  const head = query ? /^\s*(query|mutation|subscription)\b\s*([A-Za-z_][A-Za-z0-9_]*)?/.exec(query) : null;
  const type = head?.[1] ?? (query && query.trimStart().startsWith('{') ? 'query' : undefined);
  const operation = name ?? operationName(head?.[2]) ?? '{anonymous}';
  const out: NonNullable<Exchange['graphql']> = { operation };
  if (type) out.type = type;
  if (fromBody && fromBody.variables && typeof fromBody.variables === 'object') out.variables = shapeOf(fromBody.variables, f);
  return out;
}

/** The exchange as its shape, or null for what isn't one to record (another scheme, a malformed address). */
export function exchangeOf(raw: RawExchange, f: Found): Exchange | null {
  let url: URL;
  try {
    url = new URL(raw.url, raw.base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const m = (raw.method ?? 'GET').toUpperCase();
  const method = METHODS.has(m) ? m : 'OTHER';
  const reqHeaders = new Set<string>();
  let auth: string | undefined;
  let reqType: string | null = null;
  for (const [name, value] of raw.requestHeaders) {
    const n = headerName(name);
    if (!n) continue;
    reqHeaders.add(n);
    if (n === 'authorization') auth = authScheme(value);
    if (n === 'content-type') reqType = mediaType(value);
  }
  const resHeaders = new Set<string>();
  for (const name of raw.responseHeaders) {
    const n = headerName(name);
    if (n) resHeaders.add(n);
  }
  const resType = mediaType(raw.responseType);
  // The request's body first: a sign-in's answer may name the person the request named.
  let parsedRequest: unknown;
  if (raw.requestBody && 'text' in raw.requestBody && raw.requestBody.text.length <= MAX_BODY) {
    try {
      parsedRequest = JSON.parse(raw.requestBody.text);
    } catch {
      parsedRequest = undefined;
    }
  }
  const graphql = graphqlOf(parsedRequest, url, f);
  let requestBody: BodyShape | undefined;
  if (graphql) {
    // Its query and variables are told by `graphql` above; nothing else of the body.
    requestBody = undefined;
  } else requestBody = bodyOf(raw.requestBody, reqType, f, false);
  const responseBody = bodyOf(raw.responseBody, resType, f, true);
  const out: Exchange = {
    kind: 'exchange',
    transport: raw.transport,
    method,
    host: hostOf(url.host),
    path: pathOf(url.pathname, f.personal),
    query: namesOf(url.searchParams.keys(), f.personal),
    status: Number.isInteger(raw.status) && raw.status >= 0 && raw.status < 1000 ? raw.status : 0,
    request: { headers: [...reqHeaders].sort() },
    response: { headers: [...resHeaders].sort() },
  };
  if (graphql) out.graphql = graphql;
  if (auth) out.request.auth = auth;
  if (reqType) out.request.type = reqType;
  if (requestBody) out.request.body = requestBody;
  if (resType) out.response.type = resType;
  if (responseBody) out.response.body = responseBody;
  return out;
}

/** What one of the page's storages holds, by key: each value's shape if it is JSON, else the shape of its text. */
function storeOf(entries: Iterable<[string, string]>, f: Found): Record<string, Shape> {
  const out: Record<string, Shape> = {};
  let count = 0;
  for (const [k, v] of entries) {
    if (count++ >= 200) break;
    const key = plainKey(k) && !isPersonal(k, f.personal) ? k : '{key}';
    let value: unknown = v;
    if (v.length <= MAX_BODY) {
      try {
        value = JSON.parse(v);
      } catch {
        value = v;
      }
    }
    // Storage holds sign-ins more often than not: every text there is treated as a credential (no length), its shape
    // and a token's claims are what tell where the session lies.
    const s = shapeOf({ [plainKey(k) ? k : 'value']: value }, f);
    const inner = s.object?.fields[plainKey(k) ? k : 'value'] ?? s;
    out[key] = hideLengths(inner);
  }
  return out;
}

function hideLengths(s: Shape): Shape {
  const out: Shape = { ...s };
  if (s.string) {
    const { length: _len, values: _v, ...rest } = s.string;
    out.string = { ...rest, secret: true, open: true };
  }
  if (s.array) out.array = { ...s.array, ...(s.array.items ? { items: hideLengths(s.array.items) } : {}) };
  if (s.object) {
    out.object = { ...s.object, fields: Object.fromEntries(Object.entries(s.object.fields).map(([k, v]) => [k, hideLengths(v)])) };
    if (s.object.map) out.object.map = hideLengths(s.object.map);
  }
  return out;
}

export function storageOf(host: string, local: Iterable<[string, string]>, session: Iterable<[string, string]>, cookie: string, f: Found): StorageSeen {
  const names = cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim() ?? '')
    .filter(Boolean);
  return { kind: 'storage', host: hostOf(host), local: storeOf(local, f), session: storeOf(session, f), cookies: namesOf(names, f.personal) };
}
