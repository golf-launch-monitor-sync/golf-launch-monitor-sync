// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { authScheme, lookOf, personalKey, roundOut, segmentOf } from './classify.ts';
import { readHashes, readSeen } from './check.ts';
import { exchangeOf, storageOf, type RawExchange } from './exchange.ts';
import { candidates, fileName, newRecording, observe, toFile, type Recording } from './recording.ts';
import { found, merge, shapeOf } from './shape.ts';
import {
  ACCESS,
  API_KEY,
  COOKIE,
  EXACT_NUMBERS,
  GRAPHQL_BODY,
  LOCAL_STORAGE,
  NUMERIC_ID,
  PERSON,
  PROFILE_ANSWER,
  SECRETS,
  SESSION_IDS,
  SESSIONS_ANSWER,
  SIGN_IN_ANSWER,
  USER_ID,
} from './testing.ts';

const BASE = 'https://portal.example.net/home';
const META = { portal: 'fsx-live', portalName: 'Made-up portal', madeWith: 'tests' };

function raw(over: Partial<RawExchange> & { url: string }): RawExchange {
  return { transport: 'fetch', method: 'GET', base: BASE, requestHeaders: [], status: 200, responseHeaders: ['content-type'], responseType: 'application/json', ...over };
}

/** What the made-up portal's page would post: sign-in, profile, sessions (twice, as a player pages), GraphQL, storage. */
function portalSeen(f = found()) {
  const auth: [string, string][] = [
    ['Authorization', `Bearer ${ACCESS}`],
    ['X-Api-Key', API_KEY],
    ['Content-Type', 'application/json; charset=utf-8'],
  ];
  const seen = [
    // The paths name the person and the ids before any answer did: they must still go.
    exchangeOf(raw({ method: 'GET', url: `https://api.example.net/v2/players/${PERSON.slug}/sessions?email=${encodeURIComponent(PERSON.email)}&page=2`, requestHeaders: auth, responseBody: { text: JSON.stringify(SESSIONS_ANSWER) } }), f),
    exchangeOf(raw({ method: 'POST', url: 'https://auth.example.net/oauth/token', requestHeaders: [['Content-Type', 'application/x-www-form-urlencoded']], requestBody: { text: `grant_type=password&username=${encodeURIComponent(PERSON.email)}&password=hunter2-made-up` }, responseBody: { text: JSON.stringify(SIGN_IN_ANSWER) } }), f),
    exchangeOf(raw({ url: `https://api.example.net/v2/users/${encodeURIComponent(PERSON.email)}/profile`, requestHeaders: auth, responseBody: { text: JSON.stringify(PROFILE_ANSWER) } }), f),
    exchangeOf(raw({ url: `/v2/sessions/${SESSION_IDS[0]}/shots`, requestHeaders: auth, responseBody: { text: JSON.stringify({ shots: SESSIONS_ANSWER.items[0]!.shots }) } }), f),
    exchangeOf(raw({ url: `/v2/sessions/${NUMERIC_ID}`, requestHeaders: auth, status: 404, responseBody: { text: '{"error":"not found"}' } }), f),
    exchangeOf(raw({ method: 'GET', url: `https://api.example.net/v2/players/${PERSON.slug}/sessions?page=3`, requestHeaders: auth, responseBody: { text: JSON.stringify(SESSIONS_ANSWER) } }), f),
    exchangeOf(raw({ method: 'POST', url: 'https://api.example.net/graphql', requestHeaders: auth, requestBody: { text: JSON.stringify(GRAPHQL_BODY) }, responseBody: { text: JSON.stringify({ data: { sessions: SESSION_IDS.map((id) => ({ id })) } }) } }), f),
    exchangeOf(raw({ url: 'https://cdn.example.net/img/logo.png', responseType: 'image/png', responseBody: { size: 4821 } }), f),
    storageOf('portal.example.net', LOCAL_STORAGE, [], COOKIE, f),
  ];
  return seen;
}

function recorded(): Recording {
  const f = found();
  const seen = portalSeen(f);
  const r = newRecording('fsx-live', Date.parse('2026-11-27T08:00:00Z'));
  for (const s of seen) observe(r, s!, [...f.personal], [...f.ids]);
  r.stopped = Date.parse('2026-11-27T08:12:00Z');
  return r;
}

/** Every number in the file with the path to it. */
function numbers(v: unknown, at = '$', out: [string, number][] = []): [string, number][] {
  if (typeof v === 'number') out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => numbers(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) numbers(x, `${at}.${k}`, out);
  return out;
}

describe('the file of a recording', () => {
  const r = recorded();
  const file = toFile(r, META);
  const text = JSON.stringify(file);
  const lower = text.toLowerCase();

  it('holds no token, key, cookie value, e-mail address, name or id', () => {
    for (const s of SECRETS) expect({ s, found: lower.includes(s.toLowerCase()) }).toEqual({ s, found: false });
    expect(lower).not.toContain('hunter2');
    expect(lower).not.toContain('+49');
    expect(text).not.toMatch(/eyJ[\w-]{4,}/);
    expect(text).not.toMatch(/@example\.org/);
  });

  it('has numbers only as ranges rounded outward, counts and lifetimes', () => {
    const allowed = /\.(about|length|size|lifetime)\[[01]\]$|\.calls$|\.minutes$/;
    for (const [at, n] of numbers(file)) expect({ at, ok: allowed.test(at) }).toEqual({ at, ok: true });
    const values = numbers(file).map(([, n]) => n);
    for (const n of EXACT_NUMBERS) expect({ n, found: values.includes(n) }).toEqual({ n, found: false });
    for (const [at, n] of numbers(file)) if (at.includes('.about[')) expect(Number(n.toPrecision(2))).toBe(n);
  });

  it('tells the shape: paths with placeholders, query names, header names, the scheme of the sign-in', () => {
    const eps = file.endpoints as Record<string, any>[];
    const paths = eps.map((e) => `${e.method} ${e.host}${e.path}`);
    expect(paths).toContain('GET api.example.net/v2/players/{value}/sessions');
    expect(paths).toContain('GET api.example.net/v2/users/{value}/profile');
    expect(paths).toContain('GET portal.example.net/v2/sessions/{id}/shots');
    expect(paths).toContain('GET portal.example.net/v2/sessions/{id}');
    const list = eps.find((e) => e.path === '/v2/players/{value}/sessions')!;
    // Both pages of the list made one address.
    expect(list.calls).toBe(2);
    expect(list.query).toEqual(['email', 'page']);
    expect(list.request.headers).toEqual(['authorization', 'content-type', 'x-api-key']);
    expect(list.request.auth).toEqual(['Bearer']);
    expect(list.response.types).toEqual(['application/json']);
    const shot = list.response.body.json.object.fields.items.array.items.object.fields.shots.array.items.object.fields;
    expect(shot.carry.number).toEqual({ integer: false, about: [140, 220] });
    expect(shot.spin.number).toEqual({ integer: true, about: [2400, 7200] });
    expect(shot.club.string.looks).toEqual(['text']);
    expect(shot.club.string.values).toBeUndefined();
  });

  it('keeps how long a sign-in holds and the names of its claims, never what they say', () => {
    const token = (file.endpoints as any[]).find((e) => e.path === '/oauth/token');
    const access = token.response.body.json.object.fields.access_token.string;
    expect(access).toMatchObject({ looks: ['jwt'], secret: true, jwt: { alg: ['RS256'], claims: ['email', 'exp', 'iat', 'name', 'scope', 'sub'], lifetime: [3600, 3600] } });
    expect(access.length).toBeUndefined();
    expect(token.response.body.json.object.fields.refresh_token.string).toEqual({ looks: ['id'], secret: true });
    // The form's field names only.
    expect(token.request.body).toEqual({ form: ['grant_type', 'password', 'username'] });
    const user = token.response.body.json.object.fields.user.object.fields;
    expect(user.handicap.number).toEqual({ integer: false, hidden: 'personal' });
    expect(user.birthYear.number).toEqual({ integer: true, hidden: 'personal' });
    expect(user.email.string.looks).toEqual(['email']);
  });

  it('hides a place and a time', () => {
    const profile = (file.endpoints as any[]).find((e) => e.path === '/v2/users/{value}/profile');
    expect(profile.response.body.json.object.fields.home.object.fields.latitude.number).toEqual({ integer: false, hidden: 'place' });
    const list = (file.endpoints as any[]).find((e) => e.path === '/v2/players/{value}/sessions');
    expect(list.response.body.json.object.fields.items.array.items.object.fields.createdAt.number.hidden).toBe('time');
    // A map keyed by an address: the key goes, the value's shape stays.
    expect(list.response.body.json.object.fields.byPlayer.object).toMatchObject({ fields: {}, map: { object: { fields: { count: { number: { integer: true, about: [2, 2] } } } } } });
  });

  it("tells GraphQL's operation and its variables' shape, never the query's text", () => {
    const gql = (file.endpoints as any[]).find((e) => e.graphql);
    expect(gql.graphql.operation).toBe('SessionsOf');
    expect(gql.graphql.type).toBe('query');
    expect(gql.graphql.variables.object.fields.email.string.looks).toEqual(['email']);
    expect(gql.graphql.variables.object.fields.playerId.string.looks).toEqual(['id']);
    expect(gql.request.body).toBeUndefined();
  });

  it('tells where a session lies: storage keys and cookie names, no value', () => {
    const st = (file.storage as any[])[0];
    expect(Object.keys(st.local).sort()).toEqual(['auth', 'theme', '{key}']);
    expect(st.local.auth.object.fields.accessToken.string).toMatchObject({ looks: ['jwt'], secret: true, jwt: { lifetime: [3600, 3600] } });
    expect(st.local.theme.string).toEqual({ looks: ['text'], secret: true });
    expect(st.cookies).toEqual(['sid', 'theme', '{name}']);
  });

  it('says what a picture was, without reading it', () => {
    const png = (file.endpoints as any[]).find((e) => e.path === '/img/logo.png');
    expect(png.response.body).toEqual({ size: [4800, 4900] });
  });

  it('is named by portal and day', () => {
    expect(fileName('fsx-live', Date.parse('2026-11-27T08:00:00Z'))).toBe('shape-fsx-live-2026-11-27.json');
    expect(file).toMatchObject({ format: 'glmsync-shape/1', portal: 'fsx-live', recorded: '2026-11-27', minutes: 12 });
  });
});

describe('short recurring values, only with a tick', () => {
  const r = recorded();

  it('offers clubs and units, never a name, an address or an id', () => {
    const offered = candidates(r);
    const all = offered.flatMap((c) => c.values);
    expect(all).toContain('Driver');
    expect(all).toContain('7 Iron');
    expect(all).toContain('yards');
    for (const v of all) for (const s of [PERSON.first, PERSON.last, PERSON.email, USER_ID, ...SESSION_IDS]) expect(v.toLowerCase()).not.toContain(s.toLowerCase());
  });

  it('writes them only where ticked, and even all ticked no token, address or name', () => {
    expect(JSON.stringify(toFile(r, META))).not.toContain('Driver');
    const club = candidates(r).find((c) => c.field.endsWith('.shots[].club'))!;
    const one = JSON.stringify(toFile(r, META, new Set([club.id])));
    expect(one).toContain('"Driver"');
    expect(one).not.toContain('"yards"');
    const everything = JSON.stringify(toFile(r, META, new Set(candidates(r).map((c) => c.id)))).toLowerCase();
    for (const s of SECRETS.filter((x) => x !== 'Range session')) expect({ s, found: everything.includes(s.toLowerCase()) }).toEqual({ s, found: false });
  });

  it('never offers a value that turns out to be a person’s, wherever it stood', () => {
    // A generic `name` field (not under a person) holding the player's name, in many answers.
    const f = found();
    const r2 = newRecording('fsx-live', 0);
    const many = { items: [1, 2, 3].map(() => ({ name: `${PERSON.first} ${PERSON.last}`, club: 'Driver' })) };
    observe(r2, exchangeOf(raw({ url: '/a', responseBody: { text: JSON.stringify(many) } }), f)!, [...f.personal], [...f.ids]);
    expect(candidates(r2).flatMap((c) => c.values)).toContain(`${PERSON.first} ${PERSON.last}`);
    // Once any answer says it is a person's, it is no candidate any more - and leaves the path too.
    observe(r2, exchangeOf(raw({ url: `/players/${PERSON.slug}`, responseBody: { text: JSON.stringify({ user: { firstName: PERSON.first, lastName: PERSON.last } }) } }), f)!, [...f.personal], [...f.ids]);
    const values = candidates(r2).flatMap((c) => c.values);
    expect(values).toEqual(['Driver']);
    expect(JSON.stringify(toFile(r2, META, new Set(candidates(r2).map((c) => c.id))))).not.toMatch(/annika|beispielmann/i);
  });

  it('drops a value that differs every time (not recurring)', () => {
    const f = found();
    const r3 = newRecording('x', 0);
    for (const note of ['first try', 'second go']) observe(r3, exchangeOf(raw({ url: '/n', responseBody: { text: JSON.stringify({ note }) } }), f)!);
    expect(candidates(r3)).toEqual([]);
  });
});

describe('the rules for single values', () => {
  it('knows tokens, addresses, ids and times by their form', () => {
    expect(lookOf(ACCESS)).toBe('jwt');
    expect(lookOf(PERSON.email)).toBe('email');
    expect(lookOf(USER_ID)).toBe('id');
    expect(lookOf('a1b2c3d4e5f60718')).toBe('id');
    expect(lookOf('rt_9QmZ7xKp2LwV4nB8cD1eF6gH3jK5mN0pQ')).toBe('id');
    expect(lookOf('2026-11-27T08:00:00Z')).toBe('time');
    expect(lookOf('2026-11-27')).toBe('date');
    expect(lookOf('12.4')).toBe('numeric');
    expect(lookOf('Driver')).toBe('text');
  });

  it('replaces path parts that may be data', () => {
    expect(segmentOf('sessions')).toBe('sessions');
    expect(segmentOf('v2')).toBe('v2');
    expect(segmentOf('48151623')).toBe('{id}');
    expect(segmentOf(USER_ID)).toBe('{id}');
    expect(segmentOf(encodeURIComponent(PERSON.email))).toBe('{value}');
    expect(segmentOf('Annika%20Beispielmann')).toBe('{value}');
    expect(segmentOf('%E0%A4%A')).toBe('{value}');
    expect(segmentOf('player123x')).toBe('{id}');
  });

  it('keeps only a known scheme of the sign-in', () => {
    expect(authScheme(`Bearer ${ACCESS}`)).toBe('Bearer');
    expect(authScheme('bearer abc')).toBe('Bearer');
    // A bare token is no scheme: it must not be taken for one.
    expect(authScheme(ACCESS)).toBe('other');
    expect(authScheme(`${API_KEY} x`)).toBe('other');
    expect(authScheme('')).toBe('empty');
  });

  it('knows keys about a person', () => {
    for (const k of ['firstName', 'last_name', 'email', 'userEmail', 'displayName', 'playerName', 'phone']) expect({ k, p: personalKey(k) }).toEqual({ k, p: true });
    expect(personalKey('name', 'player')).toBe(true);
    expect(personalKey('name', 'club')).toBe(false);
    expect(personalKey('clubName')).toBe(false);
  });

  it('rounds ranges outward to two digits', () => {
    expect(roundOut(201.37, 214.88)).toEqual([200, 220]);
    expect(roundOut(0.0123, 0.0456)).toEqual([0.012, 0.046]);
    expect(roundOut(-3.21, 7)).toEqual([-3.3, 7]);
    expect(roundOut(0, 0)).toEqual([0, 0]);
  });

  it('merges shapes: optional fields, both types, spanning ranges', () => {
    const f = found();
    const s = merge(shapeOf({ a: 1, b: 'x' }, f), shapeOf({ a: null, c: true }, f));
    expect(s.object?.fields.a).toMatchObject({ n: 2, null: 1, number: { min: 1, max: 1 } });
    expect(Object.keys(s.object!.fields).sort()).toEqual(['a', 'b', 'c']);
    const file = toFile(observe(newRecording('x', 0), exchangeOf(raw({ url: '/m', responseBody: { text: '[{"a":1},{"b":2}]' } }), f)!), META);
    expect((file.endpoints as any[])[0].response.body.json.array.items.object.optional).toEqual(['a', 'b']);
  });

  it('describes what is not JSON only by type and size, and survives a broken answer', () => {
    const f = found();
    expect(exchangeOf(raw({ url: '/t', responseType: 'text/html', responseBody: { text: '<p>Annika</p>' } }), f)?.response.body).toEqual({ other: { size: 13 } });
    expect(exchangeOf(raw({ url: '/j', responseBody: { text: '{"broken":' } }), f)?.response.body).toEqual({ skipped: 'not_json' });
    expect(exchangeOf(raw({ url: 'javascript:alert(1)' }), f)).toBeNull();
    expect(exchangeOf(raw({ url: 'http://[bad' }), f)).toBeNull();
  });
});

describe('reading a page\'s post again', () => {
  it('takes everything a page makes, as it travels (JSON)', () => {
    const f = found();
    for (const seen of portalSeen(f)) expect(readSeen(JSON.parse(JSON.stringify(seen)))).toEqual(JSON.parse(JSON.stringify(seen)));
    expect(readHashes([...f.personal])).toHaveLength(f.personal.size);
    const other = exchangeOf(raw({ url: '/x', responseType: 'text/plain', responseBody: { text: 'hello' } }), f);
    expect(readSeen(JSON.parse(JSON.stringify(other)))).not.toBeNull();
  });

  it('drops anything else', () => {
    const [x] = portalSeen();
    const copy = () => JSON.parse(JSON.stringify(x));
    expect(readSeen(null)).toBeNull();
    expect(readSeen({ ...copy(), kind: 'other' })).toBeNull();
    expect(readSeen({ ...copy(), extra: ACCESS })).toBeNull();
    expect(readSeen({ ...copy(), request: { ...copy().request, token: ACCESS } })).toBeNull();
    expect(readSeen({ ...copy(), response: { headers: [], body: { other: { size: 3, text: 'abc' } } } })).toBeNull();
    expect(readSeen({ ...copy(), response: { headers: [], body: { json: { n: 1, string: { n: 1, looks: ['text'], values: { [ACCESS]: 1 } } } } } })).toBeNull();
    expect(readSeen({ ...copy(), response: { headers: [], body: { json: { n: 1, object: { n: 1, fields: { a: { n: 1, raw: PERSON.email } } } } } } })).toBeNull();
    expect(readSeen({ kind: 'storage', host: 'h', local: {}, session: {}, cookies: [], values: [COOKIE] })).toBeNull();
    expect(readHashes(['abc', 'NOT'])).toBeNull();
    expect(readHashes('abc')).toBeNull();
  });
});
