// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The client's sign-in as a target hears it (`signin` on GET /plan and GET /status), and the browser
 * extension's bridge on a paired target's page (spec/page-bridge.md). Since spec 1.5.0. Both read
 * untrusted input strictly, as the reference does (spec/reference/bridge.py, vectors in
 * signin.json and page-bridge.json): null for anything that isn't exactly one of these messages.
 */

/** What a client says about its provider sign-in. */
export const SIGN_IN_STATES = ['none', 'confirm', 'ready', 'expired', 'other'] as const;
export type SignIn = (typeof SIGN_IN_STATES)[number];

export const BRIDGE_ASKS = ['state', 'fetch'] as const;
export type BridgeAsk = (typeof BRIDGE_ASKS)[number];

/** Why a page asks for a fetch (spec 1.12.0): `manual` (the player tapped; also a request without a reason) or `open`
 * (the player came back to the target app: the plan is asked with `reason=open`, so the target decides). */
export const BRIDGE_FETCH_REASONS = ['manual', 'open'] as const;
export type BridgeFetchReason = (typeof BRIDGE_FETCH_REASONS)[number];

export const BRIDGE_OUTCOMES = ['synced', 'not_due', 'other_account', 'failed', 'guard', 'signin'] as const;
export type BridgeOutcome = (typeof BRIDGE_OUTCOMES)[number];

/** The bridge's protocol version. */
export const BRIDGE_VERSION = 1;
/** Set on the page's <html> once the extension's bridge is there (a hint; a `state` request is the answer). */
export const BRIDGE_MARK = 'data-glmsync-bridge';
/** Between two fetches a page starts for the same pairing, at least this long. */
export const BRIDGE_FETCH_GAP_S = 10;

export type BridgeRequest = { id: string; ask: 'state' } | { id: string; ask: 'fetch'; reason: BridgeFetchReason };

export type BridgeReply =
  | { id: string; answer: 'state'; signin: SignIn; fetching: boolean }
  | { id: string; answer: 'started' | 'busy' | 'unpaired' }
  | { id: string; answer: 'signin'; signin: Exclude<SignIn, 'ready'> }
  | { id: string; answer: 'guard'; until: string }
  | { id: string; answer: 'finished'; outcome: BridgeOutcome; until?: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TIME = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);
const id = (v: unknown): string | null => (typeof v === 'string' && ID.test(v) ? v : null);
const time = (v: unknown): string | null => (typeof v === 'string' && v.length <= 40 && TIME.test(v) ? v : null);

/** The `signin` query parameter, as the list of its values in the request: exactly one known value, else null. */
export function readSignIn(values: unknown): SignIn | null {
  if (!Array.isArray(values) || values.length !== 1) return null;
  return has(SIGN_IN_STATES, values[0]) ? values[0] : null;
}

/** A page's request to the extension; null when it is none. Unknown keys are ignored. */
export function readBridgeRequest(data: unknown): BridgeRequest | null {
  if (!isObject(data) || data.glmsync !== 'request' || data.v !== BRIDGE_VERSION) return null;
  const rid = id(data.id);
  if (rid === null || !has(BRIDGE_ASKS, data.ask)) return null;
  if (data.ask === 'state') return { id: rid, ask: 'state' };
  // A reason this version doesn't know is the old meaning: a manual fetch (1.11.0 and earlier sent none).
  return { id: rid, ask: 'fetch', reason: has(BRIDGE_FETCH_REASONS, data.reason) ? data.reason : 'manual' };
}

/** The extension's reply to a page; null when it is none this version knows. */
export function readBridgeReply(data: unknown): BridgeReply | null {
  if (!isObject(data) || data.glmsync !== 'reply' || data.v !== BRIDGE_VERSION) return null;
  const rid = id(data.id);
  const answer = data.answer;
  if (rid === null || typeof answer !== 'string') return null;
  switch (answer) {
    case 'state':
      return has(SIGN_IN_STATES, data.signin) && typeof data.fetching === 'boolean' ? { id: rid, answer, signin: data.signin, fetching: data.fetching } : null;
    case 'started':
    case 'busy':
    case 'unpaired':
      return { id: rid, answer };
    case 'signin':
      // Signed in is no reason not to fetch.
      return has(SIGN_IN_STATES, data.signin) && data.signin !== 'ready' ? { id: rid, answer, signin: data.signin } : null;
    case 'guard': {
      const until = time(data.until);
      return until === null ? null : { id: rid, answer, until };
    }
    case 'finished': {
      if (!has(BRIDGE_OUTCOMES, data.outcome)) return null;
      if (!('until' in data)) return { id: rid, answer, outcome: data.outcome };
      const until = time(data.until);
      return until === null ? null : { id: rid, answer, outcome: data.outcome, until };
    }
    default:
      return null;
  }
}

/** A reply as the extension posts it into the page. */
export function bridgeMessage(reply: BridgeReply): Record<string, unknown> {
  return { glmsync: 'reply', v: BRIDGE_VERSION, ...reply };
}
