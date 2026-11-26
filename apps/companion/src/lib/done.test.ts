// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { afterDone, afterLeaving, lmFocus } from './done.ts';

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
