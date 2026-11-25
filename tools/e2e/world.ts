// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The click checks' world: everything the browser would reach on the network, answered in the test
 * instead - the web app from its build, a made-up Trackman portal and API, a made-up golf.de (its pages make their
 * own requests, as golf.de's do), a made-up OWGR player page, and a made-up target app. Nothing leaves the machine; all data is synthetic.
 */

import type { BrowserContext, Route } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../packages/core/src/http.ts';
import { FakeHcpTarget, FakeProTarget, FakeTarget, type PlanAsked } from '../../packages/core/src/testing/index.ts';
import { entry, historyAnswer, memberAnswer, resultsAnswer, scoringAnswer } from '../../packages/provider-golfde/src/testing.ts';
import { GRAPHQL_URL } from '../../packages/provider-trackman/src/client.ts';
import { FakeTrackman, fakeToken } from '../../packages/provider-trackman/src/testing.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WEB_DIST = join(ROOT, 'apps', 'web', 'dist');
export const WEB = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync';
export const PORTAL = 'https://portal.trackmangolf.com/';
/** The made-up target app's own page (its web app), on the target's origin. */
export const APP_PAGE = 'https://app.example.org/profile';
export const TARGET = 'https://app.example.org/lm/v1';
export const CODE = 'K7M2PQ9X';
/** A test code of the made-up target's test account (test mode, spec/test-mode.md). */
export const TEST_CODE = 'T17K2M9Q';
export const TEST_SUBJECT = 'example-test-T17-neu-leon';
const DAY = 86_400_000;
/** The made-up target app's handicap API (spec/hcp.md) and its pairing code. */
export const HCP_TARGET = 'https://app.example.org/hcp/v1';
export const HCP_CODE = 'H7M2PQ9X';
export const GOLFDE_HISTORY = 'https://www.golf.de/mein-bereich/handicap-history-sheet.html';
export const GOLFDE_RESULTS = 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/5001/ergebnisse';
/** A header the made-up golf.de page puts on its own requests: one without it would not be golf.de's page's. */
export const GOLFDE_PAGE_HEADER = 'x-made-up-golfde-page';

/** The made-up target app's API for a pro's pages (spec/prores.md; a real target may use its handicap API) and its code. */
export const PRO_TARGET = 'https://app.example.org/pro/v1';
export const PRO_CODE = 'P7M2PQ9X';
/** A made-up player's page on OWGR (made-up name, made-up tournaments). */
export const OWGR_PAGE = 'https://www.owgr.com/playerprofile/max-mustermann-90001';

/**
 * The made-up OWGR player page: the head with its figures at once, the table of events a moment later, put in by the
 * page's own script as owgr.com's is. It asks nothing of anyone.
 */
function owgrPage(): string {
  const fig = (v: string, label: string) => `<div><div>${v}</div><div>${label}</div></div>`;
  const row = (name: string, href: string | null, tour: string, week: number, finish: string, points: string) =>
    `<tr><td>${href ? `<a href="${href}"><span>${name}</span></a>` : name}</td><td><button><span>${tour}</span></button></td><td>${week}</td><td>2026</td><td>${finish}</td><td>${points}</td><td>1.0000</td><td>${points}</td><td>4</td><td>3</td></tr>`;
  const table = `<table><thead><tr>${['EVENT', 'TOUR', 'WEEK', 'YEAR', 'FINISH POS.', 'POINTS WON', 'WEIGHT', 'ADJ. POINTS', 'RANK FROM', 'RANK TO'].map((x) => `<th><button>${x}</button></th>`).join('')}</tr></thead><tbody>${[
    row('Musterstadt Open', '/events/musterstadt-open-90012', 'DPWT', 40, 'T17', '2.16597'),
    row('Multi Win Bonus 70% - Musterstadt Open', null, 'DPWT', 40, 'BP', '4.00000'),
    row('A Major Somewhere', '/events/a-major-somewhere-89950', 'Maj', 29, 'MC', '-'),
  ].join('')}</tbody></table>`;
  return `<!doctype html><html><head><title>Official World Golf Ranking - Player Profile</title></head><body>
<main><div><div>Max Mustermann</div><div><div>World number</div><div>412</div></div></div>
<div><div>Statistics</div>${fig('412th', 'Current OWGR Rank')}${fig('390th', 'Best OWGR Rank')}${fig('0.9871', 'Average Points')}${fig('39.48', 'Total Points')}${fig('40', 'Divisor')}${fig('38', 'Actual Events Played')}</div>
<div id="events"><div class="spinner">…</div></div></main>
<script>setTimeout(() => { document.getElementById('events').innerHTML = ${JSON.stringify(table)}; }, 800);</script></body></html>`;
}

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
  // As a target that offers test scenarios to browser clients allows it (spec/test-mode.md).
  'access-control-allow-headers': 'Authorization, Content-Type, X-Test-Code',
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
  /**
   * Where it keeps it: in storage, only in its calls to the API, or - `late` - in storage only `lateMs` after the
   * page loaded, with no call the extension's hooks see (coming back from the sign-in, the portal exchanges its
   * code on its own time: 18 Nov).
   */
  mode: 'storage' | 'fetch' | 'late';
  lateMs?: number;
}

/** The made-up golf.de: the player's record (made-up, with made-up names), and every request that reached its API. */
export class GolfDe {
  signedIn = true;
  readonly own = entry({ resultGuid: 'c0ffee00-0000-4000-8000-0000000e2e01' });
  nodes = [this.own, entry({ tournamentDate: '2026-09-12T10:00:00+02:00', ratedGrossResult: 88 }), entry({ tournamentType: 8, tournamentName: 'RPR: Max Markersmann', tournamentDate: '2026-08-02T10:00:00+02:00' })];
  /**
   * The pages as golf.de's are built (spec/hcp.md, clicking for the player): the History Sheet a web component with an
   * open shadow root, ten entries a page with its pager's links (`#/??first=10&after=<cursor>`) and the Scoring Record
   * behind its button; the result list by `#/<tournament>/ergebnisse` on one page. Off: every page loads it all at
   * once (the reading-along checks).
   */
  built = false;
  readonly apiSaw: { url: string; op: string | null; page: boolean }[] = [];

  /** golf.de's API, as the page's own requests reach it. */
  answer(url: string, body: string | null): unknown {
    const ask = body ? (JSON.parse(body) as { operationName?: string; variables?: { after?: string | null } }) : null;
    const op = ask?.operationName ?? null;
    if (!this.signedIn && op) return { data: null, errors: [{ message: 'no', extensions: { code: 'AUTH_FAILED' } }] };
    if (op === 'GetMemberDetails') return memberAnswer();
    if (op === 'GetHandicapHistorySheet') {
      if (!this.built) return historyAnswer(this.nodes, this.nodes.length);
      const after = ask?.variables?.after;
      const from = after ? Number(/^cursor:(\d+)$/.exec(atob(after))?.[1] ?? 0) : 0;
      return historyAnswer(this.nodes.slice(from, from + 10), this.nodes.length, from / 10 + 1, Math.ceil(this.nodes.length / 10));
    }
    if (op === 'GetScoringRecords') return scoringAnswer(this.built ? this.nodes.slice(0, 20) : [this.own]);
    const list = /\/v1\.0\/tournaments\/(\d+)\/results/.exec(url)?.[1];
    const mine = this.nodes.find((n) => String(n.scorecardTournamentNumber) === list && n.tournamentType !== 8);
    if (mine) return resultsAnswer(mine.resultGuid as string);
    return { errors: [{ message: 'unknown' }] };
  }

  /** A made-up page of *Mein Bereich* or the result list: it asks golf.de's API itself, as golf.de's page does. */
  page(path: string): string {
    const header = JSON.stringify({ 'content-type': 'application/json', 'x-client-id': 'made-up-page-client-id', [GOLFDE_PAGE_HEADER]: '1' });
    if (this.built) return this.builtPage(path, header);
    const gql = (op: string) => `fetch('https://api-v2.golf.de/graphql', { method: 'POST', credentials: 'include', headers: ${header}, body: JSON.stringify({ operationName: '${op}', query: 'query ${op} { me { id } }', variables: {} }) })`;
    const calls = path.startsWith('/sport/')
      ? `fetch('https://api-v2.golf.de/v1.0/tournaments/5001/results', { headers: ${header} })`
      : `${gql('GetMemberDetails')}.then(() => ${gql('GetHandicapHistorySheet')}).then(() => ${gql('GetScoringRecords')})`;
    return `<!doctype html><html><head><title>golf.de (made up)</title></head><body><h1>Made-up golf.de</h1><p>Alexandra Beispielspielerin</p><script>${calls};</script></body></html>`;
  }

  private builtPage(path: string, header: string): string {
    const head = `const H = ${header}; const gql = (op, variables = {}) => fetch('https://api-v2.golf.de/graphql', { method: 'POST', credentials: 'include', headers: H, body: JSON.stringify({ operationName: op, query: 'query ' + op + ' { me { id } }', variables }) }).then((r) => r.json());`;
    const script = path.startsWith('/sport/')
      ? `${head}
        const load = () => { const m = /^#\\/(\\d+)\\/ergebnisse$/.exec(location.hash); if (m) fetch('https://api-v2.golf.de/v1.0/tournaments/' + m[1] + '/results', { headers: H }); };
        load(); window.addEventListener('hashchange', load);`
      : `${head}
        const host = document.createElement('my-handicap-history-sheet'); document.body.append(host);
        const root = host.attachShadow({ mode: 'open' });
        const after = () => { const m = /[?&]after=([^&]*)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
        const load = () => gql('GetHandicapHistorySheet', { first: 10, after: after() }).then((a) => {
          const info = a.data.me.reports.handicapHistorySheet.pageInfo;
          root.replaceChildren();
          for (const c of info.forwardCursors) { const l = document.createElement('a'); l.href = '#/??first=10&after=' + encodeURIComponent(c.cursor); l.textContent = String(c.page); root.append(l); }
          const b = document.createElement('button'); b.textContent = 'Scoring Record'; b.addEventListener('click', () => gql('GetScoringRecords')); root.append(b);
        });
        gql('GetMemberDetails').then(load); window.addEventListener('hashchange', load);`;
    return `<!doctype html><html><head><title>golf.de (made up)</title></head><body><h1>Made-up golf.de</h1><p>Alexandra Beispielspielerin</p><script>${script}</script></body></html>`;
  }
}

export class World {
  readonly tm = new FakeTrackman();
  readonly target = new FakeTarget({ base: TARGET });
  readonly hcp = new FakeHcpTarget({ base: HCP_TARGET });
  readonly golfde = new GolfDe();
  readonly pro = new FakeProTarget({ base: PRO_TARGET });
  /** Every request that reached owgr.com: only the pages the player opened, never one of the extension's. */
  readonly owgrSaw: { url: string; type: string }[] = [];
  readonly portal: Portal = { token: null, mode: 'storage' };
  /** How often Trackman's sign-out page was opened. */
  signOuts = 0;

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
    const store = `localStorage.setItem('session', JSON.stringify({ user: { access_token: ${token} } }))`;
    const script =
      this.portal.mode === 'storage'
        ? `if (${token}) ${store}; else localStorage.clear();`
        : this.portal.mode === 'late'
          ? `localStorage.clear(); if (${token}) setTimeout(() => ${store}, ${this.portal.lateMs ?? 6000});`
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
    // Trackman's sign-out (made up: a page that says the player is signed out).
    await context.route('https://login.trackmangolf.com/**', (route) => {
      this.signOuts += 1;
      return route.fulfill({ status: 200, body: '<!doctype html><title>Signed out</title><p>You are signed out.</p>', headers: { 'content-type': 'text/html' } });
    });
    await context.route(`${GRAPHQL_URL}*`, (route) => answer(route, this.tm.fetch));
    await context.route('https://app.example.org/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/lm/v1')) return answer(route, this.target.fetch);
      if (path.startsWith('/hcp/v1')) return answer(route, this.hcp.fetch);
      if (path.startsWith('/pro/v1')) return answer(route, this.pro.fetch);
      return route.fulfill({ status: 200, body: '<!doctype html><html><head><title>Example App</title></head><body><h1>Example App</h1></body></html>', headers: { 'content-type': 'text/html' } });
    });
    // The made-up OWGR: a player's page, and its ranking (where the player searches for their page).
    await context.route('https://www.owgr.com/**', (route) => {
      const req = route.request();
      this.owgrSaw.push({ url: req.url(), type: req.resourceType() });
      const path = new URL(req.url()).pathname;
      const body = path.startsWith('/playerprofile/') ? owgrPage() : '<!doctype html><title>Official World Golf Ranking - Ranking</title><h1>World ranking (made up)</h1>';
      return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/html' } });
    });
    // The made-up golf.de: its pages, and its API as the pages' own requests reach it.
    await context.route('https://www.golf.de/**', (route) => route.fulfill({ status: 200, body: this.golfde.page(new URL(route.request().url()).pathname), headers: { 'content-type': 'text/html' } }));
    await context.route('https://api-v2.golf.de/**', async (route) => {
      const req = route.request();
      const cors = { 'access-control-allow-origin': 'https://www.golf.de', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': `content-type, x-client-id, ${GOLFDE_PAGE_HEADER}`, 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const body = req.postData();
      const headers = await req.allHeaders();
      this.golfde.apiSaw.push({ url: req.url(), op: body ? ((JSON.parse(body) as { operationName?: string }).operationName ?? null) : null, page: headers[GOLFDE_PAGE_HEADER] === '1' });
      return route.fulfill({ status: 200, body: JSON.stringify(this.golfde.answer(req.url(), body)), headers: { 'content-type': 'application/json', ...cors } });
    });
  }

  /**
   * The made-up target's account becomes a test account with a scenario for `TEST_CODE` (made up: `sessions`
   * sessions every three days back from yesterday, one round), and the target plans as a real one does: the
   * regular sync over the last three days, the older history in chunks of `chunk` sessions.
   */
  testAccount(sessions = 7, chunk = 2): Record<string, unknown> {
    const now = Date.now();
    const activities = Array.from({ length: sessions }, (_, i) => ({
      __typename: i % 2 ? 'SimulatorSessionActivity' : 'RangePracticeActivity',
      id: `L${i}`,
      time: new Date(now - DAY - i * 3 * DAY).toISOString(),
      kind: i % 2 ? 'SIMULATOR' : 'RANGE_PRACTICE',
    }));
    const nodes = Object.fromEntries(activities.map((a, i) => [a.id, { strokes: [{ club: 'Driver', time: a.time, measurement: { carry: 240 + i, ballSpeed: 74 } }] }]));
    const hole = { holeNumber: 1, pinPosition: { x: 10, z: 20 }, shots: [{ shotNumber: 1, club: 'Driver', launchLie: 'Tee', finalLie: 'Fairway', launchPosition: { x: 10, z: 400 }, finalPosition: { x: 12, z: 160 } }] };
    const scenario = {
      name: 'Leon, never switched',
      provider: 'trackman',
      subject: TEST_SUBJECT,
      profile: { fullName: 'Leon (Test T17)' },
      data: { activities, nodes, scorecards: [{ id: 'R1', startedAt: new Date(now - 2 * DAY).toISOString(), course: { displayName: 'Example Links' }, par: 72, grossScore: 80 }], shotHoles: { R1: [hole] } },
      latency: { default: { median_s: 0, spread_s: 0 }, queries: {} },
      valid_until: new Date(now + 7 * DAY).toISOString(),
    };
    this.target.testAccount = true;
    this.target.scenarios.set(TEST_CODE, scenario);
    (this.target.opts as { plan?: (ask: PlanAsked, t: FakeTarget) => Record<string, unknown> }).plan = (ask, t) => {
      const done = t.imports.some((b) => b.sync?.reason === 'backfill' && b.progress?.more_available === false);
      const base = { plan_id: `pl_${t.imports.length}_${ask.reason}`, known_ids: t.known() };
      if (ask.reason === 'backfill') return done ? { due: false, history: { done: true } } : { ...base, due: true, since: '2011-01-01T00:00:00Z', max_sessions: chunk, rounds: true, round_shots: false, history: { done: false } };
      return { ...base, due: true, since: new Date(Date.now() - 3 * DAY).toISOString(), max_sessions: 40, rounds: true, round_shots: true, history: { done } };
    };
    return scenario;
  }

  /** Every request that reached the made-up target, as text: a Trackman key must never be in it. */
  targetSaw(): string {
    return JSON.stringify(this.target.received);
  }
}
