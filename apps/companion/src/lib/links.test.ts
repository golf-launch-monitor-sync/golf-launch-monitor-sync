// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { Pairing } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import { backAfterPairing, backTo, hostOf, Once, readIncoming } from './links.ts';
import type { KeyedPairing } from './pairings.ts';

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
    expect(r).toEqual({ kind: 'pair', target: 'https://App.Example.org/lm/v1', code: 'K7M2PQ9X', provider: 'trackman', host: 'app.example.org', replaces: false });
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
  it('starts no sync and pairs nothing while this app has no test mode', () => {
    const pairings = [pairing('https://app.example.org/lm/v1', ['exampleapp://'])];
    expect(readIncoming('glmsync://test?code=T7K2M9QX', PROVIDERS, pairings)).toEqual({ kind: 'invalid', error: 'unsupported:test' });
    expect(readIncoming('glmsync://test?target=https%3A%2F%2Fapp.example.org%2Flm%2Fv1&code=T7K2M9QX', PROVIDERS, pairings).kind).toBe('invalid');
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
