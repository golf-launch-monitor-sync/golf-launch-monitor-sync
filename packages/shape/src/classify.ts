// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a value, a key, a path segment looks like - decided from its form alone, so that no value has to be kept to
 * describe it. Everything here errs on the side of hiding: a word that might be a person's is masked, a number that
 * might name someone loses its range. A shape that says a little less is still useful; a value that slips through
 * can't be taken back.
 */

/** How a string looks, never what it says. */
export type Look = 'email' | 'jwt' | 'url' | 'id' | 'time' | 'date' | 'numeric' | 'text';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const JWT = /^eyJ[\w-]{2,}\.eyJ[\w-]{2,}\.[\w-]*$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{12,}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
const NUMERIC = /^[+-]?\d+(?:[.,]\d+)?$/;
/** Long runs without spaces, with letters and digits: tokens, keys, opaque ids. */
const OPAQUE = /^[A-Za-z0-9+/_=.~-]{20,}$/;

export function lookOf(s: string): Look {
  const v = s.trim();
  if (EMAIL.test(v)) return 'email';
  if (JWT.test(v)) return 'jwt';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return 'url';
  if (UUID.test(v) || HEX.test(v)) return 'id';
  if (DATETIME.test(v)) return 'time';
  if (DATE.test(v)) return 'date';
  if (NUMERIC.test(v)) return v.replace(/\D/g, '').length >= 7 ? 'id' : 'numeric';
  if (OPAQUE.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v)) return 'id';
  return 'text';
}

/** A key as one word to compare: lower case, no separators (`first_name`, `firstName` → `firstname`). */
export function norm(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Keys whose value is about a person: never a value of theirs, not even a short one. */
const PERSONAL_KEYS = new Set([
  'firstname', 'lastname', 'fullname', 'displayname', 'nickname', 'username', 'givenname', 'familyname', 'surname',
  'middlename', 'name', 'email', 'emailaddress', 'mail', 'phone', 'phonenumber', 'mobile', 'telephone', 'address',
  'street', 'streetaddress', 'city', 'zip', 'zipcode', 'postalcode', 'postcode', 'birthday', 'birthdate',
  'dateofbirth', 'dob', 'gender', 'sex', 'avatar', 'picture', 'photo', 'handle', 'login', 'initials', 'title',
]);
/** Words of a key that say it is about a person (the parent of `name`, the start of `playerName`). */
const PERSON_WORDS = [
  'user', 'player', 'owner', 'customer', 'member', 'account', 'profile', 'author', 'coach', 'instructor', 'friend',
  'contact', 'person', 'creator', 'createdby', 'updatedby', 'modifiedby', 'golfer', 'student', 'teacher', 'people',
  'me', 'self', 'host', 'guest', 'invitee', 'sender', 'recipient', 'pro', 'trainer',
];

/** Whether a key, under its parent key, holds something about a person. */
export function personalKey(key: string, parent?: string): boolean {
  const k = norm(key);
  if (!k) return false;
  if (k === 'email' || k.endsWith('email') || k.endsWith('emailaddress') || k.endsWith('phone') || k.endsWith('phonenumber')) return true;
  if (PERSONAL_KEYS.has(k)) {
    // `name` and `title` alone are often a club's or a session's: personal only under a person.
    if (k === 'name' || k === 'title' || k === 'handle' || k === 'login') return parent !== undefined && personish(parent);
    return true;
  }
  if (k.endsWith('name') && PERSON_WORDS.some((w) => k.startsWith(w))) return true;
  return false;
}

/** Whether a key names a person or a thing of theirs (`player`, `createdBy`, `coaches`). */
export function personish(key: string): boolean {
  const k = norm(key).replace(/s$/, '');
  return PERSON_WORDS.includes(k);
}

/** Keys whose value is a credential: not even its length is told. */
const SECRET_KEYS = /(password|passwd|pwd|secret|token|apikey|credential|otp|^session$|sessionid|sessionkey|cookie|signature|nonce|authcode|authorization|^code$|^pin$|^key$|privatekey|accesskey)/;

export function secretKey(key: string): boolean {
  return SECRET_KEYS.test(norm(key));
}

/** Why a number gets no range: it may name something (an id), say when (a time), where (a place) or of whom. */
export type Hidden = 'id' | 'time' | 'place' | 'personal';

const PLACE_KEYS = new Set(['lat', 'lng', 'lon', 'long', 'latitude', 'longitude', 'geo', 'coordinates', 'coords', 'location', 'position', 'gps', 'altitude', 'elevation']);
const TIME_KEYS = new Set(['epoch', 'iat', 'exp', 'nbf', 'auth_time', 'authtime', 'createdat', 'updatedat', 'modifiedat', 'deletedat', 'createdon', 'updatedon', 'date', 'datetime', 'day']);
const PERSON_NUMBERS =new Set(['age', 'birthyear', 'yearofbirth', 'height', 'weight', 'handicap', 'hcp', 'handicapindex', 'income', 'salary']);

export function hiddenNumber(key: string | undefined, parent: string | undefined, value: number): Hidden | null {
  const k = key === undefined ? '' : norm(key);
  if (k) {
    if (PLACE_KEYS.has(k) || k.endsWith('latitude') || k.endsWith('longitude')) return 'place';
    if (k === 'age' || k === 'birthyear' || k === 'yearofbirth' || k.startsWith('birth')) return 'personal';
    if (parent !== undefined && personish(parent) && PERSON_NUMBERS.has(k)) return 'personal';
    // `id` only as its own word (`id`, `user_id`, `sessionId`), not the end of one (`hybrid`).
    if (key !== undefined && /(^ids?$|[_.-]ids?$|[a-z0-9]I[dD]s?$)/.test(key)) return 'id';
    if (/(uuid|guid|number|phone|zip|zipcode|postalcode|postcode|serial|iban)$/.test(k) || k === 'pin' || k === 'code') return 'id';
    // A time as a number is mostly seconds or milliseconds since 1970 (the value says so below); these say it by name.
    // Not every key ending in `time`: `hangTime` and `flightTime` are durations of the shot, wanted with their range.
    if (k.endsWith('timestamp') || TIME_KEYS.has(k)) return 'time';
  }
  if (Number.isInteger(value)) {
    const a = Math.abs(value);
    // Seconds or milliseconds since 1970 between 2001 and 2100.
    if ((a >= 1e9 && a < 4.2e9) || (a >= 1e12 && a < 4.2e12)) return 'time';
    if (a >= 1e6) return 'id';
  }
  return null;
}

/** A key that is one word of a schema, not data used as a key (an id, a date, an address, a name with a space). */
export function plainKey(key: string): boolean {
  if (!/^[A-Za-z_$][A-Za-z0-9_$.-]{0,63}$/.test(key)) return false;
  if ((key.match(/\d/g) ?? []).length >= 3) return false;
  if (HEX.test(key) || UUID.test(key)) return false;
  return lookOf(key) === 'text';
}

/** A placeholder in a path: `{id}` where a part looks like one, `{value}` for anything else that may be data. */
export type Placeholder = '{id}' | '{value}';

export function segmentOf(raw: string): string | Placeholder {
  let s: string;
  try {
    s = decodeURIComponent(raw);
  } catch {
    return '{value}';
  }
  if (s === '') return '';
  const look = lookOf(s);
  if (look === 'id' || look === 'numeric' || look === 'jwt') return '{id}';
  if (look !== 'text') return '{value}';
  if ((s.match(/\d/g) ?? []).length >= 3) return '{id}';
  if (s.length > 40 || !/^[A-Za-z0-9._~-]+$/.test(s)) return '{value}';
  return s;
}

/** A host's labels, a label that looks like data (a number, an id) replaced. */
export function hostOf(host: string): string {
  return host
    .toLowerCase()
    .split('.')
    .map((l) => ((l.match(/\d/g) ?? []).length >= 3 || HEX.test(l) || l.length > 40 ? '{id}' : l))
    .join('.');
}

/** Only the scheme of an `Authorization` header, and only one known: anything else could be the credential itself. */
const SCHEMES = ['Bearer', 'Basic', 'Digest', 'Token', 'JWT', 'Negotiate', 'NTLM', 'HMAC', 'ApiKey', 'DPoP', 'AWS4-HMAC-SHA256', 'Hawk', 'OAuth', 'SharedKey'];

export function authScheme(value: string): string {
  const m = /^\s*([A-Za-z0-9-]+)\s+\S/.exec(value);
  const word = m?.[1];
  const known = word && SCHEMES.find((s) => s.toLowerCase() === word.toLowerCase());
  return known ?? (value.trim() ? 'other' : 'empty');
}

/** A header's name as HTTP allows it, lower case; anything else is not kept. */
export function headerName(name: string): string | null {
  const n = name.trim().toLowerCase();
  return /^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(n) ? n : null;
}

/** A media type without its parameters (`application/json; charset=utf-8` → `application/json`). */
export function mediaType(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z]+\/[a-z0-9.+-]{1,80}$/.test(t) ? t : null;
}

/** An operation name of GraphQL: a name of the schema or nothing. */
export function operationName(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v) ? v : null;
}

/**
 * A short value that may repeat in many answers (a club's name, a unit): offered to the player in the preview, never
 * written without the tick. Only letters, digits and a few signs; no address, no id, no time.
 */
export function candidate(s: string): boolean {
  if (s.length < 1 || s.length > 24 || s.trim() !== s) return false;
  if (lookOf(s) !== 'text') return false;
  return /^[\p{L}\p{N} .,'()/+#&_-]+$/u.test(s) && (s.match(/\d/g) ?? []).length <= 3;
}

/**
 * A short, fast hash of a normalised text (cyrb53): values that must be compared later - a person's name, an id seen in
 * an answer - are kept only so, never as text. Not a secret: it only keeps the words out of the recording.
 */
export function hashOf(text: string): string {
  const s = text.normalize('NFKC').toLowerCase().trim();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The forms a personal value may take elsewhere: the whole, its words, and the words joined as a slug would (`Anna
 * Beispiel` → `anna`, `beispiel`, `anna-beispiel`, `annabeispiel` …), an address's part before the `@`. Words shorter than
 * three letters are left out (they would mask half the schema).
 */
export function personalForms(value: string): string[] {
  const v = value.normalize('NFKC').toLowerCase().trim();
  if (!v) return [];
  const local = v.includes('@') ? v.slice(0, v.indexOf('@')) : v;
  const words = local.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
  const out = new Set<string>([v, local, ...words]);
  if (words.length > 1) for (const sep of ['-', '_', '.', '']) out.add(words.join(sep));
  return [...out];
}

/** Whether a word (a path segment, a key, a value) is one of the personal forms kept as hashes, or has one as a part. */
export function isPersonal(word: string, personal: ReadonlySet<string>): boolean {
  if (!personal.size) return false;
  const w = word.normalize('NFKC').toLowerCase().trim();
  if (personal.has(hashOf(w))) return true;
  return w.split(/[^\p{L}\p{N}]+/u).some((p) => p.length >= 3 && personal.has(hashOf(p)));
}

/** Rounds a range outward to two significant digits: enough to tell metres from yards, not a value to the last digit. */
export function roundOut(min: number, max: number): [number, number] {
  return [round(min, Math.floor), round(max, Math.ceil)];
}

function round(x: number, f: (v: number) => number): number {
  if (x === 0 || !Number.isFinite(x)) return 0;
  const e = Math.floor(Math.log10(Math.abs(x))) - 1;
  const p = 10 ** e;
  const r = f(x / p) * p;
  // 0.1 + 0.2 and its kin: back to the digits meant.
  return Number(r.toPrecision(2));
}
