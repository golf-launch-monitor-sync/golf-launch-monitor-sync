// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The app's parts, put together from what the platform brings (secure store, storage, the share
 * sheet). The same for the screen and for the background task - each JavaScript runtime makes its
 * own, and the guard's counts in storage (with their in-flight mark) keep them honest together.
 */

import type { HcpClient } from '@glmsync/browser/hcp';
import type { ProClient } from '@glmsync/browser/pro';
import { TourKeeper } from '@glmsync/browser/tours';
import { Guard, HttpTarget, type FetchLike, type FileOut, type Storage } from '@glmsync/core';
import { demo } from '@glmsync/provider-demo';
import { expiresAt, trackman } from '@glmsync/provider-trackman';
import { HcpSender, makeHcp } from './hcp.ts';
import { Pairings } from './pairings.ts';
import { LastPage, makePro } from './pro.ts';
import { Runner, type AppProvider } from './runner.ts';
import { ChunkedSecrets, type Secrets } from './secrets.ts';
import { SignIns } from './signins.ts';
import { MemoryBlobs, Tests, type Blobs } from './tests.ts';
import { Wakes } from './wake.ts';

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
  /** Files of the app's own, for a test scenario (memory when the platform brings none). */
  blobs?: Blobs;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  version?: string;
  /** `ios` or `android`: how the app names itself to a handicap target (and one of a pro's pages). */
  os?: string;
}

export interface Services {
  providers: Record<ProviderId, AppProvider>;
  signIns: SignIns;
  pairings: Pairings;
  /** Test mode's scenarios, per pairing (spec/test-mode.md). */
  tests: Tests;
  guard: Guard;
  runner: Runner;
  /** This phone's push address at each target (the wake, spec/wake.md; iOS only). */
  wakes: Wakes;
  /** The handicap record read along in the golf.de window, and its pairings (spec/hcp.md). */
  hcp: HcpClient;
  /** Sends what the golf.de window saw a little after the last new page. */
  hcpSender: HcpSender;
  /** A pro's own world ranking pages, sent from the app's window on the player's tap, and their pairings (spec/prores.md). */
  pro: ProClient;
  /** What the tour window read of his tour's pages, and its *Fetch all* run (the extension's keeper). */
  tours: TourKeeper;
  /** The player's page last sent from here (a world ranking's or his tour profile): where a window opens next time. */
  lastPage: LastPage;
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
  const tests = new Tests(platform.storage, platform.blobs ?? new MemoryBlobs(), {
    ...(platform.now ? { now: platform.now } : {}),
    ...(platform.sleep ? { sleep: platform.sleep } : {}),
  });
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
    tests,
    ...(platform.fetch ? { fetch: platform.fetch } : {}),
    ...(platform.now ? { now: platform.now } : {}),
    ...(platform.sleep ? { sleep: platform.sleep } : {}),
    ...(platform.writeFile ? { writeFile: platform.writeFile } : {}),
    ...(platform.version ? { version: platform.version } : {}),
  });
  const wakes = new Wakes({
    storage: platform.storage,
    pairings,
    target: (p) => new HttpTarget(p, { ...(platform.fetch ? { fetch: platform.fetch } : {}), ...(platform.now ? { now: platform.now } : {}) }),
    ...(platform.now ? { now: platform.now } : {}),
  });
  const hcp = makeHcp({
    storage: platform.storage,
    secrets,
    ...(platform.os ? { os: platform.os } : {}),
    ...(platform.version ? { version: platform.version } : {}),
    ...(platform.fetch ? { fetch: platform.fetch } : {}),
    ...(platform.now ? { now: platform.now } : {}),
  });
  const pro = makePro({
    storage: platform.storage,
    secrets,
    ...(platform.os ? { os: platform.os } : {}),
    ...(platform.version ? { version: platform.version } : {}),
    ...(platform.fetch ? { fetch: platform.fetch } : {}),
    ...(platform.now ? { now: platform.now } : {}),
  });
  return {
    providers,
    signIns,
    pairings,
    tests,
    guard,
    runner,
    wakes,
    hcp,
    hcpSender: new HcpSender(hcp),
    pro,
    tours: new TourKeeper(platform.storage, platform.now ?? Date.now),
    lastPage: new LastPage(platform.storage),
    async load() {
      await Promise.all([signIns.load(), pairings.load(), runner.loadRuns()]);
      // After the pairings: a test whose pairing went while the app was closed goes too.
      await tests.load();
      for (const m of tests.list()) if (!pairings.get(m.key)) await tests.end(m.key);
    },
  };
}
