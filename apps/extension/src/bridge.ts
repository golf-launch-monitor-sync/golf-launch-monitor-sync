// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The bridge on a paired target's page (spec/page-bridge.md): what the extension answers a page that asks
 * where it stands or to fetch now. Pure apart from what it is handed, so it is tested without a browser
 * (bridge.test.ts); the background wires it to the client, the content script to the page.
 *
 * A page can start no more than *fetch now* would in the popup: a `manual` sync of its own target's pairing,
 * or (spec 1.12.0) one with `reason=open` when the player came back to the target app - the plan first, the
 * guard as always - and not again within BRIDGE_FETCH_GAP_S.
 */

import type { ClientStatus, RunReport } from '@glmsync/browser';
import { BRIDGE_FETCH_GAP_S, type BridgeFetchReason, type BridgeOutcome, type BridgeReply, type BridgeRequest } from '@glmsync/spec';

export interface BridgeDeps {
  status(): Promise<ClientStatus>;
  /** When the guard lets the next provider request go, if it holds for long (ms); else null. */
  guardHold(): Promise<number | null>;
  /** A sync of one pairing with the page's reason (the background's own run: icon, history alarm). */
  run(id: string, reason: BridgeFetchReason): Promise<RunReport>;
  now(): number;
  /** When a page last started a fetch of this pairing (ms), and noting it. Kept by the caller. */
  lastStarted(id: string): Promise<number | null>;
  started(id: string, at: number): Promise<void>;
}

/** The origin of a page or a target's base, or null for anything that isn't http(s). */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** Where the bridge goes: one match pattern per origin of a pairing (the address the player allowed). */
export function bridgeMatches(pairings: readonly { base: string }[]): string[] {
  const out = new Set<string>();
  for (const p of pairings) {
    const o = originOf(p.base);
    if (o) out.add(`${o}/*`);
  }
  return [...out].sort();
}

/** The pairing a page of `origin` speaks for: the newest one whose target lives there. */
export function pairingFor(s: ClientStatus, origin: string): ClientStatus['pairings'][number] | null {
  const mine = s.pairings.filter((p) => originOf(p.base) === origin);
  mine.sort((a, b) => (a.paired_at < b.paired_at ? 1 : a.paired_at > b.paired_at ? -1 : 0));
  return mine[0] ?? null;
}

/** How a sync the page started ended, in the bridge's words. */
export function finishedOf(report: RunReport, id: string): { outcome: BridgeOutcome; until?: string } {
  const o = report.outcomes.find((x) => x.id === id)?.outcome;
  if (!o) return { outcome: 'failed' };
  switch (o.status) {
    case 'synced':
      if (o.notice?.code === 'auth_expired') return { outcome: 'signin' };
      if (o.notice?.code === 'guard_limit') return o.notice.until ? { outcome: 'guard', until: o.notice.until } : { outcome: 'guard' };
      return { outcome: 'synced' };
    case 'not_due':
    case 'busy':
      return { outcome: 'not_due' };
    case 'other_account':
      return { outcome: 'other_account' };
    case 'skipped':
    case 'told_expired':
      return { outcome: 'signin' };
    default:
      return { outcome: 'failed' };
  }
}

/**
 * The answer to a page's request. For a fetch that starts, `then` runs the sync and answers how it ended
 * (the second reply, `finished`), in `finish`.
 */
export async function answer(deps: BridgeDeps, req: BridgeRequest, origin: string): Promise<{ reply: BridgeReply; finish?: () => Promise<BridgeReply> }> {
  const s = await deps.status();
  const p = pairingFor(s, origin);
  if (!p) return { reply: { id: req.id, answer: 'unpaired' } };
  const fetching = s.running.includes(p.id);
  if (req.ask === 'state') return { reply: { id: req.id, answer: 'state', signin: p.signin, fetching } };

  if (p.signin !== 'ready') return { reply: { id: req.id, answer: 'signin', signin: p.signin } };
  const now = deps.now();
  const last = await deps.lastStarted(p.id);
  if (fetching || (last !== null && now - last < BRIDGE_FETCH_GAP_S * 1000 && now >= last)) return { reply: { id: req.id, answer: 'busy' } };
  const hold = await deps.guardHold();
  if (hold !== null && hold > now) return { reply: { id: req.id, answer: 'guard', until: new Date(hold).toISOString() } };
  await deps.started(p.id, now);
  return {
    reply: { id: req.id, answer: 'started' },
    finish: async () => {
      try {
        return { id: req.id, answer: 'finished', ...finishedOf(await deps.run(p.id, req.reason), p.id) };
      } catch {
        return { id: req.id, answer: 'finished', outcome: 'failed' };
      }
    },
  };
}
