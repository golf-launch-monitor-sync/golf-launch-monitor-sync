// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The shape of a JSON value: its types, the names of its fields, how long its texts and lists are, the range of its
 * numbers - never a value, with one exception the player decides: short, recurring texts (a club's name, a unit) are
 * kept as candidates, shown in the preview, and written only where the player ticks them (recording.ts).
 *
 * Shapes merge: a hundred answers of one address make one shape with every field any of them had.
 */

import {
  candidate,
  hashOf,
  hiddenNumber,
  lookOf,
  personalForms,
  personalKey,
  personish,
  plainKey,
  secretKey,
  type Hidden,
  type Look,
} from './classify.ts';

export interface NumberShape {
  n: number;
  integer: boolean;
  /** The range, only where the number can't name anyone or anything (`hidden` unset). */
  min?: number;
  max?: number;
  hidden?: Hidden;
}

export interface JwtShape {
  alg: string[];
  /** The claims' names, never their values. */
  claims: string[];
  /** Seconds between `iat` and `exp`: how long such a sign-in holds. */
  lifetime?: [number, number];
}

export interface StringShape {
  n: number;
  /** Lengths, unless it is a credential (`secret`), whose length is not told either. */
  length?: [number, number];
  looks: Look[];
  secret?: boolean;
  jwt?: JwtShape;
  /** Short recurring values with their counts (candidates): never written without the player's tick. */
  values?: Record<string, number>;
  /** Too many different values (or one of a person): no candidates. */
  open?: boolean;
}

export interface ArrayShape {
  n: number;
  length: [number, number];
  items?: Shape;
}

export interface ObjectShape {
  n: number;
  fields: Record<string, Shape>;
  /** Values under keys that are data themselves (ids, dates, names): merged into one shape. */
  map?: Shape;
}

export interface Shape {
  n: number;
  null?: number;
  boolean?: number;
  number?: NumberShape;
  string?: StringShape;
  array?: ArrayShape;
  object?: ObjectShape;
}

/** What shaping found that must be compared later, as hashes only: a person's words, values that serve as ids. */
export interface Found {
  personal: Set<string>;
  ids: Set<string>;
}

export function found(): Found {
  return { personal: new Set(), ids: new Set() };
}

export interface ShapeOptions {
  /** Keep candidates (only answers' bodies: never a request's, never storage). */
  candidates?: boolean;
}

/** At most this many distinct candidates a field; beyond it the field is `open`. */
export const MAX_VALUES = 20;
/** At most this many fields an object; further ones go into its `map`. */
export const MAX_FIELDS = 200;
/** Items of a list looked at (the length is the whole list's). */
export const MAX_ITEMS = 200;
export const MAX_DEPTH = 16;
/** Hashes kept of each kind, so that a long recording stays in the browser's session storage. */
export const MAX_HASHES = 20_000;

const ID_KEY = /(^ids?$|[_.-]ids?$|[a-z0-9]I[dD]s?$|uuid|guid|slug|handle|ref$|key$)/i;

function addHash(set: Set<string>, text: string): void {
  if (set.size < MAX_HASHES) set.add(hashOf(text));
}

function addPersonal(f: Found, text: string): void {
  for (const form of personalForms(text)) addHash(f.personal, form);
}

interface Ctx {
  key?: string;
  parent?: string;
  secret: boolean;
  personal: boolean;
  candidates: boolean;
  depth: number;
  found: Found;
}

export function shapeOf(value: unknown, f: Found, opts: ShapeOptions = {}): Shape {
  return walk(value, { secret: false, personal: false, candidates: opts.candidates === true, depth: 0, found: f });
}

function walk(v: unknown, c: Ctx): Shape {
  if (v === null || v === undefined) return { n: 1, null: 1 };
  if (typeof v === 'boolean') return { n: 1, boolean: 1 };
  if (typeof v === 'number') return { n: 1, number: numberOf(v, c) };
  if (typeof v === 'string') return { n: 1, string: stringOf(v, c) };
  if (c.depth >= MAX_DEPTH) return { n: 1 };
  if (Array.isArray(v)) {
    let items: Shape | undefined;
    for (const item of v.slice(0, MAX_ITEMS)) {
      const s = walk(item, { ...c, depth: c.depth + 1 });
      items = items ? merge(items, s) : s;
    }
    return { n: 1, array: { n: 1, length: [v.length, v.length], ...(items ? { items } : {}) } };
  }
  if (typeof v === 'object') {
    const fields: Record<string, Shape> = {};
    let map: Shape | undefined;
    let count = 0;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const plain = plainKey(k) && count < MAX_FIELDS;
      if (!plain && k.trim()) {
        // A key that is data: it may be a person's (a map by name or address) or an id another address uses.
        if (lookOf(k) === 'email' || /\s/.test(k.trim())) addPersonal(c.found, k);
        else addHash(c.found.ids, k);
      }
      const child: Ctx = {
        ...(plain ? { key: k } : {}),
        ...(c.key !== undefined ? { parent: c.key } : {}),
        secret: c.secret || (plain && secretKey(k)),
        personal: c.personal || (plain && personalKey(k, c.key)),
        candidates: c.candidates,
        depth: c.depth + 1,
        found: c.found,
      };
      const s = walk(val, child);
      if (plain) {
        fields[k] = fields[k] ? merge(fields[k], s) : s;
        count++;
      } else map = map ? merge(map, s) : s;
    }
    return { n: 1, object: { n: 1, fields, ...(map ? { map } : {}) } };
  }
  return { n: 1 };
}

function numberOf(v: number, c: Ctx): NumberShape {
  const integer = Number.isInteger(v);
  const hidden = c.personal ? 'personal' : hiddenNumber(c.key, c.parent, v);
  if (hidden || !Number.isFinite(v)) return { n: 1, integer, hidden: hidden ?? 'id' };
  return { n: 1, integer, min: v, max: v };
}

function stringOf(v: string, c: Ctx): StringShape {
  const look = lookOf(v);
  const out: StringShape = { n: 1, looks: [look] };
  if (c.secret) out.secret = true;
  else out.length = [v.length, v.length];
  if (look === 'jwt') {
    const jwt = jwtOf(v);
    if (jwt) out.jwt = jwt;
  }
  // A person's words, wherever they stand: their key says so (`firstName`, `player.name`, `coach: "…"`), or they look
  // like an address.
  if (c.personal || look === 'email' || (c.key !== undefined && personish(c.key))) {
    if (v.trim()) addPersonal(c.found, v);
    out.open = true;
    return out;
  }
  if (c.key !== undefined && ID_KEY.test(c.key) && v.trim()) addHash(c.found.ids, v);
  else if (look === 'id') addHash(c.found.ids, v);
  if (c.candidates && !c.secret && candidate(v)) out.values = { [v]: 1 };
  else if (look === 'text') out.open = true;
  return out;
}

function b64url(part: string): unknown {
  const s = part.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
}

/** A token's algorithm, the names of its claims and how long it holds; nothing it says of whom. */
export function jwtOf(token: string): JwtShape | null {
  try {
    const [h, p] = token.split('.');
    if (!h || !p) return null;
    const head = b64url(h) as Record<string, unknown>;
    const body = b64url(p) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    const alg = typeof head?.alg === 'string' && /^[A-Za-z0-9]{2,12}$/.test(head.alg) ? head.alg : 'other';
    const claims = Object.keys(body)
      .map((k) => (plainKey(k) ? k : '{claim}'))
      .sort();
    const out: JwtShape = { alg: [alg], claims: [...new Set(claims)] };
    if (typeof body.exp === 'number' && typeof body.iat === 'number' && body.exp >= body.iat) {
      const life = Math.round(body.exp - body.iat);
      out.lifetime = [life, life];
    }
    return out;
  } catch {
    return null;
  }
}

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])].sort();
const span = (a: [number, number], b: [number, number]): [number, number] => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];

/** Two shapes as one: every type, every field either had, the ranges spanning both. */
export function merge(a: Shape, b: Shape): Shape {
  const out: Shape = { n: a.n + b.n };
  const nul = (a.null ?? 0) + (b.null ?? 0);
  if (nul) out.null = nul;
  const bool = (a.boolean ?? 0) + (b.boolean ?? 0);
  if (bool) out.boolean = bool;
  const num = mergeOpt(a.number, b.number, mergeNumber);
  if (num) out.number = num;
  const str = mergeOpt(a.string, b.string, mergeString);
  if (str) out.string = str;
  const arr = mergeOpt(a.array, b.array, (x, y) => {
    const items = mergeOpt(x.items, y.items, merge);
    return { n: x.n + y.n, length: span(x.length, y.length), ...(items ? { items } : {}) };
  });
  if (arr) out.array = arr;
  const obj = mergeOpt(a.object, b.object, mergeObject);
  if (obj) out.object = obj;
  return out;
}

function mergeOpt<T>(a: T | undefined, b: T | undefined, f: (x: T, y: T) => T): T | undefined {
  if (a && b) return f(a, b);
  return a ?? b;
}

function mergeNumber(a: NumberShape, b: NumberShape): NumberShape {
  const out: NumberShape = { n: a.n + b.n, integer: a.integer && b.integer };
  const hidden = a.hidden ?? b.hidden;
  if (hidden) out.hidden = hidden;
  else if (a.min !== undefined && b.min !== undefined && a.max !== undefined && b.max !== undefined) {
    out.min = Math.min(a.min, b.min);
    out.max = Math.max(a.max, b.max);
  }
  return out;
}

function mergeString(a: StringShape, b: StringShape): StringShape {
  const out: StringShape = { n: a.n + b.n, looks: union(a.looks, b.looks) };
  if (a.secret || b.secret) out.secret = true;
  else if (a.length && b.length) out.length = span(a.length, b.length);
  const jwt = mergeOpt(a.jwt, b.jwt, (x, y) => {
    const life = mergeOpt(x.lifetime, y.lifetime, span);
    return { alg: union(x.alg, y.alg), claims: union(x.claims, y.claims), ...(life ? { lifetime: life } : {}) };
  });
  if (jwt) out.jwt = jwt;
  if (a.open || b.open) out.open = true;
  else if (a.values || b.values) {
    const values: Record<string, number> = { ...(a.values ?? {}) };
    for (const [k, n] of Object.entries(b.values ?? {})) values[k] = (values[k] ?? 0) + n;
    if (Object.keys(values).length > MAX_VALUES) out.open = true;
    else out.values = values;
  }
  return out;
}

function mergeObject(a: ObjectShape, b: ObjectShape): ObjectShape {
  const fields: Record<string, Shape> = { ...a.fields };
  let map = a.map;
  for (const [k, s] of Object.entries(b.fields)) {
    if (fields[k]) fields[k] = merge(fields[k], s);
    else if (Object.keys(fields).length < MAX_FIELDS) fields[k] = s;
    else map = map ? merge(map, s) : s;
  }
  if (b.map) map = map ? merge(map, b.map) : b.map;
  return { n: a.n + b.n, fields, ...(map ? { map } : {}) };
}
