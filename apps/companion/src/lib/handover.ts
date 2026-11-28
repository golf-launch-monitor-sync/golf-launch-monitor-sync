// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Signing in for a target app (spec/deep-links.md, *Signing in for a target*; spec 1.27.0): what this app does when an
 * app on the phone that fetches itself asks for the player's provider sign-in, and the way back it answers in. Pure, so
 * the rules are tested; HandoverView runs them.
 *
 * - The sign-in goes only to an app paired here, only by the way back that app named at pairing (its return prefixes),
 *   and only sealed for the key of its question: an app that catches the way back reads nothing.
 * - It hands over a key that lasts: one that runs out within three days (or came without the browser it was signed in
 *   with) is renewed quietly first where it may, else the player signs in. A key of another provider account than the
 *   one the target connected is never handed over (`other_account`).
 * - Nothing here fetches anything from the provider; the asking app does that itself, with the browser's User-Agent
 *   handed over with the key.
 * - Test mode (spec 1.28.0, spec/test-mode.md *Only signing in for a target*): instead of signing in, the tester enters
 *   the asking app's test code; after "Is this your account?" the code goes over as the sign-in (`test: true`), of the
 *   scenario's made-up account, running out after the scenario's `signin_valid_s`. Kept here per pairing (TestSignIns),
 *   it is handed over again with a new end at every question while the test lasts - the renewal, without asking.
 */

import { accountRefOf, base64url, cleanUserAgent, sha256, utf8 } from '@glmsync/core';
import { instantMs, returnAllowed, testSigninUntil } from '@glmsync/spec';
import { seal, withAnswer, type HandedOver } from '@glmsync/spec/handover';

/** A key that runs out within this long is renewed first, so the asking app holds one that lasts (its own reminder comes two days before). */
export const RENEW_WITHIN_MS = 3 * 86_400_000;
/** A quiet renewal for an asking app gives up after this long (as at the app's opening). */
export const RENEW_FOR_ASK_MS = 45_000;

/** The question of the asking app: its key and nonce (none: a pair link that only goes back), and where to answer. */
export interface Ask {
  key?: string;
  nonce?: string;
  back: string;
}

/** A test sign-in kept for a pairing (spec 1.28.0): what the tester confirmed, from the asking app's scenario. */
export interface TestHeld {
  /** The asking app's test code: it goes over as the token. */
  code: string;
  /** The scenario's made-up account. */
  subject: string;
  /** The User-Agent of this phone's browser (a web view's, as at a real sign-in). */
  userAgent: string;
  /** The test's end (the scenario's `valid_until`). */
  validUntil: string;
  /** How long each handed-over sign-in lasts (the scenario's `signin_valid_s`); none: to the test's end. */
  signinValidS?: number;
}

/** A minute to spare: a test sign-in that would end within it is none (as a key is for the engine). */
const SLACK_MS = 60_000;

/** When a test sign-in handed over now would run out (ms), or null when the test can't give one that lasts any more. */
export function testUntil(test: TestHeld, now: number): string | null {
  const until = testSigninUntil({ valid_until: test.validUntil, ...(test.signinValidS !== undefined ? { signin_valid_s: test.signinValidS } : {}) }, now);
  const ms = until === null ? null : instantMs(until);
  return ms !== null && ms - now > SLACK_MS ? until : null;
}

export interface HandoverState {
  provider: string;
  /** The pairing's `account_salt` (spec/olmd.md). */
  salt: string;
  /** The account the target connected (the pairing's `account_ref`), when it said. */
  bound?: string;
  /** The key held here that still works (with its minute to spare), or none. */
  held: { token: string; subject: string | null; userAgent: string | null; expiresAt: number | null } | null;
  now: number;
  /** A quiet renewal was tried for this question. */
  renewTried: boolean;
  /** A quiet renewal may be tried at all (a key of the player's held here before). */
  mayRenew: boolean;
  /** The player signed in by hand for this question. */
  signedIn: boolean;
  /** The player left the sign-in without signing in. */
  cancelled?: boolean;
  /** A test sign-in kept for this pairing (spec 1.28.0), when there is one. */
  test?: TestHeld | null;
}

export type HandoverOutcome = { signin: 'sealed'; message: HandedOver } | { signin: 'none' | 'other_account' | 'failed' };

export type HandoverStep = { do: 'renew' } | { do: 'signin' } | { do: 'answer'; answer: HandoverOutcome };

const answer = (a: HandoverOutcome): HandoverStep => ({ do: 'answer', answer: a });

/** What to do next for the question, from where the sign-in stands. */
export function nextStep(st: HandoverState): HandoverStep {
  // A test that still lasts speaks for the pairing (spec 1.28.0): its code goes over, with a new end each time.
  const until = st.test ? testUntil(st.test, st.now) : null;
  if (st.test && until) {
    const ref = accountRefOf(st.salt, st.provider, st.test.subject);
    if (st.bound && ref !== st.bound) return answer({ signin: 'other_account' });
    return answer({ signin: 'sealed', message: { provider: st.provider, token: st.test.code, account_ref: ref, expires_at: until, user_agent: st.test.userAgent, test: true } });
  }
  const h = st.held;
  const usable = !!h && !!h.userAgent;
  const lasts = usable && (h.expiresAt === null || h.expiresAt - st.now > RENEW_WITHIN_MS);
  if (h && (lasts || (usable && st.signedIn))) {
    if (!h.subject) return answer({ signin: 'failed' }); // no account to name: the target couldn't tell it apart
    const ref = accountRefOf(st.salt, st.provider, h.subject);
    if (st.bound && ref !== st.bound) return answer({ signin: 'other_account' });
    const message: HandedOver = { provider: st.provider, token: h.token, account_ref: ref, user_agent: h.userAgent as string };
    if (h.expiresAt !== null) message.expires_at = new Date(h.expiresAt).toISOString();
    return answer({ signin: 'sealed', message });
  }
  if (st.cancelled) return answer({ signin: 'none' });
  if (st.signedIn) return answer({ signin: 'failed' }); // signed in, still nothing to hand over: no second round
  if (!st.renewTried && st.mayRenew) return { do: 'renew' };
  return { do: 'signin' };
}

/**
 * The secret key this answer is sealed under (spec: the client's own, for this answer alone, never one an outsider could
 * know). The phone's random source where it has one, always mixed with what only this phone holds - the pairing's import
 * token - and the question itself, so a phone without one (React Native brings none of its own) still makes a secret.
 */
export function answerSecret(parts: { importToken: string; key: string; nonce: string; now: number }, random?: Uint8Array): string {
  const seed = `glmsync handover|${parts.importToken}|${parts.key}|${parts.nonce}|${parts.now}|`;
  const rnd = random ?? platformRandom();
  const head = utf8(seed);
  const all = new Uint8Array(head.length + rnd.length);
  all.set(head);
  all.set(rnd, head.length);
  return base64url(sha256(all));
}

function platformRandom(): Uint8Array {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  try {
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(new Uint8Array(32));
  } catch {
    // none: the secret rests on the import token and the question
  }
  return new Uint8Array(0);
}

/**
 * The address to go back to with the answer. Without a key (a pair link with `mode=signin` and no question), just the
 * way back. A sealed answer that can't be made or wouldn't fit says `failed`.
 */
export function answerUrl(ask: Ask, outcome: HandoverOutcome, secret: string): string {
  if (!ask.key || !ask.nonce) return ask.back;
  if (outcome.signin === 'sealed') {
    const sealed = seal(outcome.message, ask.key, ask.nonce, secret);
    const url = sealed ? withAnswer(ask.back, { signin: 'sealed', ...sealed }) : null;
    if (url) return url;
    return withAnswer(ask.back, { signin: 'failed' }) ?? ask.back;
  }
  return withAnswer(ask.back, { signin: outcome.signin }) ?? ask.back;
}

const bare = (base: string) => base.replace(/\/+$/, '');

/**
 * The pairing a signin link is for: of its provider, of its target when it names one, and of the app the way back
 * belongs to (its return prefixes) - never another app's. null: none here (nothing is handed over, nothing jumps back).
 */
export function pickPairing<P extends { base: string; provider: string; target: { return_prefixes: readonly string[] } }>(
  link: { target?: string; provider: string; return: string },
  pairings: readonly P[],
): P | null {
  const base = link.target ? bare(link.target) : null;
  return pairings.find((p) => p.provider === link.provider && (base === null || bare(p.base) === base) && returnAllowed(link.return, p.target.return_prefixes)) ?? null;
}

/** What the empty web view said (UserAgentProbe): its User-Agent, if it is a header value; null for anything else. */
export function probeUserAgent(data: unknown): string | null {
  if (typeof data !== 'string' || data.length > 2_000) return null;
  try {
    return cleanUserAgent((JSON.parse(data) as { ua?: unknown }).ua);
  } catch {
    return null;
  }
}
