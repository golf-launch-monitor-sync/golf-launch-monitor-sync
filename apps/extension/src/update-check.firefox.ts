// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Firefox's build of update-check.ts: no update check of the browser's (Firefox hasn't implemented
 * `runtime.requestUpdateCheck`), so *Update now* opens the signed add-on on the project's site at once (update.ts, `storePage`).
 */
export function requestUpdateCheck(): { requestUpdateCheck?: () => Promise<unknown> } {
  return {};
}
