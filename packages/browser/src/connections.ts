// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The main view of every client: *Connect new* and the list of connections, one per service and account, each with
 * where it stands - set up halfway, running, fetching the older history, run out (sign in again), another account
 * signed in, the last fetch failed, or test mode. A row opens its details (the overview as before).
 *
 * Pure, so it is tested without a browser: each client turns its own state into `ConnectionFacts` (the browser
 * clients through `connectionsOfStatus` and `connectionOfHcp`, the companion app its own), `connectionState` decides,
 * `connectionLine` says it.
 */

import type { ClientStatus } from './client.ts';
import type { HcpView } from './hcp.ts';
import type { T } from './i18n.ts';
import { factsOfHcp, factsOfStatus, wizardOf, type ServiceKind } from './wizard.ts';

export type ConnectionState = 'setup' | 'running' | 'history' | 'expired' | 'other' | 'failed' | 'test';

export interface ConnectionFacts {
  /** Its steps aren't through yet (the wizard stands before "done"). */
  setup: boolean;
  /** A made-up account of a target's test (spec/test-mode.md). */
  test: boolean;
  /** The service's sign-in on this device. */
  signIn: 'ok' | 'expired' | 'other';
  /** The last fetch for any of its apps failed. */
  failed: boolean;
  /** Its older history is still coming. */
  history: boolean;
}

/** What needs the player first wins: a test says so before anything; then what they must do; then what runs. */
export function connectionState(f: ConnectionFacts): ConnectionState {
  if (f.test) return 'test';
  if (f.setup) return 'setup';
  if (f.signIn === 'expired') return 'expired';
  if (f.signIn === 'other') return 'other';
  if (f.failed) return 'failed';
  return f.history ? 'history' : 'running';
}

export interface Connection {
  /** Stable within a client: `lm`, `hcp`, `test:<pairing id>`. */
  id: string;
  kind: ServiceKind;
  /** The service's name ("Trackman", "golf.de"). */
  service: string;
  /** The account at the service, as it named itself (null: none named). */
  account: string | null;
  /** The apps its data goes to. */
  targets: string[];
  state: ConnectionState;
}

type Pairing = ClientStatus['pairings'][number];

/**
 * A launch monitor client's connections: one for the account signed in (its real pairings), and one per pairing in
 * test mode (each its own made-up account).
 */
export function connectionsOfStatus(s: Pick<ClientStatus, 'key' | 'pairings' | 'running' | 'provider'> & { player?: string | null }, busy: ReadonlySet<string> = new Set()): Connection[] {
  const out: Connection[] = [];
  const real = s.pairings.filter((p) => !p.test);
  if (real.length) {
    const facts = factsOfStatus(s, busy);
    const k = s.key.state;
    out.push({
      id: 'lm',
      kind: 'lm',
      service: s.provider.name,
      account: k === 'ready' ? (s.player ?? null) : null,
      targets: names(real),
      state: connectionState({
        setup: !!facts && wizardOf(facts).step !== 'done',
        test: false,
        signIn: k === 'other' || real.some((p) => p.other_account) ? 'other' : k === 'ready' || k === 'confirm' ? 'ok' : 'expired',
        failed: real.some((p) => p.last?.status === 'failed'),
        history: real.some((p) => p.history?.done === false),
      }),
    });
  }
  for (const p of s.pairings.filter((x): x is Pairing & { test: NonNullable<Pairing['test']> } => !!x.test)) {
    out.push({ id: `test:${p.id}`, kind: 'lm', service: s.provider.name, account: p.test.player, targets: [p.name], state: 'test' });
  }
  return out;
}

/** The handicap record's connection (golf.de), if an app is connected for it. */
export function connectionOfHcp(v: Pick<HcpView, 'pairings' | 'account' | 'sending' | 'signed_out'>): Connection | null {
  if (!v.pairings.length) return null;
  const facts = factsOfHcp(v);
  return {
    id: 'hcp',
    kind: 'hcp',
    service: 'golf.de',
    account: null,
    targets: names(v.pairings),
    state: connectionState({
      setup: !!facts && wizardOf(facts).step !== 'done',
      test: false,
      signIn: v.signed_out ? 'expired' : 'ok',
      failed: v.pairings.some((p) => p.last?.status === 'failed'),
      history: false,
    }),
  };
}

function names(pairings: readonly { name: string }[]): string[] {
  return [...new Set(pairings.map((p) => p.name))];
}

export type ConnectionTone = 'ok' | 'busy' | 'warn' | 'test';

export interface ConnectionLine {
  /** "Trackman · Alex Example" */
  title: string;
  /** "→ Example App" */
  targets: string;
  /** "running", "set up halfway – continue", … */
  state: string;
  tone: ConnectionTone;
}

const TONE: Record<ConnectionState, ConnectionTone> = { setup: 'warn', running: 'ok', history: 'busy', expired: 'warn', other: 'warn', failed: 'warn', test: 'test' };

export function connectionLine(c: Connection, t: T): ConnectionLine {
  return {
    title: c.account ? t('connections.titleAccount', { service: c.service, account: c.account }) : c.service,
    targets: c.targets.length ? t('connections.targets', { targets: c.targets.join(', ') }) : t('connections.noApp'),
    state: t(`connections.state.${c.state}`),
    tone: TONE[c.state],
  };
}

/** Order of the list: what needs the player first, then the rest as the services come. */
export function sortConnections(list: readonly Connection[]): Connection[] {
  const rank = (c: Connection) => (TONE[c.state] === 'warn' ? 0 : c.state === 'test' ? 2 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b));
}
