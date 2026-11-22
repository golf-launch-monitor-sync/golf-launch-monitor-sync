// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { connectionsOfApp, type AppFacts } from './connections.ts';
import type { LastRun } from './runner.ts';

const run = (over: Partial<LastRun> = {}): LastRun => ({ at: 0, reason: 'timer', status: 'synced', ...over });
const PROVIDERS = [
  { id: 'trackman', name: 'Trackman' },
  { id: 'demo', name: 'Demo' },
];
const pairing = (key: string, name = 'Example App', provider = 'trackman') => ({ key, provider, target: { name } });

function facts(over: Partial<AppFacts> & { signedIn?: Record<string, { valid: boolean; had: boolean; player: string | null }>; runs?: Record<string, LastRun | null> } = {}): AppFacts {
  const { signedIn = {}, runs = {}, ...rest } = over;
  return {
    providers: PROVIDERS,
    pairings: [],
    tests: [],
    signIn: (p) => signedIn[p] ?? { valid: false, had: false, player: null },
    lastRun: (k) => runs[k] ?? null,
    hcp: null,
    ...rest,
  };
}
const SIGNED = { valid: true, had: true, player: 'Alex Example' };

describe('the phone’s connections', () => {
  it('none before anything is connected or signed in', () => {
    expect(connectionsOfApp(facts())).toEqual([]);
  });

  it('paired, never signed in here: set up halfway - never "running"', () => {
    const list = connectionsOfApp(facts({ pairings: [pairing('k1')] }));
    expect(list).toEqual([{ id: 'lm:trackman', kind: 'lm', service: 'Trackman', account: null, targets: ['Example App'], state: 'setup' }]);
  });

  it('signed in: running, loading the history, a failed run, another account; run out after a sign-in had been', () => {
    const one = (r: LastRun | null, signIn = SIGNED) => connectionsOfApp(facts({ pairings: [pairing('k1')], signedIn: { trackman: signIn }, runs: { k1: r } }))[0];
    expect(one(run())).toMatchObject({ account: 'Alex Example', state: 'running' });
    expect(one(run({ more: true }))?.state).toBe('history');
    expect(one(run({ left: 40 }))?.state).toBe('history');
    expect(one(run({ status: 'failed', error: 'unreachable' }))?.state).toBe('failed');
    expect(one(run({ status: 'other_account' }))?.state).toBe('other');
    expect(one(run(), { valid: false, had: true, player: 'Alex Example' })).toMatchObject({ account: null, state: 'expired' });
  });

  it('the demo signed in without an app is a connection too; every app once', () => {
    const list = connectionsOfApp(facts({ pairings: [pairing('k1'), pairing('k2', 'Other App'), pairing('k3')], signedIn: { trackman: SIGNED, demo: { valid: true, had: true, player: 'Demo Player' } } }));
    expect(list.map((c) => [c.id, c.targets])).toEqual([
      ['lm:trackman', ['Example App', 'Other App']],
      ['lm:demo', []],
    ]);
  });

  it('a pairing in test mode is its own connection (and not the account’s), last in the list', () => {
    const list = connectionsOfApp(facts({ pairings: [pairing('k1'), pairing('t1', 'Test App')], tests: [{ key: 't1', player: 'Leon (Test T17)' }], signedIn: { trackman: SIGNED }, runs: { k1: run() } }));
    expect(list.map((c) => [c.id, c.state, c.account, c.targets])).toEqual([
      ['lm:trackman', 'running', 'Alex Example', ['Example App']],
      ['test:t1', 'test', 'Leon (Test T17)', ['Test App']],
    ]);
  });

  it('golf.de’s record beside it, what needs the player first', () => {
    const hcp = { pairings: [{ id: 'h1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '', host: 'app.example.org' }], account: 'none' as const, sending: false, signed_out: false };
    const list = connectionsOfApp(facts({ pairings: [pairing('k1')], signedIn: { trackman: SIGNED }, runs: { k1: run() }, hcp }));
    expect(list.map((c) => [c.id, c.state])).toEqual([
      ['hcp', 'setup'],
      ['lm:trackman', 'running'],
    ]);
  });
});
