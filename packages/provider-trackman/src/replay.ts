// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Playing a target's test scenario back (spec/test-mode.md): the real Trackman provider - listing, history chunks,
 * the mapping to olmd, every request through the guard at the plan's pace - with the made-up Trackman (testing.ts)
 * answering in Trackman's place, from the scenario's data and at the scenario's response times. Nothing is ever
 * asked of Trackman: the provider's requests go to the fake, whatever `fetch` the client runs with.
 *
 * The account is the scenario's `subject`: its sign-in is a made-up token carrying it, so `account_ref` and the
 * guard's count are the subject's (each code a fresh guard). Every batch says `test: true` (core's `sync`).
 */

import { withFetch, type ProviderContext } from '@glmsync/core';
import type { TestScenario } from '@glmsync/spec';
import { subjectOf } from './account.ts';
import { fetchForPlan, freshState, who } from './fetch.ts';
import type { TrackmanProvider } from './index.ts';
import { latencyOf, sampleMs } from './latency.ts';
import { FakeTrackman, fakeToken } from './testing.ts';

/** In a test, the made-up data says so wherever the provider is named. */
export const TEST_NOTICE = 'Test mode: made-up data from a test scenario of the connected app. Nothing here comes from Trackman.';

/** How many of the fake's requests are kept for looking at (it runs for days inside an app). */
const KEEP_REQUESTS = 1000;

export interface ReplayOptions {
  /** ms since the epoch (the fake's record of each request). */
  now?: () => number;
  /** How the response times are waited for (tests pass a virtual clock's). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** In [0, 1): where each response time falls around its median. */
  random?: () => number;
}

export interface Replay extends TrackmanProvider {
  readonly test: true;
  /** The made-up sign-in to hand to `sync` and `who`: a token whose `sub` is the scenario's subject. */
  readonly credential: string;
  readonly scenario: TestScenario;
  /** The made-up Trackman answering (its `requests` for looking at). */
  readonly fake: FakeTrackman;
}

/** The scenario isn't one of Trackman's: a client refuses a provider it doesn't have (spec/test-mode.md). */
export class NotTrackmanScenario extends Error {
  override name = 'NotTrackmanScenario';
}

/**
 * A provider that plays `scenario` back as Trackman would answer. Keep one per scenario, as with `trackman()`: it
 * remembers the history's activity list between chunks. Throws `NotTrackmanScenario` for another provider's scenario.
 */
export function replay(scenario: TestScenario, opts: ReplayOptions = {}): Replay {
  if (scenario.provider !== 'trackman') throw new NotTrackmanScenario(`Not a Trackman scenario: ${scenario.provider}`);
  const fake = new FakeTrackman(opts.now).load(scenario.data);
  fake.profile = scenario.profile;
  fake.keep = KEEP_REQUESTS;
  const credential = fakeToken(scenario.subject);
  fake.tokens.add(credential);
  const random = opts.random ?? Math.random;
  fake.delay = (req) => sampleMs(latencyOf(scenario.latency, req.name), random);
  if (opts.sleep) fake.sleep = opts.sleep;
  // What `trackman()` runs, with its own memory between chunks; only the requests go to the fake.
  const state = freshState();
  const via = (ctx: ProviderContext) => withFetch(ctx, fake.fetch);
  return {
    id: 'trackman',
    name: 'Trackman',
    notice: TEST_NOTICE,
    test: true,
    can: ['older_rounds', 'sessions_again'],
    credential,
    scenario,
    fake,
    subject: (token) => subjectOf(token),
    fetch: (plan, token, ctx) => fetchForPlan(plan, token, via(ctx), state),
    who: (ctx, token) => who(via(ctx), token),
  };
}
