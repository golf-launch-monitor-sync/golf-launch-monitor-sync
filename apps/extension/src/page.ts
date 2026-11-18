// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** What the popup and the connect window share: talking to the background, and the status panel. */

import { pickLang, translator, type ClientStatus, type Lang, type T } from '@glmsync/browser';
import { download, logName } from '@glmsync/browser/download';
import { renderStatus, type Actions } from '@glmsync/browser/render';
import type { FromPage, Reply } from './messages.ts';

export const lang: Lang = pickLang(navigator.languages);
export const t: T = translator(lang);

export async function send(m: FromPage): Promise<Reply> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    return r ?? { ok: false, error: 'no answer' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The page's title and header in the browser's language. */
export function heading(key: Parameters<T>[0]): void {
  document.documentElement.lang = lang;
  document.title = t(key);
  const h1 = document.querySelector('h1');
  if (h1) h1.textContent = t(key);
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = t(el.dataset.t as Parameters<T>[0]);
}

/**
 * The status panel, kept current: it re-reads every few seconds while the page is open. `onStatus` hears
 * every status it shows (the connect window says "done" from it).
 */
export function statusPanel(root: HTMLElement, opts: { onPortal?: () => void; onStatus?: (s: ClientStatus) => void } = {}) {
  const busy = new Set<string>();
  let asking: string | null = null;
  let confirming = false;
  let confirmed = false;
  let last: ClientStatus | null = null;

  const draw = (s: ClientStatus) => {
    last = s;
    // "Connected, the data is on its way" while the first sync after the yes runs.
    if (confirmed && s.key.state === 'ready' && !s.running.length && s.pairings.some((p) => p.last)) confirmed = false;
    renderStatus(root, s, { t, lang, now: Date.now(), busy, client: 'extension', asking, confirming, confirmed }, actions);
    opts.onStatus?.(s);
  };
  const refresh = async (got?: Reply) => {
    const r = got ?? (await send({ type: 'status' }));
    if (r.ok && r.status) draw(r.status);
  };
  const actions: Actions = {
    confirm: (yes) => {
      // The answer may take a moment (the extension saves it, then starts the first sync): say so at once.
      confirming = true;
      if (last) draw(last);
      void send({ type: 'confirm', yes }).then(async (r) => {
        confirming = false;
        confirmed = yes && r.ok && r.status?.key.state === 'ready';
        await refresh(r);
        if (!r.ok && last) draw(last);
      });
    },
    retryWho: () => void send({ type: 'retry-who' }).then(refresh),
    fetchNow: (id) => {
      busy.add(id);
      if (last) draw(last);
      void send({ type: 'run', id }).then(async (r) => {
        busy.delete(id);
        await refresh(r);
      });
    },
    askDisconnect: (id) => {
      asking = id;
      if (last) draw(last);
    },
    disconnect: (id) => {
      asking = null;
      void send({ type: 'unpair', id }).then(refresh);
    },
    exportLog: () =>
      void send({ type: 'export-log' }).then((r) => {
        if (r.ok && r.log) download(logName(Date.now()), `${JSON.stringify(r.log, null, 2)}\n`);
      }),
    clearEnded: () => void send({ type: 'clear-ended' }).then(refresh),
    forgetKey: () => void send({ type: 'forget-key' }).then(refresh),
    openPortal: () => {
      void send({ type: 'open-portal' });
      opts.onPortal?.();
    },
    switchAccount: () => {
      void send({ type: 'switch-account' });
      opts.onPortal?.();
    },
  };
  void refresh();
  const timer = setInterval(() => void refresh(), 3000);
  return { refresh, stop: () => clearInterval(timer) };
}
