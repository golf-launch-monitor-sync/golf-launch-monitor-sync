// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Saving a file from a page: a download of text, made in the page, sent nowhere. */

export function download(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** The guard's log as a file name of today. */
export function logName(now: number): string {
  return `glmsync-guard-log-${new Date(now).toISOString().slice(0, 10)}.json`;
}
