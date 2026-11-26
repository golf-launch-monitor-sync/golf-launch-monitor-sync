// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * golf.de, read along (spec/hcp.md, *A client that only observes*): the player opens golf.de's pages in their own
 * browser, and the page script (`@glmsync/provider-golfde/page`) reads what golf.de's page loaded there.
 *
 * - `mapping`  golf.de's entries as dgvhcp/1 results, by a whitelist (names and numbers never copied)
 * - `observe`  which answers the page script looks at, what it makes of them, and reading that again outside the page
 * - `batch`    dgvhcp/1 batches of what was seen, cut to a target's limits
 * - `clicks`   *Fetch all*: the clicks a run makes for the player on golf.de's own page, and when
 * - `operate`  taking such a step in the page
 * - `event`    one tournament from the page the player has open (dgvevent/1, spec 1.19.0), on their tap
 */

export * from './batch.ts';
export * from './mapping.ts';
export * from './observe.ts';
export * from './clicks.ts';
export * from './operate.ts';
export * from './event.ts';
