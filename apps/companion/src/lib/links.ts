// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The links that open the app (spec/deep-links.md): `glmsync://pair?…` from a target app to pair,
 * `glmsync://sync?…` to fetch now and jump back. A link comes from outside - any app or web page can
 * open one - so it is read strictly (@glmsync/spec), and it can never make the app do more than the
 * player would by hand:
 *
 * - a pair link only opens a question ("Pair with <host>?"); the player says yes or no. Its `return`
 *   (spec 1.2.0) is followed only once paired, and only to an address that target then named as its own;
 * - a sync link asks the targets' plans like any other run (manual), and jumps back only to an
 *   address the paired target named as its own at pairing;
 * - a test link (spec 1.8.0) only opens test mode's question for a target this phone is paired with: it never
 *   pairs, never syncs by itself and never jumps back; the scenario comes only after the tester's yes;
 * - a pair link with `kind=hcp` (spec 1.10.0) asks the same question for the handicap record read along on golf.de
 *   (the provider `golfde`, none other); a read link (spec 1.11.0) only opens the golf.de window, where the player
 *   signs in and opens their record themselves - it never pairs and sends nothing by itself.
 */

import { PROVIDER_ID as GOLFDE } from '@glmsync/provider-golfde';
import { parseLink, returnAllowed } from '@glmsync/spec';
import type { KeyedPairing } from './pairings.ts';

export type Incoming =
  | { kind: 'pair'; target: string; code: string; provider: string; host: string; replaces: boolean; return?: string }
  /** The handicap record (kind=hcp): no `return` - a handicap pairing names no return_prefixes, so it never jumps back. */
  | { kind: 'pair-hcp'; target: string; code: string; provider: string; host: string }
  /** Open the golf.de window (spec 1.11.0). */
  | { kind: 'read' }
  | { kind: 'sync'; target?: string; return?: string }
  /** `keys`: the pairings it may be for (of the link's target when it names one); none: pair first. */
  | { kind: 'test'; code: string; keys: string[] }
  | { kind: 'invalid'; error: string };

/** The host of a target address, as the player is shown it ("app.example.org"). */
export function hostOf(target: string): string {
  const m = /^https?:\/\/(\[[^\]]+\]|[^/:?#]+)/.exec(target);
  return (m?.[1] ?? target).toLowerCase();
}

/** What a link asks for; `providers`: those this app has. */
export function readIncoming(url: unknown, providers: readonly string[], pairings: readonly KeyedPairing[]): Incoming {
  const link = parseLink(url);
  if (!link.ok) return { kind: 'invalid', error: link.error };
  // A pro's world ranking pages (spec 1.15.0, kind=pro) aren't read in this app yet: refused rather than taken for
  // another kind (a launch monitor pairing, golf.de's window).
  if ((link.action === 'pair' || link.action === 'read') && link.kind === 'pro') return { kind: 'invalid', error: 'unsupported:kind' };
  if (link.action === 'read') return { kind: 'read' };
  if (link.action === 'pair' && link.kind === 'hcp') {
    const provider = link.provider ?? GOLFDE;
    if (provider !== GOLFDE) return { kind: 'invalid', error: 'unknown:provider' };
    return { kind: 'pair-hcp', target: link.target, code: link.code, provider, host: hostOf(link.target) };
  }
  if (link.action === 'pair') {
    const provider = link.provider ?? 'trackman';
    if (!providers.includes(provider)) return { kind: 'invalid', error: 'unknown:provider' };
    const base = link.target.replace(/\/+$/, '');
    const replaces = pairings.some((p) => p.provider === provider && p.base.replace(/\/+$/, '') === base);
    return {
      kind: 'pair',
      target: link.target,
      code: link.code,
      provider,
      host: hostOf(link.target),
      replaces,
      ...(link.return ? { return: link.return } : {}),
    };
  }
  if (link.action === 'test') return { kind: 'test', code: link.code, keys: testPairings(pairings, link.target) };
  return { kind: 'sync', ...(link.target ? { target: link.target } : {}), ...(link.return ? { return: link.return } : {}) };
}

/** The pairings a test code may be for: those of the named target, else all (a test link never pairs). */
export function testPairings(pairings: readonly KeyedPairing[], target?: string): string[] {
  const base = target?.replace(/\/+$/, '');
  return pairings.filter((p) => base === undefined || p.base.replace(/\/+$/, '') === base).map((p) => p.key);
}

/**
 * Where a sync link may jump back to: only an address that starts with a prefix the paired target
 * named at pairing (that target's, when the link names one). null: stay here.
 */
export function backTo(link: { target?: string; return?: string }, pairings: readonly KeyedPairing[]): string | null {
  if (!link.return) return null;
  const base = link.target?.replace(/\/+$/, '');
  const of = base ? pairings.filter((p) => p.base.replace(/\/+$/, '') === base) : pairings;
  const prefixes = of.flatMap((p) => p.target.return_prefixes);
  return returnAllowed(link.return, prefixes) ? link.return : null;
}

/**
 * Where a pair link jumps back to once paired: only an address that starts with a prefix the target named in
 * its answer to this pairing. Decided after `POST /pair` - before it, nothing says the address is the target's.
 * null: stay here.
 */
export function backAfterPairing(link: { return?: string }, paired: Pick<KeyedPairing, 'target'>): string | null {
  if (!link.return) return null;
  return returnAllowed(link.return, paired.target.return_prefixes ?? []) ? link.return : null;
}

/**
 * The same link can arrive twice (once as the URL the app was started with, once as an event); a
 * link seen within a few seconds is taken once.
 */
export class Once {
  private last: { url: string; at: number } | null = null;

  constructor(private readonly windowMs = 3000) {}

  fresh(url: string, now: number): boolean {
    if (this.last && this.last.url === url && now - this.last.at < this.windowMs) return false;
    this.last = { url, at: now };
    return true;
  }
}
