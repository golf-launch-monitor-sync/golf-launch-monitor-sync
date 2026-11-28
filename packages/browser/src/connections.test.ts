// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import type { ClientStatus } from './client.ts';
import { connectionLine, connectionOfHcp, connectionsOfStatus, connectionState, sortConnections, type ConnectionFacts } from './connections.ts';
import type { HcpView } from './hcp.ts';
import { translator } from './i18n.ts';
import { historyText } from './view.ts';

const de = translator('de');
const en = translator('en');

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
const status = (key: ClientStatus['key'], pairings: P[] = [pairing()], player: string | null = null) => ({ key, pairings, running: [], provider: { id: 'trackman', name: 'Trackman' }, player });
const READY = { state: 'ready', until: 0 } as const;
const synced = (over: Partial<P> = {}) => pairing({ last_synced_at: '2026-11-22T10:01:00Z', last: { at: '2026-11-22T10:01:00Z', reason: 'connect', status: 'synced' }, ...over });

describe('where a connection stands', () => {
  const f = (over: Partial<ConnectionFacts> = {}): ConnectionFacts => ({ setup: false, test: false, signIn: 'ok', failed: false, history: false, ...over });

  it('what the player must do comes before what runs', () => {
    expect(connectionState(f())).toBe('running');
    expect(connectionState(f({ history: true }))).toBe('history');
    expect(connectionState(f({ failed: true, history: true }))).toBe('failed');
    expect(connectionState(f({ signIn: 'expired', failed: true }))).toBe('expired');
    expect(connectionState(f({ signIn: 'other' }))).toBe('other');
    expect(connectionState(f({ setup: true, signIn: 'expired' }))).toBe('setup');
    expect(connectionState(f({ test: true, setup: true }))).toBe('test');
  });

  // SR-8b: an update is all it takes, and nothing else helps before it (signing in, finishing the steps).
  it('a target that needs a newer version comes first, a test aside', () => {
    expect(connectionState(f({ outdated: true }))).toBe('outdated');
    expect(connectionState(f({ outdated: true, signIn: 'expired', failed: true }))).toBe('outdated');
    expect(connectionState(f({ outdated: true, setup: true }))).toBe('outdated');
    expect(connectionState(f({ outdated: true, test: true }))).toBe('test');
  });
});

describe('SR-8b: a target that needs a newer version', () => {
  const told = (version: string) => synced({ history: { done: true }, last: { at: '2026-11-28T10:00:00Z', reason: 'timer', status: 'outdated', version } });

  it('is the connection’s state while this version runs, and goes once another does', () => {
    expect(connectionsOfStatus({ ...status(READY, [told('0.28.0')]), version: '0.28.0' })[0]?.state).toBe('outdated');
    expect(connectionsOfStatus({ ...status(READY, [told('0.28.0')]), version: '0.29.0' })[0]?.state).toBe('running');
  });

  it('says so in a line that wants the player', () => {
    const c = connectionsOfStatus({ ...status(READY, [told('0.28.0')]), version: '0.28.0' })[0];
    if (!c) throw new Error('no connection');
    expect(connectionLine(c, en)).toMatchObject({ state: 'Update needed', tone: 'warn' });
    expect(connectionLine(c, de).state).toBe('Update nötig');
  });
});

describe('a launch monitor client’s connections', () => {
  it('none without an app connected', () => {
    expect(connectionsOfStatus(status({ state: 'none' }, []))).toEqual([]);
  });

  it('paired but not signed in, or the account not confirmed: set up halfway, never "running"', () => {
    expect(connectionsOfStatus(status({ state: 'none' }))[0]?.state).toBe('setup');
    expect(connectionsOfStatus(status({ state: 'confirm', until: 0, who: null }))[0]?.state).toBe('setup');
    // Confirmed, the first sync not through yet: still the steps.
    expect(connectionsOfStatus(status(READY))[0]?.state).toBe('setup');
  });

  it('running, loading the history, run out, another account, a failed fetch', () => {
    expect(connectionsOfStatus(status(READY, [synced({ history: { done: true } })]))[0]).toMatchObject({ id: 'lm', service: 'Trackman', targets: ['Example App'], state: 'running' });
    expect(connectionsOfStatus(status(READY, [synced({ history: { done: false } })]))[0]?.state).toBe('history');
    // The history only fills gaps (spec 1.21.0): nothing older comes, so it runs.
    expect(connectionsOfStatus(status(READY, [synced({ history: { done: false, older: false } })]))[0]?.state).toBe('running');
    expect(connectionsOfStatus(status({ state: 'expired', until: 0 }, [synced()]))[0]?.state).toBe('expired');
    expect(connectionsOfStatus(status({ state: 'none' }, [synced()]))[0]?.state).toBe('expired');
    expect(connectionsOfStatus(status({ state: 'other', until: 0 }, [synced()]))[0]?.state).toBe('other');
    expect(connectionsOfStatus(status(READY, [synced({ other_account: true })]))[0]?.state).toBe('other');
    const failed = synced({ last: { at: '', reason: 'timer', status: 'failed', error: 'unreachable' } });
    expect(connectionsOfStatus(status(READY, [failed]))[0]?.state).toBe('failed');
  });

  it('the account’s name only once confirmed; every app it goes to, once', () => {
    const two = [synced(), synced({ id: 'p2', name: 'Other App' }), synced({ id: 'p3' })];
    expect(connectionsOfStatus(status(READY, two, 'Alex Example'))[0]).toMatchObject({ account: 'Alex Example', targets: ['Example App', 'Other App'] });
    expect(connectionsOfStatus(status({ state: 'expired', until: 0 }, [synced()], 'Alex Example'))[0]?.account).toBeNull();
  });

  it('a pairing in test mode is a connection of its own, with its made-up account', () => {
    const test = { name: 'Leon', player: 'Leon Test', valid_until: '2026-12-01T00:00:00Z', at: 0, counts: null };
    const list = connectionsOfStatus(status({ state: 'none' }, [pairing({ id: 't1', test })]));
    expect(list).toEqual([{ id: 'test:t1', kind: 'lm', service: 'Trackman', account: 'Leon Test', targets: ['Example App'], state: 'test' }]);
  });
});

describe('the handicap record’s connection', () => {
  const hp = (over: Partial<HcpView['pairings'][number]> = {}): HcpView['pairings'][number] => ({ id: 'h1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '', host: 'app.example.org', ...over });
  const view = (over: Partial<Pick<HcpView, 'pairings' | 'account' | 'sending' | 'signed_out'>> = {}) => ({ pairings: [hp()], account: 'none' as const, sending: false, signed_out: false, ...over });
  const sent = hp({ total: 12, last: { at: '', status: 'sent', brought: 12 } });

  it('none without an app; set up halfway until the first results went out; signed out says sign in again', () => {
    expect(connectionOfHcp(view({ pairings: [] }))).toBeNull();
    expect(connectionOfHcp(view())?.state).toBe('setup');
    expect(connectionOfHcp(view({ account: 'confirmed', pairings: [sent] }))).toMatchObject({ id: 'hcp', service: 'golf.de', state: 'running' });
    expect(connectionOfHcp(view({ pairings: [sent], signed_out: true }))?.state).toBe('expired');
  });
});

describe('the row’s words', () => {
  it('service and account, where it goes, and its state – in both languages', () => {
    const c = { id: 'lm', kind: 'lm' as const, service: 'Trackman', account: 'Alex Example', targets: ['Example App'], state: 'history' as const };
    expect(connectionLine(c, de)).toEqual({ title: 'Trackman · Alex Example', targets: 'an Example App', state: 'lädt Historie', tone: 'busy' });
    expect(connectionLine({ ...c, account: null, state: 'expired' }, en)).toEqual({ title: 'Trackman', targets: 'to Example App', state: 'Run out – sign in again', tone: 'warn' });
    expect(connectionLine({ ...c, state: 'test' }, de).state).toBe('Test-Modus');
    expect(connectionLine({ ...c, state: 'running' }, de).state).toBe('läuft');
    expect(connectionLine({ ...c, state: 'setup' }, de).state).toBe('Noch nicht fertig – weiter');
  });

  it('a pairing the app ended: no longer connected with it, pair again there (Reginald’s test of 27 Nov)', () => {
    const c = { id: 'ended:k1', kind: 'lm' as const, service: 'Trackman', account: null, targets: ['Example App'], state: 'ended' as const };
    expect(connectionLine(c, de)).toEqual({ title: 'Trackman', targets: '', state: 'Nicht mehr mit Example App verbunden – dort neu koppeln', tone: 'warn' });
    expect(connectionLine(c, en).state).toBe('No longer connected with Example App – pair again there');
  });

  it('the main button reads as a new connection, not as “reconnect” (Reginald’s test of 27 Nov)', () => {
    expect(de('connections.new')).toBe('Neue Verbindung');
  });

  it('what needs the player first, tests last', () => {
    const c = (id: string, state: 'running' | 'test' | 'setup') => ({ id, kind: 'lm' as const, service: 'S', account: null, targets: [], state });
    expect(sortConnections([c('a', 'test'), c('b', 'running'), c('c', 'setup')]).map((x) => x.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('the history in a pairing’s details', () => {
  it('complete with gaps still being filled when the target says only gaps (spec 1.21.0), not "still coming"', () => {
    expect(historyText(synced({ history: { done: false, older: false } }), de)).toBe('Ältere Historie: vollständig, Lücken werden noch ergänzt.');
    expect(historyText(synced({ history: { done: false } }), de)).toBe('Ältere Historie: kommt noch, alle paar Minuten ein Stück.');
  });
});
