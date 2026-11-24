// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { ClientStatus } from './client.ts';
import type { HcpView } from './hcp.ts';
import { translator } from './i18n.ts';
import { factsOfAccount, factsOfHcp, factsOfOffer, factsOfStatus, hcpWhoLine, statusSituation, stepParts, targetOf, whoLine, wizardLines, wizardOf, type StepPart, type WizardFacts } from './wizard.ts';

const en = translator('en');
const de = translator('de');
const facts = (over: Partial<WizardFacts> = {}): WizardFacts => ({ kind: 'lm', signedIn: false, asking: false, confirmed: false, first: 'waiting', brought: null, more: null, ...over });
const words = { service: 'Trackman', target: 'Example App' };

type P = ClientStatus['pairings'][number];
const pairing = (over: Partial<P> = {}): P => ({
  id: 'p1',
  base: 'https://app.example.org/lm/v1',
  name: 'Example App',
  provider: 'trackman',
  paired_at: '2026-11-22T10:00:00Z',
  host: 'app.example.org',
  signin: 'none',
  ...over,
});
const status = (key: ClientStatus['key'], pairings: P[] = [pairing()], running: string[] = []) => ({ key, pairings, running });
const READY = { state: 'ready', until: 0 } as const;

describe('the steps', () => {
  it('goes allow, service, sign in, account, first data, done – and says where it stands', () => {
    const steps = [
      wizardOf(factsOfOffer('none', 'lm')),
      wizardOf(factsOfOffer('allowed', 'lm')),
      wizardOf(facts()),
      wizardOf(facts({ signedIn: true, asking: true })),
      wizardOf(facts({ signedIn: true, confirmed: true, first: 'running' })),
      wizardOf(facts({ signedIn: true, confirmed: true, first: 'through' })),
    ];
    expect(steps.map((v) => [v.step, v.index, v.total])).toEqual([
      ['pair', 1, 6],
      ['service', 2, 6],
      ['signin', 3, 6],
      ['account', 4, 6],
      ['load', 5, 6],
      ['done', 6, 6],
    ]);
    // A connection with a client state behind it is paired and its service chosen.
    expect(steps[3]?.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'current', 'todo', 'todo']);
    expect(steps[5]?.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(wizardOf(factsOfOffer('asking', 'hcp')).step).toBe('pair');
    expect(wizardOf(factsOfOffer('working', 'hcp')).step).toBe('service');
  });

  it('the first two steps: the app asks by its address, no "not yet connected" before there is an app', () => {
    const t = (f: WizardFacts, target: string | null) => wizardLines(wizardOf(f), f, de, { service: 'Trackman', target });
    expect(t(factsOfOffer('none', 'lm'), null)).toMatchObject({ title: 'In deiner App starten', unconfirmed: null, progress: 'Schritt 1 von 6' });
    expect(t(factsOfOffer('asking', 'lm'), 'app.example.org')).toMatchObject({ title: 'Mit app.example.org verbinden?', unconfirmed: null });
    expect(t(factsOfOffer('allowed', 'lm'), 'app.example.org')).toMatchObject({ title: 'Was möchtest du verbinden?', unconfirmed: null, progress: 'Schritt 2 von 6' });
    expect(t(factsOfOffer('allowed', 'lm'), 'app.example.org').labels).toEqual(['Erlauben', 'Dienst', 'Anmelden', 'Konto', 'Erste Daten', 'Fertig']);
  });

  it('before the yes: the big line says what is missing, and nothing counts as on its way', () => {
    const t = (f: WizardFacts) => wizardLines(wizardOf(f), f, de, words);
    // A count was there already (from an earlier connection): still not shown before the yes.
    const asking = facts({ signedIn: true, asking: true, brought: { sessions: 150, rounds: 3 }, more: 140 });
    expect(t(asking)).toMatchObject({ title: 'Ist das dein Trackman-Konto?', unconfirmed: 'Noch nicht mit Example App verbunden – Konto bestätigen', brought: null, more: null, progress: 'Schritt 4 von 6' });
    expect(t(facts())).toMatchObject({ title: 'Bei Trackman anmelden', unconfirmed: 'Noch nicht mit Example App verbunden – bei Trackman anmelden', brought: null });
    expect(wizardLines(wizardOf(facts()), facts(), en, { service: 'Trackman', target: null }).unconfirmed).toBe('Not yet connected with your app – sign in at Trackman');
  });

  it('the first data, shown plainly, then how much is still to come', () => {
    const t = (f: WizardFacts) => wizardLines(wizardOf(f), f, de, words);
    const yes = { signedIn: true, confirmed: true } as const;
    // With the yes the player is done here: the step says so at once, not only once the data is in (LMS-AS-4).
    expect(t(facts({ ...yes, first: 'running' }))).toMatchObject({ title: 'Fertig – deine Daten werden geholt …', unconfirmed: null, brought: null, more: null });
    expect(t(facts({ ...yes, first: 'waiting' })).title).toBe('Fertig – deine Daten werden geholt …');
    expect(wizardLines(wizardOf(facts({ ...yes, first: 'running' })), facts({ ...yes, first: 'running' }), en, words).title).toBe('Done – fetching your data …');
    // A first fetch that failed isn't done: the step stays on the data.
    expect(t(facts({ ...yes, first: 'failed' })).title).toBe('Deine Daten werden geholt …');
    // golf.de's results come only once its pages are opened: not done before that.
    expect(t(facts({ ...yes, kind: 'hcp', first: 'waiting' })).title).toBe('Deine Ergebnisse …');
    expect(t(facts({ ...yes, first: 'running', brought: { sessions: 10, rounds: 6 } })).brought).toBe('10 Sessions, 6 Runden geholt');
    const done = t(facts({ ...yes, first: 'through', brought: { sessions: 10, rounds: 6 }, more: 140 }));
    expect(done).toMatchObject({ title: 'Fertig', brought: '10 Sessions, 6 Runden geholt', more: 'Ältere Daten kommen nach und nach – noch etwa 140 Sessions.' });
    expect(t(facts({ ...yes, first: 'through', brought: { sessions: 2, rounds: 0 }, more: true })).more).toBe('Ältere Daten kommen nach und nach.');
    expect(t(facts({ ...yes, first: 'through', brought: { sessions: 2, rounds: 0 }, more: false })).more).toBe('Deine Historie ist vollständig.');
    expect(t(facts({ ...yes, first: 'through', brought: { sessions: 0, rounds: 0 } })).brought).toBe('In deinem Konto ist noch nichts zu holen.');
  });

  it('the handicap record speaks of results', () => {
    const f = facts({ kind: 'hcp', signedIn: true, confirmed: true, first: 'through', brought: { results: 12 } });
    expect(wizardLines(wizardOf(f), f, de, { service: 'golf.de', target: 'Example App' })).toMatchObject({
      brought: '12 Ergebnisse an Example App geschickt',
      more: 'Weitere Ergebnisse kommen, wann immer du weitere Seiten deines Stammblatts öffnest.',
    });
    const asking = facts({ kind: 'hcp', signedIn: true, asking: true });
    expect(wizardLines(wizardOf(asking), asking, de, { service: 'golf.de', target: null }).title).toBe('Ist das dein golf.de-Konto?');
  });

  it('the app’s name only when there is one', () => {
    expect(targetOf(['A'])).toBe('A');
    expect(targetOf(['A', 'A'])).toBe('A');
    expect(targetOf(['A', 'B'])).toBeNull();
    expect(targetOf([])).toBeNull();
  });
});

describe('the question’s facts', () => {
  it('no count of activities: a number there read as data already fetched', () => {
    const line = whoLine({ count: 150, last: '2026-11-15T10:00:00Z', place: 'Example Range' }, en, 'en');
    expect(line).toBe('Newest activity on 15 Nov 2026 at Example Range');
    expect(line).not.toContain('150');
    expect(whoLine({ count: 3, last: '2026-11-15T10:00:00Z', place: null }, de, 'de')).toBe('Neueste Aktivität am 15. Nov. 2026');
    expect(whoLine({ count: 0, last: null }, en, 'en')).toBe('No activities yet.');
    expect(whoLine(null, en, 'en')).toBeNull();
    expect(whoLine({ count: 2, last: 'not a date' }, en, 'en')).toBeNull();
  });

  it('golf.de’s account by its handicap index', () => {
    expect(hcpWhoLine({ value: 8.1, as_of: '2026-11-21' }, de, 'de')).toBe('Handicap-Index 8,1, Stand 21. Nov. 2026');
    expect(hcpWhoLine({ value: -1.2, as_of: '2026-11-21' }, en, 'en')).toBe('Handicap index -1.2, as of 21 Nov 2026');
    expect(hcpWhoLine(null, en, 'en')).toBe('golf.de named an account, without its handicap index.');
  });
});

describe('a launch monitor client’s state as steps', () => {
  it('nothing to set up without an app connected', () => {
    expect(factsOfStatus(status({ state: 'none' }, []))).toBeNull();
  });

  it('a test code stands in for the sign-in: its account is step 4, its first data step 5 - never the sign-in', () => {
    const test = { name: 'S', player: 'Leon', valid_until: '2026-12-01T00:00:00Z', at: 0, counts: null };
    const who = { player: 'Leon', activities: null };
    const asking = { id: 'p1', target: 'Example App', name: 'S', who, valid_until: '2026-12-01T00:00:00Z', at: 0 };
    const step = (s: Parameters<typeof factsOfStatus>[0]) => {
      const f = factsOfStatus(s);
      return f ? [wizardOf(f).step, !!f.test] : null;
    };
    // Fetched: "Is this your account?" about the made-up one, also while the provider's sign-in is missing or run out.
    expect(step({ ...status({ state: 'none' }), testAsking: asking })).toEqual(['account', true]);
    expect(step({ ...status({ state: 'expired', until: 0 }), testAsking: asking })).toEqual(['account', true]);
    // Said yes: the first data from the scenario, then done - whatever the provider's sign-in is.
    expect(step(status({ state: 'none' }, [pairing({ test })]))).toEqual(['load', true]);
    expect(step(status({ state: 'expired', until: 0 }, [pairing({ test })], ['p1']))).toEqual(['load', true]);
    const through = pairing({ test, last_synced_at: '2026-11-23T10:00:00Z', brought: { sessions: 1, rounds: 1, shots: 9 }, history: { done: false }, left: 4 });
    expect(factsOfStatus(status({ state: 'none' }, [through]))).toMatchObject({ test: true, first: 'through', brought: { sessions: 1, rounds: 1 }, more: 4 });
    // The account's own connection being set up comes first; the account's facts never count a test's pairing.
    expect(step(status({ state: 'none' }, [pairing({ id: 'a' }), pairing({ id: 'b', test })]))).toEqual(['signin', false]);
    expect(factsOfAccount(status({ state: 'none' }, [pairing({ test })]))).toBeNull();
  });

  it('follows the sign-in, the question and the first sync', () => {
    const step = (s: Parameters<typeof factsOfStatus>[0], busy?: Set<string>) => {
      const f = factsOfStatus(s, busy);
      return f ? wizardOf(f).step : null;
    };
    expect(step(status({ state: 'none' }))).toBe('signin');
    expect(step(status({ state: 'other', until: 0 }))).toBe('signin');
    expect(step(status({ state: 'confirm', until: 0, who: null }))).toBe('account');
    expect(step(status(READY))).toBe('load');
    expect(step(status(READY, [pairing()], ['p1']))).toBe('load');
    expect(factsOfStatus(status(READY), new Set(['p1']))?.first).toBe('running');
    expect(factsOfStatus(status(READY, [pairing({ last: { at: '', reason: 'connect', status: 'failed', error: 'unreachable' } })]))?.first).toBe('failed');
    const synced = pairing({ last_synced_at: '2026-11-22T10:01:00Z', brought: { sessions: 10, rounds: 6, shots: 300 }, history: { done: false }, left: 140 });
    expect(factsOfStatus(status(READY, [synced]))).toMatchObject({ first: 'through', brought: { sessions: 10, rounds: 6 }, more: 140 });
    // Nothing was due (another device synced a moment ago): through all the same.
    expect(step(status(READY, [pairing({ last: { at: '', reason: 'connect', status: 'not_due' } })]))).toBe('done');
  });

  it('a connection that brought data before and only needs a new sign-in is no setup', () => {
    const before = pairing({ last_synced_at: '2026-11-01T10:00:00Z' });
    expect(factsOfStatus(status({ state: 'expired', until: 0 }, [before]))).toBeNull();
    expect(factsOfStatus(status({ state: 'other', until: 0 }, [before]))).toBeNull();
    // A new account to answer about is asked about in the steps all the same.
    expect(factsOfStatus(status({ state: 'confirm', until: 0, who: null }, [before]))?.asking).toBe(true);
  });

  it('the pairing that brought most speaks for all', () => {
    const a = pairing({ id: 'a', brought: { sessions: 2, rounds: 0, shots: 4 }, history: { done: true } });
    const b = pairing({ id: 'b', brought: { sessions: 10, rounds: 6, shots: 300 }, history: { done: false } });
    expect(factsOfStatus(status(READY, [a, b]))).toMatchObject({ brought: { sessions: 10, rounds: 6 }, more: true });
  });
});

describe('the handicap record’s state as steps', () => {
  const hp = (over: Partial<HcpView['pairings'][number]> = {}): HcpView['pairings'][number] => ({ id: 'h1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '', host: 'app.example.org', ...over });
  const view = (over: Partial<Pick<HcpView, 'pairings' | 'account' | 'sending'>> = {}) => ({ pairings: [hp()], account: 'none' as const, sending: false, ...over });

  it('none named, asking, confirmed, sent', () => {
    const step = (v: Parameters<typeof factsOfHcp>[0]) => {
      const f = factsOfHcp(v);
      return f ? wizardOf(f).step : null;
    };
    expect(factsOfHcp(view({ pairings: [] }))).toBeNull();
    expect(step(view())).toBe('signin');
    expect(step(view({ account: 'rejected' }))).toBe('signin');
    expect(step(view({ account: 'asking' }))).toBe('account');
    expect(step(view({ account: 'confirmed' }))).toBe('load');
    expect(factsOfHcp(view({ account: 'confirmed', sending: true }))?.first).toBe('running');
    const sent = hp({ total: 12, last: { at: '', status: 'sent', brought: 12 } });
    expect(factsOfHcp(view({ account: 'confirmed', pairings: [sent] }))).toMatchObject({ first: 'through', brought: { results: 12 } });
    // Established, and golf.de signed out since: no setup, the overview says it.
    expect(factsOfHcp(view({ account: 'none', pairings: [sent] }))).toBeNull();
  });
});

describe('what a step shows: its own content, nothing else', () => {
  const lm = facts();
  const hcp = facts({ kind: 'hcp' });
  const OTHER_STEPS: StepPart[] = ['banner', 'trouble', 'signinHow', 'switch', 'signin', 'forget', 'testCode', 'unofficial', 'failed', 'fetch', 'progress', 'back', 'cancel'];

  it('sign in: the sign-in, small the test code instead, the way out', () => {
    expect(stepParts('signin', lm, { signin: 'button', testCode: true, cancel: true })).toEqual(['banner', 'signinHow', 'signin', 'testCode', 'unofficial', 'cancel']);
    // The web app's key box brings its own words.
    expect(stepParts('signin', lm, { signin: 'box', testCode: true })).toEqual(['banner', 'signin', 'testCode', 'unofficial']);
    // What went wrong is said instead of how; the way to another account before the portal.
    expect(stepParts('signin', lm, { signin: 'button', trouble: true, switchAccount: true, testCode: true })).toEqual(['banner', 'trouble', 'switch', 'signin', 'testCode', 'unofficial']);
    expect(stepParts('signin', lm, { signin: 'button', trouble: true, forget: true })).toEqual(['banner', 'trouble', 'signin', 'forget', 'unofficial']);
    // golf.de: no test code, and nothing about launch monitors.
    expect(stepParts('signin', hcp, { signin: 'button', testCode: true })).toEqual(['banner', 'signinHow', 'signin']);
  });

  it('your account: only the account and yes or no - also for a test, also with everything else at hand', () => {
    const all = { signin: 'button', trouble: true, switchAccount: true, forget: true, testCode: true, cancel: true, fresh: true } as const;
    for (const f of [lm, facts({ test: true }), hcp]) {
      expect(stepParts('account', f, all)).toEqual(['who', 'answer']);
      for (const p of OTHER_STEPS) expect(stepParts('account', f, { ...all, confirming: true })).not.toContain(p);
    }
    expect(stepParts('account', lm, { confirming: true })).toEqual(['who', 'answer', 'checking']);
    // Couldn't be asked: try again (or no).
    expect(stepParts('account', lm, { named: false })).toEqual(['whoFailed', 'retry']);
  });

  it('the first data, and done', () => {
    // A launch monitor's first data: done here, *Back to …* at once - not only after the data (LMS-AS-4). Nothing to
    // cancel on a step that says it is done (the overview's own buttons end a connection).
    expect(stepParts('load', facts({ first: 'running' }), { cancel: true, testCode: true, signin: 'button' })).toEqual(['progress', 'back']);
    expect(stepParts('load', facts({ first: 'waiting' }), { cancel: true })).toEqual(['progress', 'back']);
    expect(stepParts('load', facts({ test: true, first: 'running' }))).toEqual(['progress', 'back']);
    // Failed: what went wrong and trying again - no *Back to …* while it isn't done.
    expect(stepParts('load', facts({ first: 'failed' }))).toEqual(['failed', 'fetch', 'progress']);
    expect(stepParts('load', facts({ first: 'failed' }), { cancel: true })).toEqual(['failed', 'fetch', 'progress', 'cancel']);
    expect(stepParts('load', facts({ kind: 'hcp', first: 'waiting' }), { fresh: true })).toEqual(['waitingHow', 'signin', 'send', 'progress']);
    expect(stepParts('load', facts({ kind: 'hcp', first: 'running' }), { fresh: true })).toEqual(['progress']);
    expect(stepParts('done', lm, { cancel: true, testCode: true })).toEqual(['progress', 'back']);
    expect(stepParts('pair', lm)).toEqual([]);
  });
});

describe('a launch monitor client’s situation', () => {
  const test = { name: 'S', player: 'Leon', valid_until: '2026-12-01T00:00:00Z', at: 0, counts: null };
  const o = { client: 'extension' as const, switchAccount: true, signinBox: false, testCode: true, confirming: false, target: 'Example App' };
  const of = (key: ClientStatus['key'], over: { rejected?: boolean; pairings?: P[] } = {}, f: Pick<WizardFacts, 'test'> = {}) =>
    statusSituation({ key, rejected: over.rejected ?? false, pairings: over.pairings ?? [pairing()], testAsking: null }, f, o);

  it('the sign-in’s trouble and the ways out of it', () => {
    expect(of({ state: 'none' })).toMatchObject({ trouble: false, switchAccount: false, forget: false, signin: 'button', testCode: true, cancel: true });
    expect(of({ state: 'expired', until: 0 })).toMatchObject({ trouble: true, switchAccount: false });
    expect(of({ state: 'other', until: 0 })).toMatchObject({ trouble: true, switchAccount: true, forget: true });
    expect(of({ state: 'none' }, { rejected: true })).toMatchObject({ trouble: true, switchAccount: true });
    expect(of({ state: 'confirm', until: 0, who: null })).toMatchObject({ named: false });
    expect(statusSituation({ key: { state: 'none' }, rejected: false, pairings: [pairing()], testAsking: null }, {}, { ...o, client: 'web', signinBox: true })).toMatchObject({ signin: 'box', switchAccount: false });
    // Several apps: their own buttons end them.
    expect(of({ state: 'none' }, { pairings: [pairing({ id: 'a' }), pairing({ id: 'b' })] }).cancel).toBe(false);
  });

  it('a test knows nothing of the provider’s sign-in', () => {
    for (const key of [{ state: 'none' }, { state: 'expired', until: 0 }, { state: 'other', until: 0 }] as ClientStatus['key'][]) {
      const s = of(key, { rejected: true, pairings: [pairing({ test })] }, { test: true });
      expect(s).toMatchObject({ trouble: false, switchAccount: false, forget: false, named: true, cancel: false });
      const shown = [...stepParts('account', facts({ test: true, signedIn: true, asking: true }), s), ...stepParts('load', facts({ test: true, signedIn: true, confirmed: true }), s), ...stepParts('done', facts({ test: true }), s)];
      expect(shown).not.toContain('signin');
      expect(shown).not.toContain('trouble');
      expect(shown).not.toContain('switch');
    }
  });
});
