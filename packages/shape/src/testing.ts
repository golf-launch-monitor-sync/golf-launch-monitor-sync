// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A made-up portal's traffic for the tests and the click checks: a sign-in, a profile, a list of sessions with shots,
 * a GraphQL call, what it keeps in storage. Everything is invented - the person, the address, the tokens, the numbers -
 * and every value here is one that must not reach the file. `SECRETS` lists them for the tests to look for.
 */

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A made-up token in a JWT's form (its signature means nothing). */
export function madeUpJwt(claims: Record<string, unknown>): string {
  return `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}.bWFkZS11cC1zaWduYXR1cmUtZm9yLXRlc3Rz`;
}

export const PERSON = { first: 'Annika', last: 'Beispielmann', email: 'annika.beispielmann@example.org', slug: 'annika-beispielmann' };
export const USER_ID = '7f3c9a10-55e2-4c1b-9d0e-3b2a1c0d9e8f';
export const SESSION_IDS = ['a1b2c3d4e5f60718293a4b5c', 'b2c3d4e5f60718293a4b5c6d'];
export const NUMERIC_ID = 48151623;
export const ACCESS = madeUpJwt({ sub: USER_ID, email: PERSON.email, name: `${PERSON.first} ${PERSON.last}`, iat: 1795000000, exp: 1795003600, scope: 'sessions:read' });
export const REFRESH = 'rt_9QmZ7xKp2LwV4nB8cD1eF6gH3jK5mN0pQ';
export const API_KEY = 'ak_live_5TzQ8wR2yU7iO4pA1sD6fG9hJ3kL';
export const COOKIE_SID = 'sid-value-Zx81Qw72Er63Ty54';
export const HANDICAP = 12.4;
/** Shots with values that must never stand in the file as they are (only rounded ranges). */
export const SHOTS = [
  { club: 'Driver', carry: 201.37, ballSpeed: 65.21, spin: 2713, unit: 'yards' },
  { club: 'Driver', carry: 214.88, ballSpeed: 67.94, spin: 2488, unit: 'yards' },
  { club: '7 Iron', carry: 143.12, ballSpeed: 51.06, spin: 6911, unit: 'yards' },
  { club: '7 Iron', carry: 148.55, ballSpeed: 52.33, spin: 7102, unit: 'yards' },
];

export const SIGN_IN_ANSWER = {
  access_token: ACCESS,
  refresh_token: REFRESH,
  token_type: 'Bearer',
  expires_in: 3600,
  user: { id: USER_ID, email: PERSON.email, firstName: PERSON.first, lastName: PERSON.last, handicap: HANDICAP, birthYear: 1981 },
};

export const PROFILE_ANSWER = {
  id: USER_ID,
  displayName: `${PERSON.first} ${PERSON.last}`,
  slug: PERSON.slug,
  contact: { mail: PERSON.email, phone: '+49 40 1234567' },
  home: { latitude: 53.5511, longitude: 9.9937 },
  settings: { units: 'yards', language: 'de' },
};

export const SESSIONS_ANSWER = {
  total: 2,
  items: SESSION_IDS.map((id, i) => ({
    id,
    date: `2026-11-${20 + i}T17:3${i}:00Z`,
    name: 'Range session',
    createdAt: 1795100000000 + i,
    coach: `${PERSON.first} ${PERSON.last}`,
    player: { id: USER_ID, name: `${PERSON.first} ${PERSON.last}` },
    shots: SHOTS,
  })),
  byPlayer: { [PERSON.email]: { count: 2 } },
};

export const GRAPHQL_BODY = {
  operationName: 'SessionsOf',
  query: `query SessionsOf($email: String!) { sessions(owner: "${PERSON.email}") { id } }`,
  variables: { email: PERSON.email, playerId: USER_ID, first: 20 },
};

export const LOCAL_STORAGE: [string, string][] = [
  ['auth', JSON.stringify({ accessToken: ACCESS, refreshToken: REFRESH, user: { email: PERSON.email } })],
  ['theme', 'dark'],
  [`last-${PERSON.slug}`, '1'],
];
export const COOKIE = `sid=${COOKIE_SID}; theme=dark; _ga_ABC123XYZ=GA1.1.555.666`;

/** Every value the file must not contain, in any case. */
export const SECRETS: string[] = [
  ACCESS,
  ...ACCESS.split('.'),
  REFRESH,
  API_KEY,
  COOKIE_SID,
  PERSON.email,
  PERSON.first,
  PERSON.last,
  PERSON.slug,
  'annika.beispielmann',
  USER_ID,
  ...SESSION_IDS,
  String(NUMERIC_ID),
  '1234567',
  '2026-11-20T17:30',
  '1795100000000',
  '1795000000',
  'sessions:read',
  'Range session',
  'GA1.1.555.666',
];

/** Numbers that must not stand in the file as they are (the ranges are rounded outward). */
export const EXACT_NUMBERS = [201.37, 214.88, 143.12, 148.55, 65.21, 67.94, 51.06, 52.33, 2713, 2488, 6911, 7102, HANDICAP, 1981, 53.5511, 9.9937];
