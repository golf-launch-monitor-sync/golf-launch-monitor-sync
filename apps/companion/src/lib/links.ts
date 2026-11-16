// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The links that open the app (spec/deep-links.md): `glmsync://pair?…` from a target app to pair,
 * `glmsync://sync?…` to fetch now and jump back. A link comes from outside - any app or web page can
 * open one - so it is read strictly (@glmsync/spec), and it can never make the app do more than the
 * player would by hand:
 *
 * - a pair link only opens a question ("Pair with <host>?"); the player says yes or no;
 * - a sync link asks the targets' plans like any other run (manual), and jumps back only to an
 *   address the paired target named as its own at pairing.
 */

import { parseLink, returnAllowed } from '@glmsync/spec';
import type { KeyedPairing } from './pairings.ts';

export type Incoming =
  | { kind: 'pair'; target: string; code: string; provider: string; host: string; replaces: boolean }
  | { kind: 'sync'; target?: string; return?: string }
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
  if (link.action === 'pair') {
    const provider = link.provider ?? 'trackman';
    if (!providers.includes(provider)) return { kind: 'invalid', error: 'unknown:provider' };
    const base = link.target.replace(/\/+$/, '');
    const replaces = pairings.some((p) => p.provider === provider && p.base.replace(/\/+$/, '') === base);
    return { kind: 'pair', target: link.target, code: link.code, provider, host: hostOf(link.target), replaces };
  }
  return { kind: 'sync', ...(link.target ? { target: link.target } : {}), ...(link.return ? { return: link.return } : {}) };
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
