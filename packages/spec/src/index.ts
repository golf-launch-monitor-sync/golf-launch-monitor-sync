// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The spec (spec/ at the repository's root) for TypeScript: the olmd/1 types and schema check,
 * the load guard's limits, the reference planning rules, the deep links, the client's sign-in, the
 * extension's bridge on a target's page, a target's test scenarios, the wake, (1.15.0) a professional's pages and (1.22.0) the question and the answer, (1.23.0) a first sync's reach. The JSON files under
 * spec/ are the authority; this package only reads them.
 */

import limits from '../../../spec/guard/limits.json' with { type: 'json' };
import rules from '../../../spec/plan/rules.json' with { type: 'json' };
import clicks from '../../../spec/hcp/clicks.json' with { type: 'json' };

export * from './olmd.ts';
export * from './validate.ts';
export * from './deepLinks.ts';
export * from './accountRef.ts';
export * from './bridge.ts';
export * from './testMode.ts';
export * from './wake.ts';
export * from './ask.ts';
export * from './prores.ts';
export * from './plan.ts';

/** The load guard's limits (spec/guard.md). Normative. */
export const GUARD_LIMITS = limits;
/** The reference planning rules of a target (spec/planning.md). */
export const PLAN_RULES = rules;
/** How a client clicks for the player on a page it otherwise only observes (spec/hcp.md). Normative. */
export const HCP_CLICKS = Object.freeze({ ...clicks, pause_ms: Object.freeze([...clicks.pause_ms]) as readonly number[] });
