// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { GRAPHQL_URL } from '@glmsync/provider-golfde';
import { entry, historyAnswer, memberAnswer, PERSONAL, resultsAnswer } from '@glmsync/provider-golfde/testing';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain script of the build, without types
import { moduleText, OUT } from '../../scripts/golfde-page.mjs';
import { STEP_FUNCTION, stepScript } from './fetchAll.ts';
import { HISTORY_SHEET_URL, readGolfdeMessage } from './golfdePage.ts';
import { GOLFDE_PAGE_SCRIPT } from './golfdePageScript.ts';

describe('the golf.de window’s page script', () => {
  it('is what scripts/golfde-page.mjs writes from the extension’s page script (run it after a change there)', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await moduleText());
  });

  it('evaluates no code of its own and ends as a web view wants', () => {
    expect(GOLFDE_PAGE_SCRIPT).not.toMatch(/\bnew Function\s*\(|\beval\s*\(/);
    expect(GOLFDE_PAGE_SCRIPT.trimEnd().endsWith('true;')).toBe(true);
  });
});

/** golf.de's page, made up: its fetch answers from a table; the script runs in it as the web view runs it. */
function page(href: string, answers: Record<string, unknown>, elements: unknown[] = []) {
  const asked: string[] = [];
  const posted: string[] = [];
  const win: Record<string, unknown> = {
    location: { href, origin: new URL(href).origin, hash: '', assign: (url: string) => asked.push(`assign:${url}`) },
    fetch: async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      asked.push(url);
      const op = typeof init?.body === 'string' ? (JSON.parse(init.body) as { operationName?: string }).operationName : undefined;
      const a = answers[op ?? url];
      return new Response(a === undefined ? 'not found' : JSON.stringify(a), { status: a === undefined ? 404 : 200 });
    },
    XMLHttpRequest: class {},
    document: { querySelectorAll: () => elements },
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    Request,
    Response,
    URL,
    crypto: globalThis.crypto,
    JSON,
  };
  win.window = win;
  runInNewContext(GOLFDE_PAGE_SCRIPT, win);
  return { win, asked, posted, fetch: win.fetch as (url: string, init?: RequestInit) => Promise<Response> };
}

const settle = () => new Promise((done) => setTimeout(done, 20));
const gql = (op: string) => ({ method: 'POST', body: JSON.stringify({ operationName: op, query: '…', variables: { first: 10 } }) });

describe('the page script in golf.de’s page', () => {
  it('reads along on the History Sheet and posts what it saw to the app, with no name and no number', async () => {
    const own = 'c0ffee00-0000-4000-8000-000000000777';
    const answers = {
      GetMemberDetails: memberAnswer(),
      GetHandicapHistorySheet: historyAnswer([entry({ resultGuid: own }), entry({ tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}` })]),
      'https://api-v2.golf.de/v1.0/tournaments/5001/results': resultsAnswer(own),
    };
    const p = page(HISTORY_SHEET_URL, answers);
    const res = await p.fetch(GRAPHQL_URL, gql('GetHandicapHistorySheet'));
    expect(await res.json()).toEqual(answers.GetHandicapHistorySheet); // the page gets its answer untouched
    await p.fetch(GRAPHQL_URL, gql('GetMemberDetails'));
    await p.fetch('https://api-v2.golf.de/v1.0/tournaments/5001/results');
    await settle();
    expect(p.posted).toHaveLength(3);
    const read = p.posted.map((d) => readGolfdeMessage(HISTORY_SHEET_URL, d));
    expect(read.map((r) => r?.seen.kind).sort()).toEqual(['history', 'member', 'places']);
    // One page, one id: its results go to the account it names.
    expect(new Set(read.map((r) => r?.page)).size).toBe(1);
    const all = p.posted.join('\n');
    for (const v of Object.values(PERSONAL)) expect(all).not.toContain(String(v));
    // Only the page's own requests went out.
    expect(p.asked).toHaveLength(3);
  });

  it('stays out of every other page', async () => {
    for (const href of ['https://www.golf.de/', 'https://login.golf.de/', 'https://example.org/mein-bereich.html']) {
      const p = page(href, { GetMemberDetails: memberAnswer() });
      await p.fetch(GRAPHQL_URL, gql('GetMemberDetails'));
      await settle();
      expect(p.posted, href).toEqual([]);
    }
  });

  it('never stands in the page’s way: without the app’s bridge the page goes on', async () => {
    const p = page(HISTORY_SHEET_URL, { GetMemberDetails: memberAnswer() });
    delete p.win.ReactNativeWebView;
    const res = await p.fetch(GRAPHQL_URL, gql('GetMemberDetails'));
    expect(res.status).toBe(200);
    await settle();
  });

  it('takes a step of Fetch all in the page: golf.de’s own button and pager link, or a page that changed; nothing else', async () => {
    const clicked: string[] = [];
    const el = (tagName: string, text: string, attrs: Record<string, string> = {}) => ({ tagName, textContent: text, getAttribute: (n: string) => attrs[n] ?? null, click: () => clicked.push(text) });
    const sheet = { ...el('MY-HANDICAP-HISTORY-SHEET', ''), shadowRoot: { querySelectorAll: () => [el('A', '2', { href: '#/??first=10&after=abc%3D' }), el('BUTTON', 'Scoring Record')] } };
    const p = page(HISTORY_SHEET_URL, {}, [sheet]);
    const step = p.win[STEP_FUNCTION] as (text: string) => void;
    step(JSON.stringify({ do: 'click', what: 'scoring' }));
    step(JSON.stringify({ do: 'page', cursor: 'abc=' }));
    expect(clicked).toEqual(['Scoring Record', '2']);
    // Not taken in the page: an address, nonsense - nothing happens, nothing is asked.
    step(JSON.stringify({ do: 'open', url: 'https://evil.test/' }));
    step('not json');
    step(JSON.stringify({ do: 'page', cursor: 'x'.repeat(301) }));
    expect(clicked).toHaveLength(2);
    expect(p.asked).toEqual([]);
    // No button: the app hears the page changed.
    const bare = page(HISTORY_SHEET_URL, {}, []);
    (bare.win[STEP_FUNCTION] as (text: string) => void)(JSON.stringify({ do: 'click', what: 'scoring' }));
    expect(bare.posted.map((d) => readGolfdeMessage(HISTORY_SHEET_URL, d)?.seen)).toEqual([{ kind: 'changed_page', what: 'GetScoringRecords' }]);
    // The script injected by the app reaches it.
    const viaApp = stepScript({ do: 'click', what: 'scoring' }) as string;
    const q = page(HISTORY_SHEET_URL, {}, [sheet]);
    runInNewContext(viaApp, q.win);
    expect(clicked).toEqual(['Scoring Record', '2', 'Scoring Record']);
  });
});
