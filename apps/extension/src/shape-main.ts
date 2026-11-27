// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The shape recorder in the portal's own page (world MAIN), put there only while a recording runs on the developer
 * page: reads along with the page's requests and answers and its storage (@glmsync/shape/page) and posts only their
 * shapes on this window, where shape-relay.ts picks them up. It sends the portal nothing and changes nothing the page
 * does; told by the relay that the recording ended, it gives the page its own functions back.
 */

import { watchShapes } from '@glmsync/shape/page';

const STOP = 'glmsync-shape-stop';
const LOOK_MS = 15_000;

try {
  const w = watchShapes(window, (p) => window.postMessage(p, window.location.origin));
  // What the page keeps (where its sign-in lies): when it has loaded, now and then, and when it is left.
  const look = () => w.lookAtStorage();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', look, { once: true });
  else look();
  const timer = setInterval(look, LOOK_MS);
  window.addEventListener('pagehide', look);
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if ((event.data as { glmsync?: unknown } | null)?.glmsync !== STOP) return;
    clearInterval(timer);
    window.removeEventListener('pagehide', look);
    w.stop();
  });
} catch {
  // Never in the page's way: without us, the page is as it was.
}
