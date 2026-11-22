// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { ClientStatus } from './client.ts';
import type { HcpView } from './hcp.ts';
import { translator } from './i18n.ts';
import { factsOfHcp, factsOfStatus, hcpWhoLine, targetOf, whoLine, wizardLines, wizardOf, type WizardFacts } from './wizard.ts';

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
  it('goes sign in, account, first data, done – and says where it stands', () => {
    const steps = [
      wizardOf(facts()),
      wizardOf(facts({ signedIn: true, asking: true })),
      wizardOf(facts({ signedIn: true, confirmed: true, first: 'running' })),
      wizardOf(facts({ signedIn: true, confirmed: true, first: 'through' })),
    ];
    expect(steps.map((v) => [v.step, v.index, v.total])).toEqual([
      ['signin', 1, 4],
      ['account', 2, 4],
      ['load', 3, 4],
      ['done', 4, 4],
    ]);
    expect(steps[1]?.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo', 'todo']);
    expect(steps[3]?.steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('before the yes: the big line says what is missing, and nothing counts as on its way', () => {
    const t = (f: WizardFacts) => wizardLines(wizardOf(f), f, de, words);
    // A count was there already (from an earlier connection): still not shown before the yes.
    const asking = facts({ signedIn: true, asking: true, brought: { sessions: 150, rounds: 3 }, more: 140 });
    expect(t(asking)).toMatchObject({ title: 'Ist das dein Trackman-Konto?', unconfirmed: 'Noch nicht mit Example App verbunden – Konto bestätigen', brought: null, more: null, progress: 'Schritt 2 von 4' });
    expect(t(facts())).toMatchObject({ title: 'Bei Trackman anmelden', unconfirmed: 'Noch nicht mit Example App verbunden – bei Trackman anmelden', brought: null });
    expect(wizardLines(wizardOf(facts()), facts(), en, { service: 'Trackman', target: null }).unconfirmed).toBe('Not yet connected with your app – sign in at Trackman');
  });

  it('the first data, shown plainly, then how much is still to come', () => {
    const t = (f: WizardFacts) => wizardLines(wizardOf(f), f, de, words);
    const yes = { signedIn: true, confirmed: true } as const;
    expect(t(facts({ ...yes, first: 'running' }))).toMatchObject({ title: 'Deine Daten werden geholt …', unconfirmed: null, brought: null, more: null });
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
  it('nothing to set up without a real app connected', () => {
    expect(factsOfStatus(status({ state: 'none' }, []))).toBeNull();
    const test = { name: 'S', player: null, valid_until: '2026-12-01T00:00:00Z', at: 0, counts: null };
    expect(factsOfStatus(status({ state: 'none' }, [pairing({ test })]))).toBeNull();
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
