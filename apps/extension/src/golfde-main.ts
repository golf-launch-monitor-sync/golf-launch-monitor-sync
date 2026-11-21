// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Runs in golf.de's own page (world MAIN), before golf.de's scripts: reads along with the answers golf.de's page
 * receives for the player's handicap record (@glmsync/provider-golfde/page) and posts what it made of them - no names,
 * no numbers - on this window, where golfde-relay.ts picks it up. It sends golf.de nothing, and changes nothing the
 * page does.
 */

import { SEEN_MESSAGE, watchPage } from '@glmsync/provider-golfde/page';

watchPage(window, (seen) => {
  try {
    window.postMessage({ glmsync: SEEN_MESSAGE, seen }, window.location.origin);
  } catch {
    // never in the page's way
  }
});
