// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { LastRun } from '@glmsync/engine';
import { translator } from '@glmsync/browser/i18n';
import { factsOfOffer, serviceChoices, stepParts } from '@glmsync/browser/wizard';
import { beforeYes, firstLoad, testAccount, testKeys, wizardText } from './wizard.ts';

const run = (over: Partial<LastRun> = {}): LastRun => ({ at: 0, reason: 'connect', status: 'synced', ...over });
const words = { service: 'Trackman', target: 'Example App' };

describe('connecting as steps on the phone', () => {
  it('a pair link is the first step: the app by its address, one button by the kind - its tap is the yes', () => {
    const lm = wizardText(factsOfOffer('asking', 'lm'), 'de', { service: 'Trackman', target: 'app.example.org' });
    expect(lm.view.step).toBe('service');
    expect(lm.lines).toMatchObject({ progress: 'Schritt 1 von 5', title: 'Mit app.example.org verbinden', unconfirmed: null });
    expect(lm.lines.labels).toEqual(['Dienst', 'Anmelden', 'Konto', 'Erste Daten', 'Fertig']);
    expect(serviceChoices('lm', [{ id: 'trackman', name: 'Trackman' }], translator('de'))).toEqual([{ id: 'trackman', label: 'Launch Monitor verbinden' }]);
    // While pairing, still the first step (no step of its own to allow before it).
    expect(wizardText(factsOfOffer('working', 'hcp'), 'en', { service: 'golf.de', target: 'app.example.org' }).lines.title).toBe('Connect with app.example.org');
    expect(serviceChoices('hcp', [{ id: 'golfde', name: 'golf.de' }], translator('en'))).toEqual([{ id: 'golfde', label: 'Connect handicap record' }]);
  });

  it('before the yes: the big line, and nothing counted', () => {
    expect(wizardText(beforeYes(false), 'de', words).lines).toMatchObject({ progress: 'Schritt 2 von 5', unconfirmed: 'Noch nicht mit Example App verbunden – bei Trackman anmelden', brought: null });
    expect(wizardText(beforeYes(true), 'de', words).lines).toMatchObject({ progress: 'Schritt 3 von 5', title: 'Ist das dein Trackman-Konto?', unconfirmed: 'Noch nicht mit Example App verbunden – Konto bestätigen' });
  });

  it('the first sync, then done, with what came and what is still to come', () => {
    const running = wizardText(firstLoad([null], 'running'), 'de', words);
    expect(running.view.step).toBe('load');
    // Done here at once, *Back to …* right there (LMS-AS-4): the rest comes by itself.
    expect(running.lines).toMatchObject({ title: 'Fertig – deine Daten werden geholt …', unconfirmed: null, brought: null });
    expect(stepParts('load', firstLoad([null], 'running'))).toEqual(['progress', 'back']);
    const done = wizardText(firstLoad([run({ total: { sessions: 10, rounds: 6 }, more: true })], 'through'), 'de', words);
    expect(done.view.step).toBe('done');
    expect(done.lines).toMatchObject({ brought: '10 Sessions, 6 Runden geholt', more: 'Ältere Daten kommen nach und nach.' });
    const chunk = firstLoad([run({ total: { sessions: 2, rounds: 0 } }), run({ reason: 'backfill', total: { sessions: 40, rounds: 3 }, left: 140 })], 'through');
    expect(wizardText(chunk, 'en', words).lines).toMatchObject({ brought: '40 sessions, 3 rounds fetched', more: 'Older data follows bit by bit – about 140 sessions still to come.' });
  });

  it('a first sync that failed stays on its step (4 of 5) and says so', () => {
    const f = firstLoad([run({ status: 'failed', error: 'unreachable' })], 'through');
    expect(f.first).toBe('failed');
    expect(wizardText(f, 'en', words).view.step).toBe('load');
    expect(stepParts('load', f)).not.toContain('back');
  });

  it('a test code: offered where Trackman’s sign-in is, for its pairings not in test mode; its account is step 3', () => {
    const pairings = [
      { key: 'a', provider: 'trackman' },
      { key: 'b', provider: 'trackman' },
      { key: 'c', provider: 'demo' },
    ];
    expect(testKeys(pairings, 'trackman', (k) => k === 'b')).toEqual(['a']);
    expect(testKeys(pairings, 'trackman', () => true)).toEqual([]);
    // Spec 1.28.0: a connection that only signs in takes its test code in the sign-in question instead.
    expect(testKeys([...pairings.map((p) => ({ ...p, mode: 'signin_only' as const }))], 'trackman', () => false)).toEqual([]);
    const f = testAccount();
    expect(f.test).toBe(true);
    expect(wizardText(f, 'de', words).view.step).toBe('account');
    // Only the account and yes or no.
    expect(stepParts('account', f, { signin: 'button', testCode: true, cancel: true })).toEqual(['who', 'answer']);
  });
});
