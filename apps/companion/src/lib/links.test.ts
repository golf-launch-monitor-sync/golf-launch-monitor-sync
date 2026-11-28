// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { Pairing } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import { backAfterPairing, backTo, hostOf, Once, readIncoming, routeTestLink } from './links.ts';
import type { KeyedPairing } from '@glmsync/engine';

const PROVIDERS = ['trackman', 'demo'];

function pairing(base: string, prefixes: string[], provider = 'trackman'): KeyedPairing {
  const p: Pairing = {
    base,
    token: 't'.repeat(40),
    provider,
    target: { name: 'Example App', return_prefixes: prefixes },
    account_salt: 'salt-salt-salt-salt',
    limits: { max_bytes: 1_000_000, max_sessions: 50, max_shots: 1000, max_rounds: 10, max_round_shots: 100 },
    paired_at: '2026-11-16T08:00:00.000Z',
  };
  return { ...p, key: `k-${base}-${provider}` };
}

describe('a pair link', () => {
  it('becomes a question naming the host, Trackman when the link names no provider', () => {
    const r = readIncoming('glmsync://pair?target=https%3A%2F%2FApp.Example.org%2Flm%2Fv1&code=K7M2PQ9X', PROVIDERS, []);
    expect(r).toEqual({ kind: 'pair', target: 'https://App.Example.org/lm/v1', code: 'K7M2PQ9X', provider: 'trackman', choices: ['trackman'], host: 'app.example.org', replaces: false });
  });

  it('says when it replaces a pairing of the same target', () => {
    const r = readIncoming('glmsync://pair?target=https://app.example.org/lm/v1/&code=K7M2PQ9X', PROVIDERS, [pairing('https://app.example.org/lm/v1', [])]);
    expect(r.kind === 'pair' && r.replaces).toBe(true);
  });

  it('refuses a provider the app does not have, and anything malformed', () => {
    expect(readIncoming('glmsync://pair?target=https://a.example&code=K7M2PQ9X&provider=other', PROVIDERS, []).kind).toBe('invalid');
    expect(readIncoming('glmsync://pair?target=http://evil.example&code=K7M2PQ9X', PROVIDERS, []).kind).toBe('invalid');
    expect(readIncoming('glmsync://pair?target=https://a.example&code=K7M2PQ9X#x', PROVIDERS, []).kind).toBe('invalid');
    expect(readIncoming('https://a.example/pair', PROVIDERS, []).kind).toBe('invalid');
    expect(readIncoming(undefined, PROVIDERS, []).kind).toBe('invalid');
  });

  // Spec 1.15.0: a pro's world ranking pages (TE-22b-2). Taken for a launch monitor pairing (no provider named) it would
  // have paired Trackman with a handicap target; it is a question of its own, for the provider `pro` alone.
  it('takes a pro’s pages as their own question, never for another kind', () => {
    const target = 'https://app.example.org/hcp/v1';
    const want = { kind: 'pair-pro', target, code: 'K7M2PQ9X', provider: 'pro', host: 'app.example.org' };
    expect(readIncoming('glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Fhcp%2Fv1&code=K7M2PQ9X&provider=pro&kind=pro', PROVIDERS, [])).toEqual(want);
    expect(readIncoming('glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Fhcp%2Fv1&code=K7M2PQ9X&kind=pro', PROVIDERS, [])).toEqual(want);
    // Another provider with kind=pro (golf.de's, Trackman's) is none this kind has.
    for (const provider of ['golfde', 'trackman', 'owgr'])
      expect(readIncoming(`glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Fhcp%2Fv1&code=K7M2PQ9X&provider=${provider}&kind=pro`, PROVIDERS, [])).toEqual({ kind: 'invalid', error: 'unknown:provider' });
    // Spec 1.18.0: a pro's pairing jumps back too, once its target named the address as its own (backAfterPairing).
    expect(readIncoming('glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Fhcp%2Fv1&code=K7M2PQ9X&provider=pro&kind=pro&return=exampleapp%3A%2F%2Fx', PROVIDERS, [])).toMatchObject({ kind: 'pair-pro', return: 'exampleapp://x' });
    expect(readIncoming('glmsync://read?kind=pro', PROVIDERS, [])).toEqual({ kind: 'read', what: 'pro' });
    expect(readIncoming('glmsync://read?kind=hcp', PROVIDERS, [])).toEqual({ kind: 'read', what: 'hcp' });
  });
});

describe('several launch monitors in a pair link (spec 1.18.0)', () => {
  const T = 'https%3A%2F%2Fapp.example.org%2Flm%2Fv1';

  it('offers those of them this app has, in its own order, and pairs the first by default', () => {
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=demo,trackman`, PROVIDERS, [])).toMatchObject({ kind: 'pair', provider: 'trackman', choices: ['trackman', 'demo'] });
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=other,demo`, PROVIDERS, [])).toMatchObject({ kind: 'pair', provider: 'demo', choices: ['demo'] });
  });

  it('is no link when it names none this app has', () => {
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=other,another`, PROVIDERS, [])).toEqual({ kind: 'invalid', error: 'unknown:provider' });
  });
});

describe('where a pair link jumps back to once paired (spec 1.2.0)', () => {
  const link = 'glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Flm%2Fv1&code=K7M2PQ9X&return=exampleapp%3A%2F%2Fprofile%3Ffocus%3Dlm';

  it('the link carries its return into the question', () => {
    const r = readIncoming(link, PROVIDERS, []);
    expect(r.kind === 'pair' && r.return).toBe('exampleapp://profile?focus=lm');
  });

  it('only to a prefix the target named in its answer to the pairing', () => {
    const r = readIncoming(link, PROVIDERS, []);
    if (r.kind !== 'pair') throw new Error(r.kind);
    expect(backAfterPairing(r, pairing('https://app.example.org/lm/v1', ['exampleapp://']))).toBe('exampleapp://profile?focus=lm');
    expect(backAfterPairing(r, pairing('https://app.example.org/lm/v1', ['https://app.example.org/']))).toBeNull();
    expect(backAfterPairing(r, pairing('https://app.example.org/lm/v1', []))).toBeNull();
    // A prefix without its closing '/' or '://' stretches to nothing.
    expect(backAfterPairing(r, pairing('https://app.example.org/lm/v1', ['exampleapp']))).toBeNull();
  });

  it('nowhere without a return, and a bad one makes the whole link invalid', () => {
    expect(backAfterPairing({}, pairing('https://app.example.org/lm/v1', ['exampleapp://']))).toBeNull();
    expect(readIncoming(link.replace('exampleapp%3A%2F%2Fprofile%3Ffocus%3Dlm', 'javascript%3Aalert(1)'), PROVIDERS, []).kind).toBe('invalid');
  });
});

describe('where a sync link jumps back to', () => {
  const ps = [pairing('https://app.example.org/lm/v1', ['exampleapp://', 'https://app.example.org/']), pairing('https://b.example/lm/v1', ['bapp://'])];

  it('only to a prefix the paired target named', () => {
    expect(backTo({ return: 'exampleapp://lm/done' }, ps)).toBe('exampleapp://lm/done');
    expect(backTo({ return: 'https://app.example.org/profile' }, ps)).toBe('https://app.example.org/profile');
    expect(backTo({ return: 'https://app.example.org.evil.test/' }, ps)).toBeNull();
    expect(backTo({ return: 'otherapp://x' }, ps)).toBeNull();
    expect(backTo({}, ps)).toBeNull();
  });

  it('a link naming a target takes only that target\'s prefixes', () => {
    expect(backTo({ target: 'https://b.example/lm/v1', return: 'exampleapp://lm/done' }, ps)).toBeNull();
    expect(backTo({ target: 'https://b.example/lm/v1', return: 'bapp://done' }, ps)).toBe('bapp://done');
  });

  it('nowhere without a pairing', () => {
    expect(backTo({ return: 'exampleapp://lm/done' }, [])).toBeNull();
  });

  it('a sync link is read strictly too', () => {
    expect(readIncoming('glmsync://sync?return=javascript:alert(1)', PROVIDERS, ps).kind).toBe('invalid');
    expect(readIncoming('glmsync://sync?return=exampleapp://x', PROVIDERS, ps)).toEqual({ kind: 'sync', return: 'exampleapp://x' });
  });
});

describe('a test link (spec 1.8.0)', () => {
  const a = pairing('https://app.example.org/lm/v1', ['exampleapp://']);
  const b = pairing('https://other.example.net/lm/v1', []);

  it('opens test mode for the pairings it may be for: the named target’s, else all', () => {
    expect(readIncoming('glmsync://test?code=T7K2M9QX', PROVIDERS, [a, b])).toEqual({ kind: 'test', code: 'T7K2M9QX', keys: [a.key, b.key] });
    expect(readIncoming('glmsync://test?target=https%3A%2F%2Fapp.example.org%2Flm%2Fv1%2F&code=T7K2M9QX', PROVIDERS, [a, b])).toEqual({ kind: 'test', code: 'T7K2M9QX', keys: [a.key] });
  });

  it('never pairs: without a pairing of its target it is for none (the app says to pair first)', () => {
    expect(readIncoming('glmsync://test?code=T7K2M9QX', PROVIDERS, [])).toEqual({ kind: 'test', code: 'T7K2M9QX', keys: [] });
    expect(readIncoming('glmsync://test?target=https%3A%2F%2Fevil.example%2Flm%2Fv1&code=T7K2M9QX', PROVIDERS, [a])).toEqual({ kind: 'test', code: 'T7K2M9QX', keys: [] });
  });

  it('is read strictly, and never reads as a sync', () => {
    for (const bad of ['glmsync://test', 'glmsync://test?code=a', 'glmsync://test?code=T7K2M9QX#x']) {
      expect(readIncoming(bad, PROVIDERS, [a]).kind).toBe('invalid');
    }
    // Nothing to jump back to, whatever the link adds.
    expect(readIncoming('glmsync://test?code=T7K2M9QX&return=exampleapp://x', PROVIDERS, [a])).toEqual({ kind: 'test', code: 'T7K2M9QX', keys: [a.key] });
  });
});

describe('the same link twice', () => {
  it('is taken once within a few seconds, again later', () => {
    const once = new Once(3000);
    expect(once.fresh('glmsync://sync', 0)).toBe(true);
    expect(once.fresh('glmsync://sync', 1000)).toBe(false);
    expect(once.fresh('glmsync://sync', 5000)).toBe(true);
    expect(once.fresh('glmsync://pair?x', 5100)).toBe(true);
  });
});

describe('the host shown', () => {
  it('is the address without scheme, port or path', () => {
    expect(hostOf('https://Bbc.Example.org:8443/lm/v1')).toBe('bbc.example.org');
    expect(hostOf('http://[::1]:8000/lm/v1')).toBe('[::1]');
  });
});

describe('the handicap record’s links (spec 1.10.0, 1.11.0)', () => {
  const T = 'https%3A%2F%2Fapp.example.org%2Fhcp%2Fv1';

  it('a pair link with kind=hcp asks about the handicap record, for golf.de, and keeps where to jump back to (1.18.0)', () => {
    // Before TE-10b-3 the app took it for launch monitor data (Trackman), which a handicap target refuses.
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&kind=hcp`, PROVIDERS, [])).toEqual({
      kind: 'pair-hcp',
      target: 'https://app.example.org/hcp/v1',
      code: 'K7M2PQ9X',
      provider: 'golfde',
      host: 'app.example.org',
    });
    const r = readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=golfde&kind=hcp&return=exampleapp%3A%2F%2Fback`, PROVIDERS, []);
    // Before spec 1.18.0 the return was dropped and the player stayed in this app (GF-1); it is followed only once the
    // target named the address as its own in its answer to the pairing.
    expect(r).toMatchObject({ kind: 'pair-hcp', provider: 'golfde', return: 'exampleapp://back' });
    if (r.kind !== 'pair-hcp') throw new Error(r.kind);
    expect(backAfterPairing(r, { target: { return_prefixes: ['exampleapp://'] } })).toBe('exampleapp://back');
    expect(backAfterPairing(r, { target: {} })).toBeNull();
  });

  it('refuses another provider for the handicap record, and golf.de for launch monitor data', () => {
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=trackman&kind=hcp`, PROVIDERS, [])).toEqual({ kind: 'invalid', error: 'unknown:provider' });
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=golfde`, PROVIDERS, []).kind).toBe('invalid');
    expect(readIncoming(`glmsync://pair?target=${T}&code=K7M2PQ9X&provider=golfde&kind=lm`, PROVIDERS, []).kind).toBe('invalid');
  });

  it('a read link only opens the golf.de window; another kind is no link', () => {
    expect(readIncoming('glmsync://read?kind=hcp', PROVIDERS, [])).toEqual({ kind: 'read', what: 'hcp' });
    expect(readIncoming('glmsync://read?kind=lm', PROVIDERS, []).kind).toBe('invalid');
    expect(readIncoming('glmsync://read', PROVIDERS, []).kind).toBe('invalid');
  });
});

describe('signing in for an app that fetches itself (spec 1.27.0)', () => {
  const K = 'V3AkokQxcb4Lu-CjPyCnth0dmxHg6ho2Ma9CRWBij3g';
  const N = 'P78Lo5LjcgmeryiX_ZgizR00G9IpLnAb';
  const caddie = pairing('https://app.example.org/lm/v1', ['exampleapp://']);
  const signin = `glmsync://signin?provider=trackman&key=${K}&nonce=${N}&return=exampleapp%3A%2F%2Fsignedin`;

  it('a signin link names the pairing of the app it goes back to, its question and its way back', () => {
    expect(readIncoming(signin, PROVIDERS, [pairing('https://other.example/lm/v1', ['otherapp://']), caddie])).toEqual({
      kind: 'signin', provider: 'trackman', pairing: caddie.key, name: 'Example App', ask: { key: K, nonce: N, back: 'exampleapp://signedin' },
    });
  });

  it('names no pairing where no app paired here named that way back, and refuses a provider this app lacks', () => {
    expect(readIncoming(signin, PROVIDERS, [pairing('https://other.example/lm/v1', ['otherapp://'])])).toEqual({ kind: 'signin', provider: 'trackman', pairing: null });
    expect(readIncoming(signin.replace('trackman', 'other'), PROVIDERS, [caddie]).kind).toBe('invalid');
    expect(readIncoming(signin.replace(`key=${K}`, 'key=short'), PROVIDERS, [caddie]).kind).toBe('invalid');
  });

  it('reads the universal form as the link itself', () => {
    const universal = `https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/signin#${signin.split('?')[1]}`;
    expect(readIncoming(universal, PROVIDERS, [caddie])).toEqual(readIncoming(signin, PROVIDERS, [caddie]));
  });

  it('a pair link may ask to only sign in, and to hand the sign-in over at once', () => {
    const base = 'glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Flm%2Fv1&code=K7M2PQ9X&mode=signin';
    expect(readIncoming(base, PROVIDERS, [])).toMatchObject({ kind: 'pair', mode: 'signin_only' });
    expect(readIncoming(base, PROVIDERS, [])).not.toHaveProperty('ask');
    expect(readIncoming(`${base}&key=${K}&nonce=${N}&return=exampleapp%3A%2F%2Fpaired`, PROVIDERS, [])).toMatchObject({
      kind: 'pair', mode: 'signin_only', return: 'exampleapp://paired', ask: { key: K, nonce: N },
    });
    expect(readIncoming('glmsync://pair?target=https%3A%2F%2Fapp.example.org%2Flm%2Fv1&code=K7M2PQ9X', PROVIDERS, [])).not.toHaveProperty('mode');
  });
});

describe('a test link (spec 1.28.0: at a connection that only signs in)', () => {
  const pairing = (key: string, mode?: 'signin_only') => ({ key, target: { name: `App ${key}` }, ...(mode ? { mode } : {}) });

  it('goes into the sign-in question that is open for its pairing (a QR scanned meanwhile)', () => {
    expect(routeTestLink({ pairing: 'a' }, ['a'], [pairing('a', 'signin_only')])).toEqual({ to: 'handover' });
  });

  it('starts the test of a connection that fetches itself, as before', () => {
    expect(routeTestLink(null, ['a', 'b'], [pairing('a'), pairing('b', 'signin_only')])).toEqual({ to: 'test', keys: ['a'] });
  });

  it('at a connection that only signs in, outside a question: says to start in that app', () => {
    expect(routeTestLink(null, ['b'], [pairing('b', 'signin_only')])).toEqual({ to: 'home', message: 'inTarget', name: 'App b' });
    expect(routeTestLink({ pairing: 'x' }, ['b'], [pairing('b', 'signin_only')])).toEqual({ to: 'home', message: 'inTarget', name: 'App b' });
  });

  it('without a pairing of its app: to pair first', () => {
    expect(routeTestLink(null, [], [])).toEqual({ to: 'home', message: 'pairFirst' });
  });
});
