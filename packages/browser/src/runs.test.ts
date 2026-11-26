// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { run as pick } from '@glmsync/provider-tours';
import { describe, expect, it } from 'vitest';
import { translator } from './i18n.ts';
import { RunKeeper, runNote } from './runs.ts';

const TODAY = '2026-11-26';
const ALPS = 'https://www.alpstourgolf.com/playerprofile/VAN054';
const ET = 'https://www.europeantour.com/players/lena-beispiel-99001/results/?tour=dpworld-tour';
const t = translator('en');

function clock(start = Date.UTC(2026, 10, 26, 12)) {
  let now = start;
  return { now: () => now, go: (ms: number) => (now += ms) };
}

describe('what a client keeps of Fetch all on the tours', () => {
  it('starts a run on his page, hands its steps only to its tab, and ends it with its tour', async () => {
    const c = clock();
    const k = new RunKeeper(new MemoryStorage(), c.now);
    expect(await k.start('https://www.alpstourgolf.com/stats', 7, TODAY)).toEqual({ outcome: 'nothing' });
    expect(await k.start(ALPS, 7, TODAY)).toEqual({ outcome: 'started', family: 'alps', fresh: true });
    expect(await k.start(ALPS, 7, TODAY)).toEqual({ outcome: 'started', family: 'alps', fresh: false });
    expect(await k.step(8)).toBeNull();
    const first = await k.step(7);
    expect(first).toEqual({ family: 'alps', step: { key: 'report:This Season record', do: 'pick', picker: null, value: 'This Season record' } });
    expect((await k.view()).running).toEqual({ family: 'alps', done: 0, total: 3, tab: 7 });
    expect(runNote(await k.view(), 'alps', t)).toBe('Fetching all for you: step 0 of 3 …');
    // Another tab's answer is none.
    await k.seen(8, { key: 'report:This Season record', url: ALPS, outcome: 'read' });
    expect((await k.view()).running?.done).toBe(0);
    for (const key of ['report:This Season record', 'report:Results', 'report:Order of Merit']) {
      await k.seen(7, { key, url: ALPS, outcome: 'read' });
      c.go(pick.TOUR_CLICKS.pause_ms[1]);
      const s = await k.step(7);
      expect(s?.step.do).toBe(key === 'report:Order of Merit' ? 'end' : 'pick');
    }
    expect(await k.view()).toEqual({ running: null, ended: { family: 'alps', how: 'done' } });
    expect(runNote(await k.view(), 'alps', t)).toBeNull();
  });

  it('three runs a day per tour; another tab is told one is going on', async () => {
    const c = clock();
    const k = new RunKeeper(new MemoryStorage(), c.now);
    for (let i = 0; i < 3; i += 1) {
      expect((await k.start(ALPS, 7, TODAY)).outcome).toBe('started');
      expect((await k.start(ET, 8, TODAY)).outcome).toBe('busy');
      await k.stop();
    }
    expect(await k.start(ALPS, 7, TODAY)).toEqual({ outcome: 'limit', family: 'alps' });
    // Another tour has its own three.
    expect((await k.start(ET, 8, TODAY)).outcome).toBe('started');
    c.go(pick.DAY_MS);
    await k.stop();
    expect((await k.start(ALPS, 7, TODAY)).outcome).toBe('started');
  });

  it('a run whose tab went quiet long ago doesn\'t block a new one', async () => {
    const c = clock();
    const k = new RunKeeper(new MemoryStorage(), c.now);
    await k.start(ALPS, 7, TODAY);
    c.go(10 * 60 * 1000);
    expect((await k.start(ET, 8, TODAY)).outcome).toBe('started');
    expect((await k.view()).running?.family).toBe('europeantour');
  });

  it('opens only the addresses its tour may open, ends on another player\'s page, and says why', async () => {
    const c = clock();
    const s = new MemoryStorage();
    const k = new RunKeeper(s, c.now);
    await k.start(ET, 7, TODAY);
    const first = await k.step(7);
    expect(first?.step).toEqual({ key: 'overview:dpworld-tour', do: 'open', url: 'https://www.europeantour.com/players/lena-beispiel-99001/?tour=dpworld-tour' });
    await k.seen(7, { url: 'https://www.europeantour.com/players/otto-erfunden-12/', player: '12', outcome: 'read' });
    expect(await k.view()).toEqual({ running: null, ended: { family: 'europeantour', how: 'other_player' } });
    expect(runNote(await k.view(), 'europeantour', t)).toBe('Fetch all stopped: another player’s page opened. Nothing was sent.');
    // A run as kept whose next address isn't its tour's (another version wrote it): ended, nothing opened.
    await k.start(ET, 7, TODAY);
    const kept = JSON.parse((await s.get('tours:pick-run')) ?? '{}');
    kept.run.queue[0].url = 'https://www.europeantour.com/api/players/99001';
    await s.set('tours:pick-run', JSON.stringify(kept));
    expect(await k.step(7)).toEqual({ family: 'europeantour', step: { do: 'end' } });
    expect((await k.view()).ended).toEqual({ family: 'europeantour', how: 'changed_page' });
  });

  it('Stop, or its tab closing, ends it and names its tour; unreadable storage starts afresh', async () => {
    const s = new MemoryStorage();
    const k = new RunKeeper(s);
    await k.start(ALPS, 7, TODAY);
    expect(await k.stop('cancelled', 8)).toBeNull();
    expect(await k.stop('cancelled', 7)).toBe('alps');
    expect(await k.stop()).toBeNull();
    await s.set('tours:pick-run', '{not json');
    expect(await k.view()).toMatchObject({ running: null });
  });
});
