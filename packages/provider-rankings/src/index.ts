// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The world rankings, read on the player's own page (spec/prores.md): OWGR for men, the Rolex Women's World Golf
 * Rankings for women. The player opens their page and taps *Send*; this module reads what the page shows and makes one
 * prores/1 batch of it. It sends the sites nothing of its own.
 *
 * - `sites`  which pages (a player's own, by its address), and where the player finds theirs
 * - `read`   the page as it is shown: the head's figures, the table of tournaments
 * - `batch`  one prores/1 batch of a page
 */

export * from './sites.ts';
export * from './read.ts';
export * from './batch.ts';
