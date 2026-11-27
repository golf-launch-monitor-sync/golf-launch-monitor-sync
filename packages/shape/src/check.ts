// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a portal page posts is read again here, strictly, before it goes into a recording: the page's own scripts can
 * post on that window too. Only the fields a shape has, of the right types, within bounds; anything else is dropped.
 */

import type { BodyShape, Exchange, Seen, StorageSeen } from './exchange.ts';
import type { Shape } from './shape.ts';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const word = (v: unknown, max = 200) => typeof v === 'string' && v.length <= max;
const words = (v: unknown, max = 500) => Array.isArray(v) && v.length <= max && v.every((x) => word(x));
const pair = (v: unknown, f: (x: unknown) => boolean) => Array.isArray(v) && v.length === 2 && f(v[0]) && f(v[1]);
/** Only these keys: a field more (`value`, say) is a value smuggled in. */
const only = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).every((k) => keys.includes(k));
const LOOKS = new Set(['email', 'jwt', 'url', 'id', 'time', 'date', 'numeric', 'text']);
const HIDDEN = new Set(['id', 'time', 'place', 'personal']);

export function checkShape(v: unknown, depth = 0): v is Shape {
  if (!isObj(v) || depth > 20 || !count(v.n)) return false;
  for (const k of Object.keys(v)) if (!['n', 'null', 'boolean', 'number', 'string', 'array', 'object'].includes(k)) return false;
  if (v.null !== undefined && !count(v.null)) return false;
  if (v.boolean !== undefined && !count(v.boolean)) return false;
  if (v.number !== undefined) {
    const n = v.number;
    if (!isObj(n) || !only(n, ['n', 'integer', 'min', 'max', 'hidden']) || !count(n.n) || typeof n.integer !== 'boolean') return false;
    if (n.hidden !== undefined && !HIDDEN.has(n.hidden as string)) return false;
    if ((n.min !== undefined || n.max !== undefined) && (!finite(n.min) || !finite(n.max) || n.hidden !== undefined)) return false;
  }
  if (v.string !== undefined) {
    const s = v.string;
    if (!isObj(s) || !only(s, ['n', 'length', 'looks', 'secret', 'jwt', 'values', 'open']) || !count(s.n) || !Array.isArray(s.looks) || !s.looks.every((l) => LOOKS.has(l as string))) return false;
    if (s.length !== undefined && !pair(s.length, count)) return false;
    if (s.secret !== undefined && s.secret !== true) return false;
    if (s.open !== undefined && s.open !== true) return false;
    if (s.values !== undefined && (!isObj(s.values) || Object.keys(s.values).length > 20 || !Object.entries(s.values).every(([k, c]) => k.length <= 24 && count(c)))) return false;
    if (s.jwt !== undefined) {
      const j = s.jwt;
      if (!isObj(j) || !only(j, ['alg', 'claims', 'lifetime']) || !words(j.alg, 10) || !words(j.claims, 200) || (j.lifetime !== undefined && !pair(j.lifetime, finite))) return false;
    }
  }
  if (v.array !== undefined) {
    const a = v.array;
    if (!isObj(a) || !only(a, ['n', 'length', 'items']) || !count(a.n) || !pair(a.length, count) || (a.items !== undefined && !checkShape(a.items, depth + 1))) return false;
  }
  if (v.object !== undefined) {
    const o = v.object;
    if (!isObj(o) || !only(o, ['n', 'fields', 'map']) || !count(o.n) || !isObj(o.fields) || Object.keys(o.fields).length > 200) return false;
    if (!Object.entries(o.fields).every(([k, f]) => k.length <= 64 && checkShape(f, depth + 1))) return false;
    if (o.map !== undefined && !checkShape(o.map, depth + 1)) return false;
  }
  return true;
}

function checkBody(v: unknown): v is BodyShape {
  if (!isObj(v) || Object.keys(v).length !== 1) return false;
  if ('json' in v) return checkShape(v.json);
  if ('form' in v) return words(v.form);
  if ('other' in v) return isObj(v.other) && only(v.other, ['size']) && count(v.other.size);
  if ('skipped' in v) return ['too_large', 'binary', 'unreadable', 'not_json'].includes(v.skipped as string);
  return false;
}

function checkStore(v: unknown): v is Record<string, Shape> {
  return isObj(v) && Object.keys(v).length <= 200 && Object.entries(v).every(([k, s]) => k.length <= 64 && checkShape(s));
}

/** The seen as posted, or null. */
export function readSeen(v: unknown): Seen | null {
  if (!isObj(v)) return null;
  if (v.kind === 'storage') {
    const s = v as unknown as StorageSeen;
    if (!only(v, ['kind', 'host', 'local', 'session', 'cookies'])) return null;
    return word(s.host) && checkStore(s.local) && checkStore(s.session) && words(s.cookies) ? s : null;
  }
  if (v.kind !== 'exchange') return null;
  const x = v as unknown as Exchange;
  if (!only(v, ['kind', 'transport', 'method', 'host', 'path', 'query', 'graphql', 'status', 'request', 'response'])) return null;
  if (x.transport !== 'fetch' && x.transport !== 'xhr') return null;
  if (!word(x.method, 10) || !word(x.host) || !word(x.path, 2048) || !words(x.query) || !count(x.status)) return null;
  if (!isObj(x.request) || !only(x.request, ['headers', 'auth', 'type', 'body']) || !words(x.request.headers) || (x.request.auth !== undefined && !word(x.request.auth, 40)) || (x.request.type !== undefined && !word(x.request.type, 100))) return null;
  if (x.request.body !== undefined && !checkBody(x.request.body)) return null;
  if (!isObj(x.response) || !only(x.response, ['headers', 'type', 'body']) || !words(x.response.headers) || (x.response.type !== undefined && !word(x.response.type, 100))) return null;
  if (x.response.body !== undefined && !checkBody(x.response.body)) return null;
  if (x.graphql !== undefined) {
    const g = x.graphql;
    if (!isObj(g) || !only(g, ['operation', 'type', 'variables']) || !word(g.operation, 64) || (g.type !== undefined && !word(g.type, 20)) || (g.variables !== undefined && !checkShape(g.variables))) return null;
  }
  return x;
}

/** Hashes as `hashOf` writes them. */
export function readHashes(v: unknown): string[] | null {
  return Array.isArray(v) && v.length <= 20_000 && v.every((h) => typeof h === 'string' && /^[0-9a-z]{1,16}$/.test(h)) ? (v as string[]) : null;
}
