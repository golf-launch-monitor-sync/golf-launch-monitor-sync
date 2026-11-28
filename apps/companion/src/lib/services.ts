// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The app's parts, put together from what the platform brings (secure store, storage, the share
 * sheet). The same for the screen and for the background task - each JavaScript runtime makes its
 * own, and the guard's counts in storage (with their in-flight mark) keep them honest together.
 */

import type { HcpClient } from '@glmsync/browser/hcp';
import type { ProClient } from '@glmsync/browser/pro';
import { AlpsKeeper } from '@glmsync/browser/alps';
import { EtKeeper } from '@glmsync/browser/europeantour';
import { OcsKeeper } from '@glmsync/browser/ocs';
import { RunKeeper } from '@glmsync/browser/runs';
import { SeasonKeeper } from '@glmsync/browser/season';
import { TourKeeper } from '@glmsync/browser/tours';
import { HttpTarget } from '@glmsync/core';
import { ChunkedSecrets, makeEngine, type Engine, type EnginePlatform } from '@glmsync/engine';
import { AutoFetch } from './autoFetch.ts';
import { HcpSender, makeHcp } from './hcp.ts';
import { LastPage, makePro } from './pro.ts';
import { TestSignIns } from './testSignIns.ts';
import { Wakes } from './wake.ts';

// What fetches from a launch monitor's cloud is the engine's (packages/engine): this app runs it as before.
export { appProviders, DEMO_CREDENTIAL, PROVIDERS, type ProviderId } from '@glmsync/engine';

export interface Platform extends Omit<EnginePlatform, 'client' | 'generator'> {
  /** `ios` or `android`: how the app names itself to a handicap target (and one of a pro's pages). */
  os?: string;
}

export interface Services extends Omit<Engine, 'load'> {
  /** This phone's push address at each target (the wake, spec/wake.md; iOS only). */
  wakes: Wakes;
  /** The handicap record read along in the golf.de window, and its pairings (spec/hcp.md). */
  hcp: HcpClient;
  /** Sends what the golf.de window saw a little after the last new page. */
  hcpSender: HcpSender;
  /** *Fetch all* by itself while the app is open, in the window nobody sees (spec 1.17.0; the frame shows it by its state). */
  auto: AutoFetch;
  /** A pro's own world ranking pages, sent from the app's window on the player's tap, and their pairings (spec/prores.md). */
  pro: ProClient;
  /** What the tour window read of his tour's pages, and its *Fetch all* run (the extension's keeper). */
  tours: TourKeeper;
  /** What the tour window read of his pages on europeantour.com (the extension's keeper), merged. */
  et: EtKeeper;
  /** What the tour window read of her pages on the LET and the LET Access Series (the extension's keeper): per tour her profile and her rank. */
  ocs: OcsKeeper;
  /** What the tour window read of his profile on the Alps Tour (the extension's keeper): the reports he picked there, merged. */
  alps: AlpsKeeper;
  /**
   * *Fetch all* on the tours whose pages show a part at a time (the Alps Tour, europeantour.com, the LET's, the season
   * pages; the extension's keeper): the run going on in the tour window and each tour's runs today.
   */
  runs: RunKeeper;
  /** The season pages a run of *Fetch all* read, kept merged per tour until it ends (the extension's keeper). */
  seasonPages: SeasonKeeper;
  /** The player's page last sent from here (a world ranking's, a tour profile or his page on europeantour.com): where a window opens next time. */
  lastPage: LastPage;
  /** Test sign-ins kept for apps that only ask this one to sign in (spec 1.28.0), per pairing. */
  testSignIns: TestSignIns;
  /** Reads what this phone keeps; call once before using the rest. */
  load(): Promise<void>;
}

export function makeServices(platform: Platform): Services {
  // The engine names the companion app to its targets, as before (no `client`, no `generator`).
  const engine = makeEngine(platform);
  const { pairings } = engine;
  // golf.de's and the pros' pairings keep their tokens in the same secure store, cut the same way.
  const secrets = new ChunkedSecrets(platform.secrets);
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
  const testSignIns = new TestSignIns(secrets, platform.storage, platform.now ? { now: platform.now } : {});
  // A test sign-in lasts only as long as its pairing (disconnected here, or ended by the app).
  pairings.subscribe(() => {
    const keys = new Set(pairings.list().map((p) => p.key));
    for (const key of testSignIns.keys()) if (!keys.has(key)) void testSignIns.forget(key);
  });
  return {
    providers: engine.providers,
    signIns: engine.signIns,
    pairings,
    tests: engine.tests,
    guard: engine.guard,
    runner: engine.runner,
    background: engine.background,
    wakes,
    hcp,
    hcpSender: new HcpSender(hcp),
    auto: new AutoFetch({ hcp }),
    pro,
    tours: new TourKeeper(platform.storage, platform.now ?? Date.now),
    et: new EtKeeper(platform.storage),
    ocs: new OcsKeeper(platform.storage),
    alps: new AlpsKeeper(platform.storage),
    runs: new RunKeeper(platform.storage, platform.now ?? Date.now),
    seasonPages: new SeasonKeeper(platform.storage),
    lastPage: new LastPage(platform.storage),
    testSignIns,
    load: async () => {
      await engine.load();
      // After the pairings: a test sign-in whose pairing went while the app was closed goes too.
      await testSignIns.load(pairings.list().map((p) => p.key));
    },
  };
}
