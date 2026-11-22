// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { LastRun } from './runner.ts';
import { beforeYes, firstLoad, wizardText } from './wizard.ts';

const run = (over: Partial<LastRun> = {}): LastRun => ({ at: 0, reason: 'connect', status: 'synced', ...over });
const words = { service: 'Trackman', target: 'Example App' };

describe('connecting as steps on the phone', () => {
  it('before the yes: the big line, and nothing counted', () => {
    expect(wizardText(beforeYes(false), 'de', words).lines).toMatchObject({ progress: 'Schritt 1 von 4', unconfirmed: 'Noch nicht mit Example App verbunden – bei Trackman anmelden', brought: null });
    expect(wizardText(beforeYes(true), 'de', words).lines).toMatchObject({ progress: 'Schritt 2 von 4', title: 'Ist das dein Trackman-Konto?', unconfirmed: 'Noch nicht mit Example App verbunden – Konto bestätigen' });
  });

  it('the first sync, then done, with what came and what is still to come', () => {
    const running = wizardText(firstLoad([null], 'running'), 'de', words);
    expect(running.view.step).toBe('load');
    expect(running.lines).toMatchObject({ title: 'Deine Daten werden geholt …', unconfirmed: null, brought: null });
    const done = wizardText(firstLoad([run({ total: { sessions: 10, rounds: 6 }, more: true })], 'through'), 'de', words);
    expect(done.view.step).toBe('done');
    expect(done.lines).toMatchObject({ brought: '10 Sessions, 6 Runden geholt', more: 'Ältere Daten kommen nach und nach.' });
    const chunk = firstLoad([run({ total: { sessions: 2, rounds: 0 } }), run({ reason: 'backfill', total: { sessions: 40, rounds: 3 }, left: 140 })], 'through');
    expect(wizardText(chunk, 'en', words).lines).toMatchObject({ brought: '40 sessions, 3 rounds fetched', more: 'Older data follows bit by bit – about 140 sessions still to come.' });
  });

  it('a first sync that failed stays on step 3 and says so', () => {
    const f = firstLoad([run({ status: 'failed', error: 'unreachable' })], 'through');
    expect(f.first).toBe('failed');
    expect(wizardText(f, 'en', words).view.step).toBe('load');
  });
});
