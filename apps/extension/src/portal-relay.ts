// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of the portal tab (its own isolated world): takes the key portal-main.ts
 * found and hands it to the background, which checks it (a token of Trackman's that hasn't run out)
 * and keeps it in the extension's own storage. Only messages from this very window are heard.
 */

import { PORTAL_ORIGIN } from '@glmsync/provider-trackman/portal';

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== PORTAL_ORIGIN) return;
  const data = event.data as { glmsync?: unknown; token?: unknown } | null;
  if (!data || data.glmsync !== 'portal-key' || typeof data.token !== 'string') return;
  chrome.runtime.sendMessage({ type: 'portal-key', token: data.token }).catch(() => undefined);
});
