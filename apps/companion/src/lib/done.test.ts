// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { afterDone, afterLeaving, lmFocus, signInAfterLink } from './done.ts';

describe('where Done goes (spec 1.18.0, the focus of a link)', () => {
  it('jumped back to the app: the list waits for the player’s own next look', () => {
    expect(afterDone('lm:trackman', 'back')).toEqual({ name: 'home' });
    expect(afterDone('hcp', 'back')).toEqual({ name: 'home' });
  });

  it('no way back from a link: the card of this one connection, not the list (GF-1: it was the list)', () => {
    expect(afterDone('lm:trackman', 'here')).toEqual({ name: 'home', focus: 'lm:trackman', linked: true });
    expect(afterDone('hcp', 'stayed')).toEqual({ name: 'home', focus: 'hcp', linked: true });
    expect(afterDone('pro', 'here')).toEqual({ name: 'home', focus: 'pro', linked: true });
  });

  it('the player came by themselves: the list, as before', () => {
    expect(afterDone(null, 'here')).toEqual({ name: 'home' });
    expect(afterDone(undefined, 'stayed')).toEqual({ name: 'home' });
  });

  it('a link’s focus ends when the app goes to the back; other screens stay', () => {
    expect(afterLeaving({ name: 'home', focus: 'hcp', linked: true })).toEqual({ name: 'home' });
    const own = { name: 'home', focus: 'hcp' } as const;
    expect(afterLeaving(own)).toBe(own);
    const golfde = { name: 'golfde' } as const;
    expect(afterLeaving(golfde)).toBe(golfde);
  });

  it('names a launch monitor’s card by the provider its pairings share', () => {
    expect(lmFocus([{ provider: 'trackman' }, { provider: 'trackman' }])).toBe('lm:trackman');
    expect(lmFocus([{ provider: 'trackman' }, { provider: 'demo' }])).toBeNull();
    expect(lmFocus([])).toBeNull();
  });
});

describe('a sync link whose sign-in ran out (Reginald’s test of 27 Nov)', () => {
  const run = (key: string, status: 'synced' | 'signed_out' | 'disconnected' | 'failed') => ({ key, run: { status } });
  const pairings = [
    { key: 'k1', provider: 'trackman' },
    { key: 'k2', provider: 'demo' },
  ];
  const known = ['trackman', 'demo'] as const;

  it('without a way back: straight to the sign-in, not the page of results', () => {
    expect(signInAfterLink({}, [run('k1', 'signed_out')], pairings, known)).toBe('trackman');
    expect(signInAfterLink({ target: 'https://app.example' } as { target: string; return?: string }, [run('k2', 'synced'), run('k1', 'signed_out')], pairings, known)).toBe('trackman');
  });

  it('with a way back the app jumps back as before; a run that went, or no sign-in missing, shows its results', () => {
    expect(signInAfterLink({ return: 'exampleapp://back' }, [run('k1', 'signed_out')], pairings, known)).toBeNull();
    expect(signInAfterLink({}, [run('k1', 'synced')], pairings, known)).toBeNull();
    expect(signInAfterLink({}, [run('k1', 'disconnected'), run('k2', 'failed')], pairings, known)).toBeNull();
    // A pairing gone meanwhile, or of a provider this app doesn't know: nothing to sign in to.
    expect(signInAfterLink({}, [run('k9', 'signed_out')], pairings, known)).toBeNull();
    expect(signInAfterLink({}, [run('k3', 'signed_out')], [{ key: 'k3', provider: 'elsewhere' }], known)).toBeNull();
  });
});
