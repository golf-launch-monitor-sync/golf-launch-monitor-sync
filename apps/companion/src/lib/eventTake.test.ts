// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { TakeOutcome } from '@glmsync/browser/hcp';
import { describe, expect, it } from 'vitest';
import { EventTake, TAKE_WAIT_MS, type EventState } from './eventTake.ts';
import { takeScript } from './golfdePage.ts';

const PAGE = 'a1b2c3d4e5f6a7b8c9';
const event = { id: '42', url: 'https://www.golf.de/sport/turnierkalender/lgv-turniere.html#/42', name: 'Kreismeisterschaft', date: '2027-05-01' };

function world(answer: TakeOutcome | Error = { ok: true, name: 'Example App', result: 'new', kept: [] }) {
  const shown: EventState[] = [];
  const injected: string[] = [];
  const taken: [string, unknown][] = [];
  const timers: (() => void)[] = [];
  const take = new EventTake({
    hcp: {
      takeEvent: async (id, ev) => {
        taken.push([id, ev]);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
    inject: (s) => injected.push(s),
    show: (s) => shown.push(s),
    nameOf: (id) => (id === 'app' ? 'Example App' : undefined),
    setTimer: (fn, ms) => {
      expect(ms).toBe(TAKE_WAIT_MS);
      timers.push(fn);
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { take, shown, injected, taken, timers, last: () => shown[shown.length - 1] };
}

describe('taking one tournament in the golf.de window (spec 1.19.0)', () => {
  it('offers it while the page says so, asks the page on the tap, and sends what it read to the app tapped', async () => {
    const w = world();
    await w.take.message({ page: PAGE, offer: true });
    expect(w.last()).toEqual({ offer: true, busy: null, said: null });
    w.take.tap('app');
    expect(w.injected).toEqual([takeScript()]);
    expect(w.last()?.busy).toBe('app');
    // A second tap while one is under way asks nothing more.
    w.take.tap('app');
    expect(w.injected).toHaveLength(1);
    await w.take.message({ page: PAGE, event });
    expect(w.taken).toEqual([['app', event]]);
    expect(w.last()).toEqual({ offer: true, busy: null, said: { ok: true, name: 'Example App', result: 'new', kept: [] } });
  });

  it('sends nothing the player didn’t tap for', async () => {
    const w = world();
    await w.take.message({ page: PAGE, event });
    expect(w.taken).toEqual([]);
  });

  it('says the page can’t be read when it says so, or doesn’t answer', async () => {
    const w = world();
    w.take.tap('app');
    await w.take.message({ page: PAGE, refused: 'changed_page' });
    expect(w.last()?.said).toEqual({ ok: false, name: 'Example App', error: 'changed_page' });
    w.take.tap('app');
    w.timers[1]?.();
    expect(w.last()).toMatchObject({ busy: null, said: { ok: false, error: 'changed_page' } });
    expect(w.taken).toEqual([]);
  });

  it('says it didn’t work when the app’s side throws, and forgets what it said once the page goes', async () => {
    const w = world(new Error('storage'));
    w.take.tap('app');
    await w.take.message({ page: PAGE, event });
    expect(w.last()?.said).toEqual({ ok: false, name: 'Example App', error: 'failed' });
    await w.take.message({ page: PAGE, offer: false });
    expect(w.last()).toEqual({ offer: false, busy: null, said: null });
  });
});
