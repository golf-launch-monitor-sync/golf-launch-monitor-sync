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
 *   signs in and opens their record themselves - it never pairs and sends nothing by itself;
 * - a pair link with `kind=pro` (spec 1.15.0) asks the same question for a pro's own world ranking pages (the provider
 *   `pro`, none other), and its read link only opens the app's window on those sites, where the player opens their page
 *   and taps *Send* themselves;
 * - since spec 1.18.0 a launch monitor's pair link may name several providers (this app offers those it has), and the
 *   pair links of golf.de's record and a pro's pages keep their `return` too, followed by the same rule;
 * - since spec 1.27.0 a pair link may say `mode=signin` (the app that asks fetches itself: this one only keeps the
 *   sign-in for that connection), with a question to answer at once; a signin link asks for the sign-in of a paired
 *   app, answered sealed for that app's key alone and only by the way back it named at pairing (lib/handover.ts);
 * - an address of the project's universal links (spec 1.22.0, `…/link/pair#…` and the others) reads as its link.
 */

import { PROVIDER_ID as GOLFDE } from '@glmsync/provider-golfde';
import { parseLink, parseUniversal, PRO_PROVIDER, providersOf, returnAllowed } from '@glmsync/spec';
import type { KeyedPairing } from '@glmsync/engine';
import { pickPairing, type Ask } from './handover.ts';

export type Incoming =
  /**
   * A launch monitor: `choices` the providers of this app's the link allows (spec 1.18.0: it may name several; none
   * named: Trackman - the demo only when a link names it), `provider` the first of them.
   */
  | {
      kind: 'pair';
      target: string;
      code: string;
      provider: string;
      choices: string[];
      host: string;
      replaces: boolean;
      return?: string;
      /** Spec 1.27.0: only keep the sign-in for this connection; `ask`: hand it over at once, sealed for that key. */
      mode?: 'signin_only';
      ask?: { key: string; nonce: string };
    }
  /**
   * Spec 1.27.0: a paired app asks for the sign-in. `pairing`: the one whose app the way back belongs to (null: none here
   * - nothing is handed over and nothing jumps back); `name`: that app's.
   */
  | { kind: 'signin'; provider: string; pairing: string; name: string; ask: Required<Ask> }
  | { kind: 'signin'; provider: string; pairing: null }
  /** The handicap record (kind=hcp); `return` since spec 1.18.0, followed once the target named it as its own. */
  | { kind: 'pair-hcp'; target: string; code: string; provider: string; host: string; return?: string }
  /** A pro's world ranking pages (kind=pro, spec 1.15.0); `return` likewise. */
  | { kind: 'pair-pro'; target: string; code: string; provider: string; host: string; return?: string }
  /** Open the golf.de window (spec 1.11.0, `hcp`) or the world ranking window (1.15.0, `pro`). */
  | { kind: 'read'; what: 'hcp' | 'pro' }
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
  const link = typeof url === 'string' && url.startsWith('https://') ? parseUniversal(url) : parseLink(url);
  if (!link.ok) return { kind: 'invalid', error: link.error };
  if (link.action === 'read') return { kind: 'read', what: link.kind === 'pro' ? 'pro' : 'hcp' };
  if (link.action === 'signin') {
    if (!providers.includes(link.provider)) return { kind: 'invalid', error: 'unknown:provider' };
    const p = pickPairing(link, pairings);
    if (!p) return { kind: 'signin', provider: link.provider, pairing: null };
    return { kind: 'signin', provider: link.provider, pairing: p.key, name: p.target.name, ask: { key: link.key, nonce: link.nonce, back: link.return } };
  }
  if (link.action === 'pair' && link.kind === 'pro') {
    const provider = link.provider ?? PRO_PROVIDER;
    if (provider !== PRO_PROVIDER) return { kind: 'invalid', error: 'unknown:provider' };
    return { kind: 'pair-pro', target: link.target, code: link.code, provider, host: hostOf(link.target), ...(link.return ? { return: link.return } : {}) };
  }
  if (link.action === 'pair' && link.kind === 'hcp') {
    const provider = link.provider ?? GOLFDE;
    if (provider !== GOLFDE) return { kind: 'invalid', error: 'unknown:provider' };
    return { kind: 'pair-hcp', target: link.target, code: link.code, provider, host: hostOf(link.target), ...(link.return ? { return: link.return } : {}) };
  }
  if (link.action === 'pair') {
    const named = link.provider ? (providersOf(link.provider) ?? []) : ['trackman'];
    const choices = providers.filter((p) => named.includes(p));
    const provider = choices[0];
    if (provider === undefined) return { kind: 'invalid', error: 'unknown:provider' };
    const base = link.target.replace(/\/+$/, '');
    const replaces = pairings.some((p) => choices.includes(p.provider) && p.base.replace(/\/+$/, '') === base);
    return {
      kind: 'pair',
      target: link.target,
      code: link.code,
      provider,
      choices,
      host: hostOf(link.target),
      replaces,
      ...(link.return ? { return: link.return } : {}),
      ...(link.mode === 'signin' ? { mode: 'signin_only' as const } : {}),
      ...(link.key && link.nonce ? { ask: { key: link.key, nonce: link.nonce } } : {}),
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
export function backAfterPairing(link: { return?: string }, paired: { target: { return_prefixes?: readonly string[] } }): string | null {
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
