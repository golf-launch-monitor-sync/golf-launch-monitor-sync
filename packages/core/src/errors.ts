// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What can go wrong, by whom it is about: one answer of the provider, the connection to the
 * provider as a whole, the load guard, or the target.
 *
 * Only a plain `ProviderError` is about one request (the provider answered, but not with what was
 * asked for): that one item waits for a later sync. Its subclasses are about the connection as a
 * whole and stop the whole fetch: a sync that goes on asking while the provider is down, refusing
 * or out of reach is load on the provider and nothing else.
 */

import type { NoticeCode } from '@glmsync/spec';

export class GlmsError extends Error {
  override name = 'GlmsError';
}

/** One answer lacked what was asked for: that item waits for a later sync. */
export class ProviderError extends GlmsError {
  override name = 'ProviderError';
}

/** The provider rejected the sign-in (expired or invalid): the player signs in again. */
export class ProviderAuthError extends ProviderError {
  override name = 'ProviderAuthError';
}

/** The provider couldn't be asked at all: no network, or the browser refused (CORS). */
export class ProviderBlockedError extends ProviderError {
  override name = 'ProviderBlockedError';
}

/**
 * The provider is having a moment or wants less load (429, 5xx, a refusal, a timeout, an answer
 * that is no answer). `retryAfterS`: how long it asked us to wait, when it said.
 */
export class ProviderUnavailableError extends ProviderError {
  override name = 'ProviderUnavailableError';
  constructor(
    message: string,
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

export type GuardReason = 'backoff' | 'busy' | 'pause' | 'per_day' | 'per_hour' | 'per_run';

/** The load guard refused a request (spec/guard.md). `until`: ms since the epoch, or null (next run). */
export class GuardLimitError extends GlmsError {
  override name = 'GuardLimitError';
  constructor(
    readonly reasons: GuardReason[],
    readonly until: number | null,
  ) {
    super(`The load guard holds requests for now (${reasons.join(', ')}).`);
  }
}

/** The guard couldn't keep its counts: then nothing is asked (a request it can't count must not go). */
export class GuardStorageError extends GlmsError {
  override name = 'GuardStorageError';
}

/** Stopped on purpose (the player signed out, the app closed the run). */
export class Cancelled extends GlmsError {
  override name = 'Cancelled';
  constructor(message = 'Stopped.') {
    super(message);
  }
}

export type TargetErrorCode =
  | 'bad_request'
  | 'code_invalid'
  | 'token_invalid'
  | 'other_account'
  | 'disconnected'
  | 'too_large'
  | 'invalid_batch'
  | 'rate_limited'
  | 'provider_unknown'
  // Test mode (spec 1.8.0, spec/test-mode.md): a test batch for an account that is no test account, a target
  // without scenarios, a test code with an account that is no test account, a code whose test is over.
  | 'test_data'
  | 'test_unavailable'
  | 'not_test_account'
  | 'code_expired'
  // Not from the target's answer but about it:
  | 'unreachable'
  | 'unavailable'
  | 'bad_answer';

/** The target refused, or couldn't be reached. `retryAfterS` with `rate_limited`. */
export class TargetError extends GlmsError {
  override name = 'TargetError';
  constructor(
    readonly code: TargetErrorCode,
    message: string,
    readonly status = 0,
    readonly retryAfterS: number | null = null,
  ) {
    super(message);
  }
}

/** A batch this client made is no olmd/1 batch at all (a bug, never the provider's data). */
export class InvalidBatchError extends GlmsError {
  override name = 'InvalidBatchError';
}

/** Trouble with the provider as a whole, or the guard: the fetch stops, what it has goes on. */
export function stopsTheFetch(e: unknown): boolean {
  return (
    e instanceof ProviderAuthError ||
    e instanceof ProviderBlockedError ||
    e instanceof ProviderUnavailableError ||
    e instanceof GuardLimitError ||
    e instanceof GuardStorageError ||
    e instanceof Cancelled ||
    !(e instanceof ProviderError)
  );
}

export interface Notice {
  code: NoticeCode;
  message?: string;
  until?: string;
}

/** What the player and the target should know about a fetch that stopped (the batch's `notice`). */
export function noticeFor(e: unknown, now: number): Notice {
  const iso = (t: number) => new Date(t).toISOString();
  if (e instanceof ProviderAuthError) return { code: 'auth_expired', message: 'Sign in to the provider again.' };
  if (e instanceof GuardLimitError) {
    const until = e.until !== null && e.until > now ? iso(e.until) : undefined;
    return {
      code: 'guard_limit',
      message: 'Enough asked of the provider for now; it goes on later by itself.',
      ...(until ? { until } : {}),
    };
  }
  if (e instanceof GuardStorageError) return { code: 'guard_limit', message: 'The request counts could not be kept on this device.' };
  if (e instanceof ProviderBlockedError) return { code: 'provider_blocked', message: 'The provider could not be reached from here.' };
  if (e instanceof ProviderUnavailableError) {
    const wait = e.retryAfterS !== null && e.retryAfterS > 0 ? iso(now + e.retryAfterS * 1000) : undefined;
    return { code: 'provider_unavailable', message: 'The provider is not answering properly right now.', ...(wait ? { until: wait } : {}) };
  }
  return { code: 'partial', message: 'Not everything could be fetched this time.' };
}
