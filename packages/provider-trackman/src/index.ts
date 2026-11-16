// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The Trackman provider: reads the player's own Trackman account with their own sign-in, on their
 * own device, into olmd/1.
 *
 * Unofficial: this project is not affiliated with, endorsed by or supported by Trackman. Trackman's
 * web API is not a public, documented API; this module asks it what the player's own web portal
 * asks, at a person's pace, through the load guard.
 *
 * `trackman()`   a provider for `sync` (core), with `who` for "Is this you?"
 * `mapping`      Trackman's answers as olmd/1 (the port of spec/reference/trackman.py)
 * `queries`      the queries, next to `client` that sends them
 * `account`      the account a sign-in opens (its `sub`), read without asking anyone
 *
 * The sign-in itself - reading it from the portal, a sign-in window - is the client's business; this
 * module only uses the token it is handed, and sends it to Trackman and nowhere else.
 */

import type { Provider, ProviderContext } from '@glmsync/core';
import { subjectOf } from './account.ts';
import { fetchForPlan, freshState, who, type Who } from './fetch.ts';

export { claims, expiresAt, subjectOf } from './account.ts';
export { GRAPHQL_URL, query } from './client.ts';
export { fetchForPlan, freshState, listActivities, MAX_STROKES_PER_SESSION, SHOTS_OFF_MS, who, type Activity, type TrackmanState, type Who } from './fetch.ts';
export * from './mapping.ts';
export * as queries from './queries.ts';

export const UNOFFICIAL =
  'Unofficial. Golf Launch Monitor Sync is not affiliated with, endorsed by or supported by Trackman. It reads your own account with your own sign-in, the way Trackman’s web portal does.';

export interface TrackmanProvider extends Provider<string> {
  /** "Is this you?" before a first connect: through the guard, like every request. */
  who(ctx: ProviderContext, token: string): Promise<Who>;
}

/** A Trackman provider. Keep one per client: it remembers, in memory, a pause after trouble with the shots of rounds and the history's activity list. */
export function trackman(): TrackmanProvider {
  const state = freshState();
  return {
    id: 'trackman',
    name: 'Trackman',
    notice: UNOFFICIAL,
    subject: (token) => subjectOf(token),
    fetch: (plan, token, ctx) => fetchForPlan(plan, token, ctx, state),
    who,
  };
}
