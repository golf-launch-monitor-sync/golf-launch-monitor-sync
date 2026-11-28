// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The browser's own update check for *Update now* (update.ts), in Chrome's and Edge's build. Firefox's build takes
 * update-check.firefox.ts instead (build.mjs, `perBrowser`): Firefox hasn't implemented `runtime.requestUpdateCheck`, and
 * Mozilla's linter refuses a bundle that names it.
 */
export function requestUpdateCheck(): { requestUpdateCheck?: () => Promise<unknown> } {
  return typeof chrome.runtime.requestUpdateCheck === 'function' ? { requestUpdateCheck: () => chrome.runtime.requestUpdateCheck() } : {};
}
