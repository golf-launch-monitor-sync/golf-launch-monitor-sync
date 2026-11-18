// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The bridge on a paired target's page (spec/page-bridge.md), in the extension's own isolated world. The
 * background puts it only on pages of the origins the player paired with (and allowed at pairing), top frame
 * only. It hands the page's requests on and the background's replies back - nothing else: no key, no token,
 * nothing of the player's but what the reply says.
 */

import { BRIDGE_MARK, BRIDGE_VERSION, bridgeMessage, readBridgeReply, readBridgeRequest, type BridgeReply } from '@glmsync/spec';
import type { Reply } from './messages.ts';

const ORIGIN = window.location.origin;
const own = globalThis as typeof globalThis & { __glmsyncBridge?: boolean };

function post(reply: BridgeReply): void {
  window.postMessage(bridgeMessage(reply), ORIGIN);
}

// Once per page: the background may put it in again (a page open when the player paired).
if (!own.__glmsyncBridge && window.top === window) {
  own.__glmsyncBridge = true;
  const mark = () => document.documentElement?.setAttribute(BRIDGE_MARK, String(BRIDGE_VERSION));
  if (document.documentElement) mark();
  else document.addEventListener('DOMContentLoaded', mark, { once: true });

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const request = readBridgeRequest(event.data);
    if (!request) return;
    chrome.runtime.sendMessage({ type: 'bridge', request: event.data }).then(
      (r: Reply | undefined) => {
        if (r?.ok && r.bridge) post(r.bridge);
      },
      () => undefined, // the extension was updated or turned off meanwhile: the page hears nothing, as without it
    );
  });

  // How a fetch the page started ended (the second reply), from the background.
  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    if (sender.id !== chrome.runtime.id) return false;
    const reply = readBridgeReply((message as { glmsyncBridge?: unknown } | null)?.glmsyncBridge);
    if (reply) post(reply);
    return false;
  });
}
