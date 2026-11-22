// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The phone's list of connections (the main view, as in the extension and the web app: `@glmsync/browser`'s
 * connections): one per provider account - its pairings, its sign-in, how its last runs went -, one per pairing in test
 * mode, and golf.de's record. Pure, so it is tested without a phone.
 */

import { connectionOfHcp, connectionState, sortConnections, type Connection } from '@glmsync/browser/connections';
import type { HcpView } from '@glmsync/browser/hcp';
import type { LastRun } from './runner.ts';

export interface AppFacts {
  providers: readonly { id: string; name: string }[];
  pairings: readonly { key: string; provider: string; target: { name: string } }[];
  /** Pairings in test mode: the made-up account's name. */
  tests: readonly { key: string; player: string | null }[];
  signIn(provider: string): { valid: boolean; had: boolean; player: string | null };
  lastRun(key: string): LastRun | null;
  hcp: Pick<HcpView, 'pairings' | 'account' | 'sending' | 'signed_out'> | null;
}

export function connectionsOfApp(f: AppFacts): Connection[] {
  const out: Connection[] = [];
  const testKeys = new Set(f.tests.map((m) => m.key));
  for (const p of f.providers) {
    const real = f.pairings.filter((x) => x.provider === p.id && !testKeys.has(x.key));
    const s = f.signIn(p.id);
    // A sign-in without an app (the demo tried, or every app disconnected) is still the player's to see and end.
    if (!real.length && !s.valid) continue;
    const runs = real.map((x) => f.lastRun(x.key));
    out.push({
      id: `lm:${p.id}`,
      kind: 'lm',
      service: p.name,
      account: s.valid ? s.player : null,
      targets: [...new Set(real.map((x) => x.target.name))],
      state: connectionState({
        // Paired, never signed in on this phone: the steps aren't through.
        setup: real.length > 0 && !s.valid && !s.had,
        test: false,
        signIn: !s.valid ? 'expired' : runs.some((r) => r?.status === 'other_account') ? 'other' : 'ok',
        failed: runs.some((r) => r?.status === 'failed'),
        history: runs.some((r) => !!r?.more || (typeof r?.left === 'number' && r.left > 0)),
      }),
    });
  }
  for (const m of f.tests) {
    const p = f.pairings.find((x) => x.key === m.key);
    if (!p) continue;
    out.push({ id: `test:${m.key}`, kind: 'lm', service: f.providers.find((x) => x.id === p.provider)?.name ?? p.provider, account: m.player, targets: [p.target.name], state: 'test' });
  }
  const hcp = f.hcp ? connectionOfHcp(f.hcp) : null;
  if (hcp) out.push(hcp);
  return sortConnections(out);
}
