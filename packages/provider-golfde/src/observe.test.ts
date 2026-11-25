// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { GRAPHQL_URL, ownLine, readResult, readSeen, reduce, SESSION_URL, watchOf, type Seen } from './observe.ts';
import { AUTH_FAILED, cursorOf, entry, historyAnswer, memberAnswer, PERSONAL, resultsAnswer, scoringAnswer } from './testing.ts';

const gql = (op: string) => JSON.stringify({ operationName: op, query: `query ${op} { me { id } }`, variables: {} });

describe('what the page script looks at', () => {
  it('golf.de’s three GraphQL operations, by POST and by GET', () => {
    expect(watchOf(GRAPHQL_URL, 'POST', gql('GetHandicapHistorySheet'))).toEqual({ kind: 'graphql', op: 'GetHandicapHistorySheet' });
    expect(watchOf(`${GRAPHQL_URL}?operationName=GetMemberDetails&query=x`, 'GET', null)).toEqual({ kind: 'graphql', op: 'GetMemberDetails' });
    expect(watchOf(GRAPHQL_URL, 'post', gql('GetScoringRecords'))).toEqual({ kind: 'graphql', op: 'GetScoringRecords' });
  });

  it('a result list and the session', () => {
    expect(watchOf('https://api-v2.golf.de/v1.0/tournaments/5001/results', 'GET', null)).toEqual({ kind: 'results', tournament: '5001' });
    expect(watchOf(SESSION_URL, 'GET', null)).toEqual({ kind: 'session' });
  });

  it('nothing else', () => {
    expect(watchOf(GRAPHQL_URL, 'POST', gql('GetClubVsAllHcpiToScoreDifferences'))).toBeNull();
    expect(watchOf(GRAPHQL_URL, 'POST', gql('GetResultSubmissions'))).toBeNull();
    expect(watchOf(GRAPHQL_URL, 'POST', 'not json')).toBeNull();
    expect(watchOf(GRAPHQL_URL, 'POST', null)).toBeNull();
    expect(watchOf('https://api-v2.golf.de.evil.test/graphql', 'POST', gql('GetMemberDetails'))).toBeNull();
    expect(watchOf('http://api-v2.golf.de/graphql', 'POST', gql('GetMemberDetails'))).toBeNull();
    expect(watchOf('https://api-v2.golf.de/v1.0/tournaments/5001/results', 'POST', null)).toBeNull();
    expect(watchOf('https://api-v2.golf.de/v1.0/tournaments/x/results', 'GET', null)).toBeNull();
    expect(watchOf('https://membership-card-api.golf.de/tournaments/5001/rounds/1/scorecards/abc/details', 'GET', null)).toBeNull();
    expect(watchOf('::', 'GET', null, 'nonsense')).toBeNull();
  });
});

describe('what it makes of an answer', () => {
  const op = (o: 'GetMemberDetails' | 'GetHandicapHistorySheet' | 'GetScoringRecords') => ({ kind: 'graphql', op: o }) as const;

  it('a page of the History Sheet: its results and how many there are in all', () => {
    const seen = reduce(op('GetHandicapHistorySheet'), 200, historyAnswer([entry(), entry({ tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}` })], 37));
    expect(seen).toMatchObject({ kind: 'history', total: 37 });
    expect((seen as Extract<Seen, { kind: 'history' }>).results).toHaveLength(2);
  });

  it('the Scoring Record', () => {
    const seen = reduce(op('GetScoringRecords'), 200, scoringAnswer([entry()]));
    expect(seen).toMatchObject({ kind: 'scoring', results: [{ sd: 11.2, pcc: 0, exceptional: 0 }] });
  });

  it('the account', () => {
    expect(reduce(op('GetMemberDetails'), 200, memberAnswer())).toEqual({ kind: 'member', subject: 'member:123456', index: { value: 8.1, low: 7.4 } });
  });

  it('of a result list only ids, places and sizes', () => {
    const own = 'c0ffee00-0000-4000-8000-000000000999';
    const seen = reduce({ kind: 'results', tournament: '5001' }, 200, resultsAnswer(own, 7, 41));
    expect(seen?.kind).toBe('places');
    const lines = (seen as Extract<Seen, { kind: 'places' }>).lines;
    expect(ownLine(lines, own)).toEqual({ ref: own, place: 7, field: 42, list: 'net' });
    const text = JSON.stringify(seen);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    expect(text).not.toContain('Otto');
  });

  it('signed out, however golf.de says it', () => {
    expect(reduce(op('GetHandicapHistorySheet'), 200, AUTH_FAILED)).toEqual({ kind: 'signed_out' });
    expect(reduce(op('GetMemberDetails'), 401, null)).toEqual({ kind: 'signed_out' });
    expect(reduce({ kind: 'session' }, 200, { authenticated: false })).toEqual({ kind: 'signed_out' });
    expect(reduce({ kind: 'session' }, 200, { authenticated: true, user: { name: PERSONAL.nameOnCard } })).toBeNull();
  });

  it('a shape it doesn’t know: changed_page, and nothing read of it', () => {
    expect(reduce(op('GetHandicapHistorySheet'), 200, { data: { me: { reports: { handicapHistorySheet: { items: [] } } } } })).toEqual({ kind: 'changed_page', what: 'GetHandicapHistorySheet' });
    expect(reduce(op('GetHandicapHistorySheet'), 200, historyAnswer([{ when: 'yesterday' }]))).toEqual({ kind: 'changed_page', what: 'GetHandicapHistorySheet' });
    expect(reduce(op('GetScoringRecords'), 200, { data: { me: { reports: { scoringRecords: 'none' } } } })).toEqual({ kind: 'changed_page', what: 'GetScoringRecords' });
    expect(reduce(op('GetMemberDetails'), 200, { data: { me: { reports: { memberDetails: {} } } } })).toEqual({ kind: 'changed_page', what: 'GetMemberDetails' });
    expect(reduce({ kind: 'results', tournament: '1' }, 200, { tournament: {} })).toEqual({ kind: 'changed_page', what: 'results' });
    expect(reduce(op('GetMemberDetails'), 200, [])).toEqual({ kind: 'changed_page', what: 'GetMemberDetails' });
  });

  it('an empty History Sheet is no changed page', () => {
    expect(reduce(op('GetHandicapHistorySheet'), 200, historyAnswer([], 0))).toEqual({ kind: 'history', results: [], total: 0, page: 1 });
  });

  it('nothing for an error golf.de’s page shows itself', () => {
    expect(reduce(op('GetHandicapHistorySheet'), 500, null)).toBeNull();
    expect(reduce(op('GetHandicapHistorySheet'), 200, { errors: [{ message: 'boom' }] })).toBeNull();
  });

  it('a page of the History Sheet: its number, golf.de’s cursor of the next one and each result’s tournament (for Fetch all)', () => {
    const a = entry({ scorecardTournamentNumber: 5001 });
    const b = entry({ scorecardTournamentNumber: '5002' });
    const c = entry({ scorecardTournamentNumber: null });
    const seen = reduce(op('GetHandicapHistorySheet'), 200, historyAnswer([a, b, c], 37, 2, 4));
    expect(seen).toMatchObject({ kind: 'history', page: 2, next: cursorOf(3) });
    expect((seen as Extract<Seen, { kind: 'history' }>).links).toEqual([
      { ref: a.resultGuid, tournament: '5001' },
      { ref: b.resultGuid, tournament: '5002' },
    ]);
    // The last page has no next one; a cursor golf.de's page couldn't have sent is not passed on.
    expect(reduce(op('GetHandicapHistorySheet'), 200, historyAnswer([a], 37, 4, 4))).not.toHaveProperty('next');
    const odd = historyAnswer([a], 37, 1, 2) as { data: { me: { reports: { handicapHistorySheet: { pageInfo: { forwardCursors: unknown[] } } } } } };
    odd.data.me.reports.handicapHistorySheet.pageInfo.forwardCursors = [{ cursor: 'has spaces <script>', page: 2 }];
    expect(reduce(op('GetHandicapHistorySheet'), 200, odd)).not.toHaveProperty('next');
    // Nothing of it names anyone.
    const text = JSON.stringify(seen);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
  });
});

describe('what a page posted, read again', () => {
  it('passes what the page script makes', () => {
    const seen = reduce({ kind: 'graphql', op: 'GetHandicapHistorySheet' }, 200, historyAnswer([entry()], 1));
    expect(readSeen(JSON.parse(JSON.stringify(seen)))).toEqual(seen);
  });

  it('a page’s number, cursor and links, read strictly', () => {
    const r = { played_on: '2026-10-03', par: 72 };
    expect(readSeen({ kind: 'history', results: [r], page: 2, next: 'abc=', links: [{ ref: 'g', tournament: '5001' }] })).toEqual({ kind: 'history', results: [r], page: 2, next: 'abc=', links: [{ ref: 'g', tournament: '5001' }] });
    expect(readSeen({ kind: 'history', results: [r], page: 0, next: 'a b', links: [{ ref: 'g', tournament: '50x1' }, { ref: '', tournament: '1' }] })).toEqual({ kind: 'history', results: [r] });
    expect(readSeen({ kind: 'history', results: [r], links: new Array(51).fill({ ref: 'g', tournament: '1' }) })).toEqual({ kind: 'history', results: [r] });
  });

  it('drops a field nobody mapped, and a marker’s name', () => {
    const r = readResult({ played_on: '2026-10-03', par: 72, playerName: PERSONAL.nameOnCard, format: 'rpr', name: `RPR: ${PERSONAL.marker}` });
    expect(r).toEqual({ played_on: '2026-10-03', par: 72, format: 'rpr' });
  });

  it('drops values out of range or of the wrong kind', () => {
    expect(readResult({ played_on: '2026-10-03', par: 72.5, slope: '131', cr: 71.4, gbe: -1, holes_read: 10, counting: 'yes' })).toEqual({ played_on: '2026-10-03', cr: 71.4 });
    expect(readResult({ played_on: 'today', par: 72 })).toBeNull();
    expect(readResult({ played_on: '2026-10-03' })).toBeNull();
  });

  it('refuses what isn’t one', () => {
    expect(readSeen(null)).toBeNull();
    expect(readSeen({ kind: 'nonsense' })).toBeNull();
    expect(readSeen({ kind: 'member', subject: '' })).toBeNull();
    expect(readSeen({ kind: 'history', results: 'x' })).toBeNull();
    expect(readSeen({ kind: 'history', results: new Array(51).fill({ played_on: '2026-10-03', par: 72 }) })).toBeNull();
    expect(readSeen({ kind: 'places', tournament: 'x', lines: [] })).toBeNull();
    expect(readSeen({ kind: 'places', tournament: '1', lines: [{ ref: 'a', place: 3, field: 2, list: 'net' }, { ref: 'b', place: 1, field: 2, list: 'team' }] })).toEqual({ kind: 'places', tournament: '1', lines: [] });
    expect(readSeen({ kind: 'member', subject: 'x', index: { value: 'eight' } })).toEqual({ kind: 'member', subject: 'x' });
  });
});
