// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { ProTournament } from '@glmsync/spec';
import type { TourPage } from './page.ts';
import {
  checkPickRun, mayStart, nextPickStep, progressOf, reachSince, sameAddress, seasonsOf, seePickRun, startPickRun, stopPickRun,
  TOUR_CLICKS, withinReach, type PickRun, type PickStep,
} from './run.ts';

const T0 = Date.UTC(2026, 10, 26, 12);
const mid = () => 0.5;
const PLAN: PickStep[] = [
  { key: 'a', do: 'open', url: 'https://www.example-tour.test/players/lena-beispiel-1/results/?tour=x' },
  { key: 'b', do: 'pick', picker: null, value: '2026' },
  { key: 'c', do: 'pick', picker: 'Season', value: '2025' },
];
const step = (run: PickRun, now: number) => nextPickStep(run, now, mid);

describe('the reach of a run (decision 51)', () => {
  it('goes two years back, and picks the seasons from this one to the one it begins in', () => {
    expect(reachSince('2026-11-26')).toBe('2024-11-26');
    expect(reachSince('2028-02-29')).toBe('2026-02-28');
    expect(seasonsOf('2026-11-26')).toEqual([2026, 2025, 2024]);
    expect(seasonsOf('2026-11-26', true)).toEqual([2027, 2026, 2025, 2024]);
  });

  it('sends only the tournaments of the reach, the newest 50', () => {
    const t = (start: string): ProTournament => ({ ref: `r-${start}`, tour: 'let', name: 'X', start, rounds: [{ round_no: 1, gross: 70, holes: 18 }] });
    const days = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2026, 10, 1) - i * 86400000 * 7).toISOString().slice(0, 10));
    const page: TourPage = { site: 'tour:let', id: '1', name: 'Lena Beispiel', ranking: { source: 'tour:let', as_of: '2026-11-26', rank: 3 }, tournaments: [t('2023-05-01'), ...days.map(t)], stats: [] };
    const out = withinReach(page, '2026-11-26');
    expect(out.tournaments).toHaveLength(TOUR_CLICKS.max_tournaments);
    expect(out.tournaments[0]?.start).toBe('2026-11-01');
    expect(out.tournaments.every((x) => (x.start ?? '') >= '2024-11-26')).toBe(true);
    expect(out.ranking.rank).toBe(3);
  });
});

describe('a run of pages opened and pickers picked', () => {
  it('takes the steps one at a time, with a person\'s pause after each answer', () => {
    let run = startPickRun('europeantour', '1', PLAN, T0);
    let s = step(run, T0);
    expect(s.step).toEqual(PLAN[0]);
    run = s.run;
    expect(step(run, T0 + 500).step).toEqual({ do: 'wait', ms: 1000 });
    // The page opened (its address with the slash left off) answers the step.
    run = seePickRun(run, { url: 'https://www.example-tour.test/players/lena-beispiel-1/results?tour=x', outcome: 'read' }, T0 + 2000, mid);
    expect(run.done).toEqual(['a']);
    const w = step(run, T0 + 2000).step;
    expect(w.do === 'wait' && w.ms >= TOUR_CLICKS.pause_ms[0] && w.ms <= TOUR_CLICKS.pause_ms[1]).toBe(true);
    s = step(run, T0 + 12000);
    expect(s.step).toEqual(PLAN[1]);
    expect(progressOf(s.run)).toEqual({ done: 1, total: 3 });
  });

  it('a pick the page doesn\'t offer is skipped at once; another pick\'s answer or another page is no answer', () => {
    let run = startPickRun('pgatour', '1', PLAN.slice(1), T0);
    run = step(run, T0).run;
    expect(seePickRun(run, { key: 'c', url: 'https://x.test/', outcome: 'read' }, T0, mid)).toBe(run);
    run = seePickRun(run, { key: 'b', url: 'https://x.test/', outcome: 'absent' }, T0 + 100, mid);
    expect(run.skipped).toEqual(['b']);
    expect(step(run, T0 + 100).step).toEqual(PLAN[2]);
  });

  it('a page not answering in time is a miss; three in a row end the run', () => {
    let run = startPickRun('europeantour', '1', [...PLAN, { key: 'd', do: 'open', url: 'https://x.test/d' }], T0);
    let now = T0;
    const opened: string[] = [];
    let s = step(run, now);
    for (let i = 0; i < 500 && s.step.do !== 'end'; i += 1) {
      if (s.step.do === 'open' || s.step.do === 'pick') opened.push(s.step.key);
      run = s.run;
      now += s.step.do === 'wait' ? s.step.ms : 1;
      s = step(run, now);
    }
    // Nothing ever answered: the third miss ends it, the fourth step is never taken.
    expect(opened).toEqual(['a', 'b', 'c']);
    expect(s.run).toMatchObject({ phase: 'stopped', why: 'no_answer', failed: ['a', 'b', 'c'] });
  });

  it('another player\'s page ends it; Stop ends it; nothing to do is done at once', () => {
    const run = step(startPickRun('alps', 'van054', PLAN.slice(1), T0), T0).run;
    expect(seePickRun(run, { key: 'b', url: 'https://x.test/', player: 'abc123', outcome: 'read' }, T0, mid)).toMatchObject({ phase: 'stopped', why: 'other_player' });
    expect(stopPickRun(run, T0, 'cancelled')).toMatchObject({ phase: 'stopped', why: 'cancelled' });
    expect(startPickRun('alps', 'van054', [], T0)).toMatchObject({ phase: 'done', ended: T0 });
  });

  it('runs at most its steps, each once', () => {
    const many: PickStep[] = Array.from({ length: 40 }, (_, i) => ({ key: `k${i % 35}`, do: 'pick', picker: null, value: String(i) }));
    expect(startPickRun('x', '1', many, T0).queue).toHaveLength(TOUR_CLICKS.max_steps);
    expect(new Set(startPickRun('x', '1', many, T0).queue.map((s) => s.key)).size).toBe(TOUR_CLICKS.max_steps);
  });

  it('three runs a day; a run as kept is read again strictly', () => {
    expect(mayStart([T0 - 1000, T0 - 2000], T0)).toBe(true);
    expect(mayStart([T0 - 1000, T0 - 2000, T0 - 3000], T0)).toBe(false);
    expect(mayStart([T0 - 90000000, T0 - 2000, T0 - 3000], T0)).toBe(true);
    const run = step(startPickRun('alps', 'van054', PLAN, T0), T0).run;
    expect(checkPickRun(JSON.parse(JSON.stringify(run)))).toEqual(run);
    expect(checkPickRun({ ...run, queue: [{ key: 'x', do: 'click' }] })).toBeNull();
    expect(checkPickRun('nonsense')).toBeNull();
  });

  it('knows an address in any spelling of its query', () => {
    expect(sameAddress('https://a.test/p/?x=1&y=2', 'https://a.test/p?y=2&x=1')).toBe(true);
    expect(sameAddress('https://a.test/p?x=1', 'https://a.test/p?x=2')).toBe(false);
    expect(sameAddress('not a url', 'https://a.test/')).toBe(false);
  });
});
