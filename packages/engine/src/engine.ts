// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The engine, put together from what the platform brings: the secure store (`secrets`), storage, the network
 * (`fetch`), the clock (`now`, `sleep`) and, for a sync into a file, the share sheet. The same for the screen and for a
 * background task - each JavaScript runtime makes its own, and the guard's counts in storage (with their in-flight
 * mark) keep them honest together. The end of a background run's time comes in as the signal of `backgroundWork`
 * (longRun.ts).
 *
 * The companion app makes its services from it (and adds golf.de, the tours, the wake); another app that embeds the
 * engine makes it the same way, with a client of its own to name to its target.
 */

import { Guard, type ClientKind, type FetchLike, type FileOut, type Storage } from '@glmsync/core';
import { expiresAt } from '@glmsync/provider-trackman';
import type { Env } from '@glmsync/spec';
import { BackgroundRuns } from './longRun.ts';
import { Pairings } from './pairings.ts';
import { appProviders, PROVIDERS, type ProviderId } from './providers.ts';
import { Runner, type AppProvider } from './runner.ts';
import { ChunkedSecrets, type Secrets } from './secrets.ts';
import { SignIns } from './signins.ts';
import { MemoryBlobs, Tests, type Blobs } from './tests.ts';

export interface EnginePlatform {
  /** The platform's secure store (Keychain, Keystore): sign-ins and import tokens, nothing else. */
  secrets: Secrets;
  /** Ordinary storage: what a pairing says about its target, the guard's counts, the last runs. */
  storage: Storage;
  /** The share sheet (`Runner.toFile`). */
  writeFile?: (file: FileOut) => Promise<void>;
  /** Files of the app's own, for a test scenario (memory when the platform brings none). */
  blobs?: Blobs;
  /** For targets and providers alike (tests pass their fakes). */
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** The app's version, named to a target with the client and in every batch's generator. */
  version?: string;
  /** How the app names itself to a target when it pairs and with every plan (default: the companion app). */
  client?: { kind: ClientKind; name: string };
  /** The generator every batch names (default: the companion app). */
  generator?: string;
  /**
   * What the phone's system allows the app now (`systemEnv` makes it), told to each target with every plan and status
   * (spec 1.22.0, on a status 1.29.0), so the target app can name the one setting in the way. Waited for a second at
   * most; none, an error or no answer: nothing told.
   */
  env?: () => Env | null | Promise<Env | null>;
}

export interface Engine {
  providers: Record<ProviderId, AppProvider>;
  signIns: SignIns;
  pairings: Pairings;
  /** Test mode's scenarios, per pairing (spec/test-mode.md). */
  tests: Tests;
  guard: Guard;
  runner: Runner;
  /** The last background runs, for the exported log (longRun.ts). */
  background: BackgroundRuns;
  /** Reads what this device keeps; call once before using the rest. */
  load(): Promise<void>;
}

export function makeEngine(platform: EnginePlatform): Engine {
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
  const background = new BackgroundRuns(platform.storage);
  const runner = new Runner({
    background,
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
    ...(platform.client ? { client: platform.client } : {}),
    ...(platform.generator ? { generator: platform.generator } : {}),
    ...(platform.env ? { env: platform.env } : {}),
  });
  return {
    providers,
    signIns,
    pairings,
    tests,
    guard,
    runner,
    background,
    async load() {
      await Promise.all([signIns.load(), pairings.load(), runner.loadRuns()]);
      // After the pairings: a test whose pairing went while the app was closed goes too.
      await tests.load();
      for (const m of tests.list()) if (!pairings.get(m.key)) await tests.end(m.key);
    },
  };
}
