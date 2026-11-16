// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The app's parts, put together from what the platform brings (secure store, storage, the share
 * sheet). The same for the screen and for the background task - each JavaScript runtime makes its
 * own, and the guard's counts in storage (with their in-flight mark) keep them honest together.
 */

import { Guard, type FetchLike, type FileOut, type Storage } from '@glmsync/core';
import { demo } from '@glmsync/provider-demo';
import { expiresAt, trackman } from '@glmsync/provider-trackman';
import { Pairings } from './pairings.ts';
import { Runner, type AppProvider } from './runner.ts';
import { ChunkedSecrets, type Secrets } from './secrets.ts';
import { SignIns } from './signins.ts';

/** The providers this app offers, in the order shown: Trackman first, the demo for trying it out. */
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

export interface Platform {
  secrets: Secrets;
  storage: Storage;
  writeFile?: (file: FileOut) => Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  version?: string;
}

export interface Services {
  providers: Record<ProviderId, AppProvider>;
  signIns: SignIns;
  pairings: Pairings;
  guard: Guard;
  runner: Runner;
  /** Reads what this phone keeps; call once before using the rest. */
  load(): Promise<void>;
}

export function makeServices(platform: Platform): Services {
  const secrets = new ChunkedSecrets(platform.secrets);
  const providers = appProviders();
  const signIns = new SignIns(
    secrets,
    {
      subject: (p, token) => providers[p as ProviderId]?.subject(token) ?? null,
      expiresAt: (p, token) => (p === 'trackman' ? expiresAt(token) : null),
    },
    PROVIDERS,
    platform.now ? { now: platform.now } : {},
  );
  const pairings = new Pairings(secrets, platform.storage);
  const guard = new Guard({
    storage: platform.storage,
    ...(platform.now ? { now: platform.now } : {}),
    ...(platform.sleep ? { sleep: platform.sleep } : {}),
  });
  const runner = new Runner({
    pairings,
    signIns,
    guard,
    storage: platform.storage,
    providers,
    ...(platform.fetch ? { fetch: platform.fetch } : {}),
    ...(platform.now ? { now: platform.now } : {}),
    ...(platform.sleep ? { sleep: platform.sleep } : {}),
    ...(platform.writeFile ? { writeFile: platform.writeFile } : {}),
    ...(platform.version ? { version: platform.version } : {}),
  });
  return {
    providers,
    signIns,
    pairings,
    guard,
    runner,
    async load() {
      await Promise.all([signIns.load(), pairings.load(), runner.loadRuns()]);
    },
  };
}
