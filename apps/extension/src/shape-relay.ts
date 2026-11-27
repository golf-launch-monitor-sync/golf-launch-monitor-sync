// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The shape recorder's side of the portal's page (the extension's isolated world): takes the shapes shape-main.ts
 * posted on this window and hands them to the background, which reads them again strictly and keeps them only while a
 * recording of this portal runs. Once it says none runs, the page script is told to stop reading along, and so is this.
 */

import { SEEN_MESSAGE } from '@glmsync/shape/page';
import type { Reply } from './messages.ts';

const STOP = 'glmsync-shape-stop';
let done = false;

function stop(): void {
  if (done) return;
  done = true;
  window.removeEventListener('message', onMessage);
  try {
    window.postMessage({ glmsync: STOP }, window.location.origin);
  } catch {
    // the page is going anyway
  }
}

function onMessage(event: MessageEvent): void {
  if (done || event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data as { glmsync?: unknown; seen?: unknown; personal?: unknown; ids?: unknown } | null;
  if (!data || data.glmsync !== SEEN_MESSAGE) return;
  chrome.runtime
    .sendMessage({ type: 'shape-seen', seen: data.seen, personal: data.personal, ids: data.ids })
    .then((r: Reply | undefined) => {
      if (r && r.ok && r.recording === false) stop();
    })
    // The extension was reloaded or removed: nothing to hand on to any more.
    .catch(() => stop());
}

window.addEventListener('message', onMessage);
