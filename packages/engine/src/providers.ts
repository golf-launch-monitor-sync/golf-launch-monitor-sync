// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The providers the engine fetches from: Trackman, and the demo for trying it out. golf.de, the tours and the rankings
 * are read along in a window the player sees (the companion app's), never by the engine.
 */

import { demo } from '@glmsync/provider-demo';
import { trackman } from '@glmsync/provider-trackman';
import type { AppProvider } from './runner.ts';

/** In the order shown: Trackman first, the demo for trying it out. */
export const PROVIDERS = ['trackman', 'demo'] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** The demo's "sign-in": one made-up player (spec: any text is an account of its own). */
export const DEMO_CREDENTIAL = 'player';

export function appProviders(): Record<ProviderId, AppProvider> {
  const d = demo();
  return {
    trackman: trackman(),
    demo: { id: d.id, name: d.name, ...(d.notice ? { notice: d.notice } : {}), subject: d.subject, fetch: d.fetch, who: (ctx) => d.who(ctx) },
  };
}
