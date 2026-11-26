// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { focusOf, focusServices, inFocus, pairingProvider } from './focus.ts';

const TRACKMAN = { id: 'trackman', name: 'Trackman' };
const OTHER = { id: 'other', name: 'Other' };

describe('the focus of a link (spec 1.18.0)', () => {
  it('is nothing when the player opened the client themselves', () => {
    expect(focusOf(null)).toBeNull();
    expect(focusOf(undefined)).toBeNull();
    for (const kind of ['lm', 'hcp', 'pro'] as const) expect(inFocus(null, kind)).toBe(true);
  });

  it('is the link’s kind, a launch monitor without one', () => {
    expect(focusOf({})).toEqual({ kind: 'lm', providers: [] });
    expect(focusOf({ kind: 'hcp', provider: 'golfde' })).toEqual({ kind: 'hcp', providers: [] });
    expect(focusOf({ kind: 'pro' })).toEqual({ kind: 'pro', providers: [] });
  });

  it('shows only its own kind: a launch monitor link hides golf.de and a pro’s pages', () => {
    const lm = focusOf({ kind: 'lm', provider: 'trackman' });
    expect(inFocus(lm, 'lm')).toBe(true);
    expect(inFocus(lm, 'hcp')).toBe(false);
    expect(inFocus(lm, 'pro')).toBe(false);
    const hcp = focusOf({ kind: 'hcp' });
    expect(inFocus(hcp, 'lm')).toBe(false);
    expect(inFocus(hcp, 'hcp')).toBe(true);
  });

  it('offers the launch monitors the link names, all without names', () => {
    expect(focusServices(null, [TRACKMAN, OTHER])).toEqual([TRACKMAN, OTHER]);
    expect(focusServices(focusOf({}), [TRACKMAN, OTHER])).toEqual([TRACKMAN, OTHER]);
    expect(focusServices(focusOf({ provider: 'trackman' }), [TRACKMAN, OTHER])).toEqual([TRACKMAN]);
    expect(focusServices(focusOf({ provider: 'other,trackman' }), [TRACKMAN, OTHER])).toEqual([TRACKMAN, OTHER]);
    // Only ones this client doesn't know: by their id, so the pairing says it can't.
    expect(focusServices(focusOf({ provider: 'unknown' }), [TRACKMAN])).toEqual([{ id: 'unknown', name: 'unknown' }]);
  });

  it('pairs with the provider tapped, if the link allows it, else its first', () => {
    expect(pairingProvider(undefined, 'trackman')).toBe('trackman');
    expect(pairingProvider('trackman,other', 'other')).toBe('other');
    expect(pairingProvider('trackman,other', 'demo')).toBe('trackman');
    expect(pairingProvider('trackman', undefined)).toBe('trackman');
    expect(pairingProvider(undefined, undefined)).toBeUndefined();
  });
});
