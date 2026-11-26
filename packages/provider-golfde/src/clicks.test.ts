// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { HCP_CLICKS } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { cancelRun, CLICKS, listsOf, mayOpen, nextStep, readRun, resultsUrl, runView, seeRun, startRun, yearsBefore, type RunState, type Step } from './clicks.ts';
import { HISTORY_SHEET_URL, reduce, type Seen } from './observe.ts';
import { cursorOf, entry, historyAnswer, memberAnswer, resultsAnswer, scoringAnswer } from './testing.ts';

const SUBJECT = (reduce({ kind: 'graphql', op: 'GetMemberDetails' }, 200, memberAnswer()) as Extract<Seen, { kind: 'member' }>).subject;
const T0 = Date.UTC(2026, 10, 25, 12);
const mid = () => 0.5;
const PAUSE = 3000 + Math.floor(0.5 * 3001);

const historyPage = (nodes: Record<string, unknown>[], total: number, page: number, pages: number) =>
  reduce({ kind: 'graphql', op: 'GetHandicapHistorySheet' }, 200, historyAnswer(nodes, total, page, pages)) as Seen;
const scoring = (nodes: Record<string, unknown>[]) => reduce({ kind: 'graphql', op: 'GetScoringRecords' }, 200, scoringAnswer(nodes)) as Seen;
const places = (tournament: string, ref: string) => reduce({ kind: 'results', tournament }, 200, resultsAnswer(ref)) as Seen;

function start(over: Partial<Parameters<typeof startRun>[0]> = {}): RunState {
  return startRun({ subject: SUBJECT, now: T0, today: '2026-11-25', placed: [], recent: [], ...over });
}

/** Asks for the next step at `now`; returns it with the new state. */
function step(s: RunState, now: number): [RunState, Step] {
  const r = nextStep(s, now, mid);
  return [r.state, r.step];
}

describe('the spec’s numbers', () => {
  it('are the ones in spec/hcp/clicks.json, and a person’s pace', () => {
    expect(CLICKS).toBe(HCP_CLICKS);
    expect(CLICKS.max_lists).toBe(100); // 50 before spec 1.16.0
    expect(CLICKS.runs_per_day).toBe(3);
    expect(CLICKS.auto_look_minutes).toBeGreaterThanOrEqual(30);
    expect(CLICKS.list_years).toBe(2);
    expect(CLICKS.pause_ms[0]).toBeGreaterThanOrEqual(3000);
    expect(Object.isFrozen(CLICKS)).toBe(true);
  });
});

describe('a whole run', () => {
  it('every page of the History Sheet, the Scoring Record, then the lists without a place, newest first, with a pause between pages', () => {
    // 23 entries on three pages; tournaments 7001..7023 (one per entry), one an RPR, one from three years ago.
    const nodes = Array.from({ length: 23 }, (_, i) =>
      entry({
        scorecardTournamentNumber: 7001 + i,
        tournamentDate: `2026-${String(10 - Math.floor(i / 3)).padStart(2, '0')}-${String(28 - (i % 3)).padStart(2, '0')}T10:00:00+02:00`,
        ...(i === 4 ? { tournamentType: 8, tournamentName: 'RPR: Max Markersmann' } : {}),
        ...(i === 22 ? { tournamentDate: '2023-06-01T10:00:00+02:00' } : {}),
      }),
    );
    let s = start({ placed: [nodes[1]?.resultGuid as string], recent: ['7003'] });
    let now = T0;
    let st: Step;

    [s, st] = step(s, now);
    expect(st).toEqual({ do: 'open', url: HISTORY_SHEET_URL });
    // Asked again before the page answered: wait for it (never a second step meanwhile).
    [s, st] = step(s, now + 500);
    expect(st.do).toBe('wait');

    now += 2000;
    s = seeRun(s, { kind: 'member', subject: SUBJECT }, now, mid);
    s = seeRun(s, historyPage(nodes.slice(0, 10), 23, 1, 3), now, mid);
    expect(s.pages).toBe(1);
    // The pause after the page: nothing before it.
    [s, st] = step(s, now + 1000);
    expect(st).toEqual({ do: 'wait', ms: PAUSE - 1000 });
    now += PAUSE;
    [s, st] = step(s, now);
    expect(st).toEqual({ do: 'page', cursor: cursorOf(2) });

    now += 1500;
    s = seeRun(s, historyPage(nodes.slice(10, 20), 23, 2, 3), now, mid);
    now += PAUSE;
    [s, st] = step(s, now);
    expect(st).toEqual({ do: 'page', cursor: cursorOf(3) });
    now += 1500;
    s = seeRun(s, historyPage(nodes.slice(20), 23, 3, 3), now, mid);
    expect(runView(s)).toMatchObject({ phase: 'history', entries: 23, total: 23 });

    now += PAUSE;
    [s, st] = step(s, now);
    expect(st).toEqual({ do: 'click', what: 'scoring' });
    now += 1000;
    s = seeRun(s, scoring(nodes.slice(0, 20)), now, mid);

    now += PAUSE;
    [s, st] = step(s, now);
    // 23 tournaments; not the RPR, not the one placed, not the one opened lately, not the one three years ago.
    expect(s.lists_total).toBe(19);
    expect(s.lists).not.toContain('7005');
    expect(s.lists).not.toContain('7002');
    expect(s.lists).not.toContain('7003');
    expect(s.lists).not.toContain('7023');
    expect(st).toEqual({ do: 'open', url: resultsUrl('7001') });
    for (let i = 0; i < 19; i++) {
      const t = s.lists[0] as string;
      const ref = Object.entries(s.links).find(([, l]) => l.tournament === t)?.[0] as string;
      now += 1200;
      s = seeRun(s, places(t, ref), now, mid);
      now += PAUSE;
      [s, st] = step(s, now);
    }
    expect(st).toEqual({ do: 'end' });
    expect(runView(s)).toEqual({ phase: 'done', entries: 23, total: 23, lists_done: 19, lists_total: 19 });
    expect(s.opened).toHaveLength(19);
  });

  it('at most 100 lists, and only of the last two years', () => {
    const nodes = Array.from({ length: 120 }, (_, i) => entry({ scorecardTournamentNumber: 9000 + i, tournamentDate: '2026-05-01T10:00:00+02:00' }));
    const s = seeRun({ ...start(), awaiting: { what: 'history', since: T0 } }, { ...(historyPage(nodes.slice(0, 100), 120, 1, 1) as object), kind: 'history' } as Seen, T0, mid);
    expect(listsOf(s)).toHaveLength(Object.keys(s.links).length); // 100 links, all of them
    const more = seeRun({ ...s, awaiting: { what: 'history', since: T0 } }, historyPage(nodes.slice(100), 120, 2, 2), T0, mid);
    expect(listsOf(more)).toHaveLength(100);
    expect(yearsBefore('2026-11-25', 2)).toBe('2024-11-25');
    expect(yearsBefore('2028-02-29', 2)).toBe('2026-02-28');
    const old = entry({ scorecardTournamentNumber: 1, tournamentDate: '2024-11-24T10:00:00+02:00' });
    const edge = entry({ scorecardTournamentNumber: 2, tournamentDate: '2024-11-25T10:00:00+02:00' });
    const s2 = seeRun({ ...start(), awaiting: { what: 'history', since: T0 } }, historyPage([old, edge], 2, 1, 1), T0, mid);
    expect(listsOf(s2)).toEqual(['2']);
  });

  it('the same tournament twice (two rounds) is one list', () => {
    const r1 = entry({ scorecardTournamentNumber: 4242, tournamentRound: 1, tournamentDate: '2026-07-04T10:00:00+02:00' });
    const r2 = entry({ scorecardTournamentNumber: 4242, tournamentRound: 2, tournamentDate: '2026-07-05T10:00:00+02:00' });
    const s = seeRun({ ...start(), awaiting: { what: 'history', since: T0 } }, historyPage([r2, r1], 2, 1, 1), T0, mid);
    expect(listsOf(s)).toEqual(['4242']);
  });

  it('a History Sheet with one page: straight to the Scoring Record; nothing to open: done', () => {
    let s = start();
    let st: Step;
    [s] = step(s, T0);
    s = seeRun(s, historyPage([entry({ scorecardTournamentNumber: 1, tournamentDate: '2020-01-01T10:00:00+02:00' })], 1, 1, 1), T0 + 100, mid);
    [s, st] = step(s, T0 + 100 + PAUSE);
    expect(st).toEqual({ do: 'click', what: 'scoring' });
    s = seeRun(s, scoring([]), T0 + 200 + PAUSE, mid);
    [s, st] = step(s, T0 + 200 + 2 * PAUSE);
    expect(st).toEqual({ do: 'end' });
    expect(s.phase).toBe('done');
  });

  it('the Scoring Record seen already (golf.de’s page loaded it): not clicked again', () => {
    let s = start();
    let st: Step;
    [s] = step(s, T0);
    s = seeRun(s, scoring([]), T0 + 50, mid);
    s = seeRun(s, historyPage([], 0, 1, 1), T0 + 100, mid);
    [s, st] = step(s, T0 + 100 + PAUSE);
    expect(st).toEqual({ do: 'end' });
  });

  it('never follows the same cursor twice, and stops paging at the most pages', () => {
    let s = start();
    let st: Step;
    [s] = step(s, T0);
    s = seeRun(s, historyPage([entry()], 99, 1, 9), T0, mid);
    [s, st] = step(s, T0 + PAUSE);
    expect(st).toEqual({ do: 'page', cursor: cursorOf(2) });
    // golf.de's page answers with page 1's cursor again (a loop): not followed.
    s = seeRun(s, { kind: 'history', results: [], page: 2, next: cursorOf(2) }, T0 + PAUSE + 10, mid);
    [s, st] = step(s, T0 + 2 * PAUSE + 10);
    expect(st).toEqual({ do: 'click', what: 'scoring' });
    const many = { ...start(), pages: CLICKS.max_history_pages, next: 'zzz' };
    expect(nextStep(many, T0, mid).step).toEqual({ do: 'click', what: 'scoring' });
  });
});

describe('stopping', () => {
  it('signed out, another account, a page that changed, or the player: stopped at once, nothing more asked', () => {
    const s = start();
    for (const [seen, why] of [
      [{ kind: 'signed_out' }, 'signed_out'],
      [{ kind: 'changed_page', what: 'GetHandicapHistorySheet' }, 'changed_page'],
      [reduce({ kind: 'graphql', op: 'GetMemberDetails' }, 200, memberAnswer(999)), 'other_account'],
    ] as const) {
      const after = seeRun(s, seen as Seen, T0 + 1, mid);
      expect(after).toMatchObject({ phase: 'stopped', why, ended: T0 + 1 });
      expect(nextStep(after, T0 + 99_999, mid).step).toEqual({ do: 'end' });
    }
    expect(seeRun(s, reduce({ kind: 'graphql', op: 'GetMemberDetails' }, 200, memberAnswer()) as Seen, T0, mid)).toBe(s);
    expect(cancelRun(s, T0 + 5)).toMatchObject({ phase: 'stopped', why: 'cancelled' });
    // A run over stays over: a later answer changes nothing.
    const done = cancelRun(s, T0 + 5);
    expect(seeRun(done, { kind: 'signed_out' }, T0 + 6, mid)).toBe(done);
  });

  it('no answer from the History Sheet or the Scoring Record: the page changed', () => {
    let s = start();
    [s] = step(s, T0);
    const r = nextStep(s, T0 + CLICKS.answer_wait_ms, mid);
    expect(r.step).toEqual({ do: 'end' });
    expect(r.state).toMatchObject({ phase: 'stopped', why: 'changed_page' });
  });

  it('a result list that doesn’t come is skipped; several in a row: the page changed', () => {
    const nodes = [1, 2, 3, 4].map((n) => entry({ scorecardTournamentNumber: n, tournamentDate: `2026-0${n}-01T10:00:00+02:00` }));
    let s: RunState = { ...start(), phase: 'scoring', scoring: true };
    s = { ...s, links: seeRun({ ...s, phase: 'history', awaiting: { what: 'history', since: T0 } }, historyPage(nodes, 4, 1, 1), T0, mid).links };
    let now = T0;
    let st: Step;
    [s, st] = step(s, now);
    expect(st).toEqual({ do: 'open', url: resultsUrl('4') });
    now += CLICKS.answer_wait_ms;
    [s, st] = step(s, now);
    expect(st.do).toBe('wait'); // skipped, the pause before the next
    expect(s).toMatchObject({ lists_done: 1, missing: 1 });
    now += PAUSE;
    [s, st] = step(s, now);
    expect(st).toEqual({ do: 'open', url: resultsUrl('3') });
    s = seeRun(s, places('3', nodes[2]?.resultGuid as string), now + 10, mid);
    expect(s.missing).toBe(0);
    for (let i = 0; i < 2; i++) {
      now += PAUSE + 20;
      [s] = step(s, now);
      now += CLICKS.answer_wait_ms;
      [s, st] = step(s, now);
    }
    expect(s).toMatchObject({ phase: 'lists', lists: [], missing: 2 }); // two misses after a hit, then nothing left
    [s, st] = step(s, now + PAUSE);
    expect(st).toEqual({ do: 'end' });
    expect(s.phase).toBe('done');
    // Three misses in a row: the page changed.
    let t: RunState = { ...start(), phase: 'lists', scoring: true, lists: ['1', '2', '3', '4'], lists_total: 4 };
    now = T0;
    for (let i = 0; i < 3; i++) {
      [t] = step(t, now);
      now += CLICKS.answer_wait_ms;
      [t, st] = step(t, now);
      now += PAUSE;
    }
    expect(t).toMatchObject({ phase: 'stopped', why: 'changed_page' });
  });

  it('a result list of another tournament than the one opened moves nothing on', () => {
    let s: RunState = { ...start(), phase: 'lists', scoring: true, lists: ['1'], lists_total: 1 };
    [s] = step(s, T0);
    expect(seeRun(s, places('2', 'x'), T0 + 5, mid)).toBe(s);
  });
});

describe('what a run may open', () => {
  it('the History Sheet and a result list, nothing else', () => {
    expect(mayOpen(HISTORY_SHEET_URL)).toBe(true);
    expect(mayOpen(resultsUrl('5001'))).toBe(true);
    expect(mayOpen('https://www.golf.de/mein-bereich.html')).toBe(false);
    expect(mayOpen('https://www.golf.de/sport/turnierkalender/clubturniere.html#/5001/ergebnisse/../x')).toBe(false);
    expect(mayOpen('https://evil.test/#https://www.golf.de/mein-bereich/handicap-history-sheet.html')).toBe(false);
    expect(mayOpen(null)).toBe(false);
  });
});

describe('a kept run', () => {
  it('reads back as it was; anything else is none', () => {
    const s = start({ placed: ['a'], recent: ['1'] });
    expect(readRun(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(readRun(null)).toBeNull();
    expect(readRun({ ...s, v: 2 })).toBeNull();
    expect(readRun({ ...s, phase: 'flying' })).toBeNull();
    expect(readRun({ ...s, lists: [1] })).toBeNull();
  });
});
