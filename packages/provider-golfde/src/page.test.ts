// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { GRAPHQL_URL, type Seen } from './observe.ts';
import { watchPage, type PageWindow } from './page.ts';
import { entry, historyAnswer, memberAnswer, PERSONAL, resultsAnswer, scoringAnswer } from './testing.ts';

/** A made-up XMLHttpRequest: answers from a table, like the browser's (open, send, load). */
function fakeXhr(answers: Record<string, unknown>) {
  return class FakeXhr {
    status = 0;
    responseType: '' | 'text' | 'json' = '';
    responseText = '';
    response: unknown = null;
    private url = '';
    private listeners: (() => void)[] = [];
    open(_method: string, url: string) {
      this.url = url;
    }
    addEventListener(_: string, fn: () => void) {
      this.listeners.push(fn);
    }
    send(_body?: unknown) {
      const a = answers[this.url];
      this.status = a === undefined ? 404 : 200;
      this.responseText = a === undefined ? '' : JSON.stringify(a);
      this.response = this.responseType === 'json' ? a : this.responseText;
      queueMicrotask(() => this.listeners.forEach((l) => l()));
    }
  };
}

function page(answers: Record<string, unknown>) {
  const asked: { url: string; init?: RequestInit | undefined }[] = [];
  const win = {
    location: { href: 'https://www.golf.de/mein-bereich/handicap-history-sheet.html', origin: 'https://www.golf.de' },
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      asked.push({ url, init });
      const op = typeof init?.body === 'string' ? (JSON.parse(init.body) as { operationName?: string }).operationName : undefined;
      const a = answers[op ?? url];
      return new Response(a === undefined ? 'not found' : JSON.stringify(a), { status: a === undefined ? 404 : 200, headers: { 'content-type': 'application/json' } });
    },
    XMLHttpRequest: fakeXhr(answers) as unknown as typeof XMLHttpRequest,
  } satisfies PageWindow;
  const posted: Seen[] = [];
  watchPage(win, (s) => posted.push(s));
  return { win, asked, posted };
}

const settle = () => new Promise((done) => setTimeout(done, 20));
const gql = (op: string) => ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-client-id': 'the-page-s-own' }, body: JSON.stringify({ operationName: op, query: '…', variables: { first: 10 } }) });

describe('the page script', () => {
  it('reads along: the page gets its answers untouched, and what was seen is posted', async () => {
    const answers = { GetMemberDetails: memberAnswer(), GetHandicapHistorySheet: historyAnswer([entry(), entry()], 12) };
    const { win, asked, posted } = page(answers);
    const res = await win.fetch(GRAPHQL_URL, gql('GetHandicapHistorySheet'));
    expect(await res.json()).toEqual(answers.GetHandicapHistorySheet); // the page reads its body as always
    await win.fetch(GRAPHQL_URL, gql('GetMemberDetails'));
    await settle();
    expect(posted.map((p) => p.kind).sort()).toEqual(['history', 'member']);
    // Exactly the page's own requests went out, as the page made them: none of its own, none changed.
    expect(asked).toHaveLength(2);
    expect(asked[0]?.init).toEqual(gql('GetHandicapHistorySheet'));
  });

  it('never lets a name or a number of a person leave the page', async () => {
    const own = 'c0ffee00-0000-4000-8000-000000000777';
    const answers = {
      GetMemberDetails: memberAnswer(),
      GetHandicapHistorySheet: historyAnswer([entry({ resultGuid: own }), entry({ tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}` })]),
      GetScoringRecords: scoringAnswer([entry({ resultGuid: own })]),
      'https://api-v2.golf.de/v1.0/tournaments/5001/results': resultsAnswer(own),
    };
    const { win, posted } = page(answers);
    for (const op of ['GetMemberDetails', 'GetHandicapHistorySheet', 'GetScoringRecords']) await win.fetch(GRAPHQL_URL, gql(op));
    await win.fetch('https://api-v2.golf.de/v1.0/tournaments/5001/results');
    await settle();
    expect(posted).toHaveLength(4);
    const text = JSON.stringify(posted);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    for (const word of ['firstName', 'lastName', 'nameOnCard', 'playerName', 'memberNumber', 'scorecardParticipantNumberCVS', 'cvsId', 'dgvPlayerId', 'Otto']) {
      expect(text).not.toContain(word);
    }
  });

  it('reads along on XMLHttpRequest too', async () => {
    const url = 'https://api-v2.golf.de/v1.0/tournaments/5001/results';
    const { win, posted } = page({ [url]: resultsAnswer('c0ffee00-0000-4000-8000-000000000001') });
    const xhr = new win.XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'json';
    xhr.send();
    await settle();
    expect(posted[0]?.kind).toBe('places');
  });

  it('looks at nothing else', async () => {
    const { win, posted } = page({ 'https://www.golf.de/api/news': { firstName: PERSONAL.firstName } });
    await win.fetch('https://www.golf.de/api/news');
    await win.fetch(GRAPHQL_URL, gql('GetResultSubmissions'));
    await settle();
    expect(posted).toEqual([]);
  });

  it('is never in the page’s way: a broken answer, a failing request, a second install', async () => {
    const { win, posted } = page({});
    await win.fetch(GRAPHQL_URL, gql('GetHandicapHistorySheet')); // 404, not JSON
    watchPage(win, () => {
      throw new Error('installed twice');
    });
    const failing = { ...win, fetch: async () => Promise.reject(new TypeError('offline')) } as PageWindow;
    watchPage(failing, () => undefined);
    await expect(failing.fetch(GRAPHQL_URL, gql('GetMemberDetails'))).rejects.toThrow('offline');
    await settle();
    expect(posted).toEqual([]);
  });
});
