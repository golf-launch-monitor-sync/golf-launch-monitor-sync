// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { ownLine, readProfile, type Profile } from './progolftour.ts';
import { mayStart, nextStep, seeRun, startRun, stopRun, TOUR_CLICKS, type RunState } from './progolftour-run.ts';
import { pgtLine, pgtProfile, pgtResult } from './testing.ts';

const T0 = Date.UTC(2026, 10, 25, 12);
const mid = () => 0.5;
const profile = (): Profile => {
  const p = readProfile(pgtProfile());
  if (p?.kind !== 'profile') throw new Error('no profile');
  return p;
};
const open = (run: RunState, now: number) => nextStep(run, now, mid);

describe('Fetch all on the Pro Golf Tour', () => {
  it('opens his finished tournaments newest first, skipping what the client has', () => {
    const run = startRun(profile(), ['made-up-final-2026'], {}, '2026-11-25', T0);
    expect(run.queue).toEqual(['beispiel-köln-classic-2026', 'sample-desert-open-2026']);
    const first = open(run, T0);
    expect(first.step).toEqual({ do: 'open', url: 'https://www.progolftour.de/tournament-details/beispiel-k%C3%B6ln-classic-2026' });
  });

  it('nothing to open: done at once; a tournament still running or opened this week waits', () => {
    expect(startRun(profile(), [], {}, '2026-03-04', T0)).toMatchObject({ phase: 'done', queue: [] });
    const recent = { 'made-up-final-2026': T0 - 2 * 86400000, 'sample-desert-open-2026': T0 - 8 * 86400000 };
    expect(startRun(profile(), [], recent, '2026-11-25', T0).queue).toEqual(['beispiel-köln-classic-2026', 'sample-desert-open-2026']);
  });

  it('waits for the page, then a person\'s pause (never under the site\'s crawl delay) before the next', () => {
    let { run } = open(startRun(profile(), [], {}, '2026-11-25', T0), T0);
    expect(open(run, T0 + 500).step).toEqual({ do: 'wait', ms: 1000 });
    const read = ownLine(pgtResult('made-up-final-2026', [pgtLine('1', 'Lena Beispiel', 68, 67, 66)]), 'Lena Beispiel');
    run = seeRun(run, read, 'made-up-final-2026', T0 + 2000, mid);
    expect(run.done).toEqual(['made-up-final-2026']);
    const w = open(run, T0 + 2000).step;
    expect(w.do === 'wait' && w.ms >= 5000 && w.ms <= TOUR_CLICKS.pause_ms[1]).toBe(true);
    expect(open(run, T0 + 2000 + 8000).step.do).toBe('open');
  });

  it('a page without his line is noted and the run goes on; a changed page stops it', () => {
    let { run } = open(startRun(profile(), [], {}, '2026-11-25', T0), T0);
    run = seeRun(run, ownLine(pgtResult('made-up-final-2026'), 'Lena Beispiel' + ' X'), 'made-up-final-2026', T0 + 1000, mid);
    expect([run.phase, run.failed]).toEqual(['pages', ['made-up-final-2026']]);
    ({ run } = open(run, T0 + 20000));
    run = seeRun(run, { kind: 'unread', why: 'changed_page' }, 'beispiel-köln-classic-2026', T0 + 21000, mid);
    expect([run.phase, run.why, run.awaiting]).toEqual(['stopped', 'changed_page', undefined]);
    expect(open(run, T0 + 30000).step).toEqual({ do: 'end' });
  });

  it('another page than the one opened changes nothing', () => {
    const { run } = open(startRun(profile(), [], {}, '2026-11-25', T0), T0);
    expect(seeRun(run, ownLine(pgtResult('other-2026'), 'Lena Beispiel'), 'other-2026', T0 + 1, mid)).toBe(run);
    expect(seeRun(run, readProfile(pgtProfile()), 'made-up-final-2026', T0 + 1, mid)).toBe(run);
  });

  it('pages that don\'t answer: on to the next, and after three in a row the run gives up', () => {
    let run = startRun(profile(), [], {}, '2026-11-25', T0);
    let now = T0;
    for (let i = 0; i < 3; i += 1) {
      ({ run } = open(run, now));
      now += TOUR_CLICKS.answer_wait_ms + 1;
      if (i < 2) {
        const s = open(run, now);
        run = s.run;
        expect(s.step.do).toBe('wait');
        now = run.ready;
      }
    }
    const last = open(run, now);
    expect([last.run.phase, last.run.why, last.run.failed.length, last.step.do]).toEqual(['stopped', 'no_answer', 3, 'end']);
  });

  it('runs through to done, and Stop ends it where it is', () => {
    let run = startRun(profile(), ['made-up-final-2026', 'sample-desert-open-2026'], {}, '2026-11-25', T0);
    ({ run } = open(run, T0));
    run = seeRun(run, ownLine(pgtResult('beispiel-k%C3%B6ln-classic-2026', [pgtLine('MC', 'Lena Beispiel', 74, 76)]), 'Lena Beispiel'), 'beispiel-köln-classic-2026', T0 + 1, mid);
    const end = open(run, T0 + 60000);
    expect([end.step, end.run.phase, end.run.done]).toEqual([{ do: 'end' }, 'done', ['beispiel-köln-classic-2026']]);
    const other = startRun(profile(), [], {}, '2026-11-25', T0);
    expect(stopRun(other, T0 + 1, 'cancelled')).toMatchObject({ phase: 'stopped', why: 'cancelled', ended: T0 + 1 });
    expect(stopRun(end.run, T0 + 2, 'cancelled')).toBe(end.run);
  });

  it('three runs a day at most', () => {
    expect(mayStart([T0 - 1000, T0 - 2000], T0)).toBe(true);
    expect(mayStart([T0 - 1000, T0 - 2000, T0 - 3000], T0)).toBe(false);
    expect(mayStart([T0 - 90000000, T0 - 2000, T0 - 3000], T0)).toBe(true);
  });
});
