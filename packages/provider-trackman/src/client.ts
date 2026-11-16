// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One GraphQL call to Trackman from the player's own device, with their own sign-in, through the
 * load guard (every call is counted, paused and logged by the context it runs in).
 *
 * The device calls api.trackmangolf.com itself, in a browser and on a phone alike: Trackman's API
 * answers cross-origin requests that carry an `Authorization` header. There is no relay and no
 * server in the middle. Nothing here pretends to be the portal: no copied User-Agent, no spoofing,
 * no cookies; the request says who it is by the token it carries, and nothing else.
 *
 * The token is handed in with every call rather than read from a store, so a sync keeps the
 * sign-in it started with.
 */

import { ProviderAuthError, ProviderError, ProviderUnavailableError, type ProviderContext } from '@glmsync/core';

export const GRAPHQL_URL = 'https://api.trackmangolf.com/graphql';

type GraphQLAnswer = { data?: Record<string, unknown> | null; errors?: unknown };

/**
 * One call. `partialOk` false: an answer with errors counts as an error even if some data came with
 * it (a session is only kept complete; a page of the activity list must not pass for the end of it).
 *
 * Throws `ProviderAuthError` (401: sign in again), `ProviderUnavailableError` (anything else Trackman
 * refuses, or an answer that is no answer - it stops the whole fetch: one session failing that way
 * would fail for all of them), `ProviderError` (Trackman answered, but with errors instead of data:
 * only this item waits), and whatever the context throws (no network, the guard).
 */
export async function query<T = Record<string, unknown>>(
  ctx: ProviderContext,
  kind: string,
  token: string,
  gql: string,
  variables: Record<string, unknown> = {},
  { partialOk = true }: { partialOk?: boolean } = {},
): Promise<T> {
  if (!token) throw new ProviderAuthError('No Trackman sign-in on this device.');
  const answer = await ctx.http(kind, GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (answer.status === 401) throw new ProviderAuthError('Trackman rejected the sign-in (expired or invalid).');
  if (answer.status < 200 || answer.status > 299) throw new ProviderUnavailableError(`Trackman HTTP ${answer.status}`, answer.retryAfterS);
  let body: GraphQLAnswer;
  try {
    body = JSON.parse(answer.body) as GraphQLAnswer;
  } catch {
    throw new ProviderUnavailableError('Trackman sent an unexpected answer.'); // e.g. a maintenance page
  }
  if (!body || typeof body !== 'object') throw new ProviderUnavailableError('Trackman sent an unexpected answer.');
  const data = (body.data && typeof body.data === 'object' ? body.data : {}) as Record<string, unknown>;
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.length) {
    const said = errors
      .map((e) => (e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : '?'))
      .join('; ')
      .slice(0, 300);
    // Partial data (one field failed) is still data; nothing at all is an error.
    if (!partialOk || !Object.values(data).some((v) => v !== null && v !== undefined)) throw new ProviderError(`Trackman: ${said}`);
  }
  return data as T;
}
