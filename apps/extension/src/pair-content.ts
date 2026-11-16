// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * On the web app's pairing page: marks the page so it knows the extension is here, hands the
 * pairing fragment (target and code, never sent to a server by the browser) to the background, and
 * tells the page how it went - which app it is now connected with, never the code.
 */

import type { PairPageState, Pending, Reply } from './messages.ts';

declare const __VERSION__: string;

const ORIGIN = window.location.origin;
const MARK = 'data-glmsync-extension';

function tell(state: PairPageState): void {
  window.postMessage({ glmsyncExtension: state }, ORIGIN);
}

function toPage(p: Pending | null | undefined): PairPageState {
  if (!p) return { state: 'gone' };
  const out: PairPageState = { state: p.state };
  if (p.name) out.name = p.name;
  if (p.error) out.error = p.error;
  return out;
}

async function main(): Promise<void> {
  // Run once per page, also when put in again after installing.
  if (document.documentElement.hasAttribute(MARK)) return;
  document.documentElement.setAttribute(MARK, __VERSION__);
  const fragment = window.location.hash;
  if (!fragment || fragment.length < 2) return;
  const offered = (await chrome.runtime.sendMessage({ type: 'pair-offer', fragment })) as Reply | undefined;
  if (!offered?.ok) {
    for (let i = 0; i < 5; i++) {
      tell({ state: 'failed', error: offered && !offered.ok ? offered.error : 'link' });
      await new Promise((done) => setTimeout(done, 1000));
    }
    return;
  }
  // The page's own script may start listening only after this one: say the state every second.
  let after = 0;
  for (let i = 0; i < 900 && after < 3; i++) {
    const r = (await chrome.runtime.sendMessage({ type: 'pair-status' }).catch(() => null)) as Reply | null;
    const s = toPage(r?.ok ? r.pending : null);
    tell(s);
    if (s.state === 'paired' || s.state === 'failed' || s.state === 'cancelled' || s.state === 'gone') after += 1;
    await new Promise((done) => setTimeout(done, 1000));
  }
}

void main();
