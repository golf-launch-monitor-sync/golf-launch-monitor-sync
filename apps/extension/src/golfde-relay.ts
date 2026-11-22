// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of golf.de's page (its own isolated world): takes what golfde-main.ts saw on this window and
 * hands it to the background, and shows one small line on the page - what was seen, what is new, and *Send* - but only
 * when an app is connected for the handicap record; otherwise it shows nothing at all. Before the player said the
 * account is theirs it shows no count, only that the connection waits for that, and *Confirm*, which brings the
 * extension's connect window to the front (the yes is given there). The line lives in a shadow
 * root, so golf.de's styles don't reach it (it holds nothing golf.de's page doesn't show itself), and it can be
 * hidden for the page.
 */

import { lineOf, pickLang, translator, type HcpView } from '@glmsync/browser';
import { PAGE_ORIGIN } from '@glmsync/provider-golfde';
import { SEEN_MESSAGE } from '@glmsync/provider-golfde/page';
import type { Reply } from './messages.ts';

const t = translator(pickLang(navigator.languages));
// Which page this is, for the background: results of a page go to the account that page named.
const PAGE = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;

function draw(v: HcpView | undefined): void {
  const line = v ? lineOf(v, t) : null;
  if (!line || hidden) {
    host?.remove();
    host = null;
    return;
  }
  if (!host || !root) {
    host = document.createElement('glmsync-line');
    root = host.attachShadow({ mode: 'open' });
  }
  if (!host.isConnected) (document.body ?? document.documentElement).append(host);
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; max-width: 420px; display: flex; gap: 8px;
      align-items: center; padding: 8px 12px; border-radius: 10px; background: #fff; color: #1d2b1f; font: 13px/1.4 system-ui,
      sans-serif; box-shadow: 0 2px 12px rgba(0,0,0,.18); border-left: 4px solid #1e8449; }
    .box.warn { border-left-color: #c0392b; }
    button { font: inherit; border: 1px solid #1e8449; background: #1e8449; color: #fff; border-radius: 6px; padding: 2px 10px; cursor: pointer; }
    button.plain { background: none; color: #555; border-color: transparent; padding: 2px 4px; }`;
  const box = document.createElement('div');
  box.className = line.warn ? 'box warn' : 'box';
  box.setAttribute('role', 'status');
  box.setAttribute('data-test', 'golfde-line');
  const text = document.createElement('span');
  text.textContent = line.text;
  box.append(text);
  if (line.confirm) {
    // Only the way to the extension's own page: the yes is given there, out of reach of golf.de's scripts.
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = t('line.confirmButton');
    confirm.setAttribute('data-test', 'golfde-confirm');
    confirm.addEventListener('click', () => void ask({ type: 'golfde-confirm' }));
    box.append(confirm);
  }
  if (line.send) {
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = t('line.send');
    send.setAttribute('data-test', 'golfde-send');
    send.addEventListener('click', () => {
      send.disabled = true;
      void ask({ type: 'golfde-send' });
    });
    box.append(send);
  }
  const hide = document.createElement('button');
  hide.type = 'button';
  hide.className = 'plain';
  hide.textContent = '×';
  hide.title = t('line.hide');
  hide.setAttribute('aria-label', t('line.hide'));
  hide.addEventListener('click', () => {
    hidden = true;
    draw(undefined);
  });
  box.append(hide);
  root?.replaceChildren(style, box);
}

async function ask(m: { type: 'golfde-seen'; page: string; seen: unknown } | { type: 'golfde-line' } | { type: 'golfde-send' } | { type: 'golfde-confirm' }): Promise<void> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    if (r?.ok) draw(r.hcp);
  } catch {
    // The extension was updated or reloaded meanwhile: the page goes on without the line.
  }
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== PAGE_ORIGIN) return;
  const data = event.data as { glmsync?: unknown; seen?: unknown } | null;
  if (!data || data.glmsync !== SEEN_MESSAGE || !data.seen || typeof data.seen !== 'object') return;
  void ask({ type: 'golfde-seen', page: PAGE, seen: data.seen });
});

// The line once the page is there (only with a connected app), and again now and then while a send is due.
const start = () => void ask({ type: 'golfde-line' });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
setInterval(() => {
  if (host && !hidden) void ask({ type: 'golfde-line' });
}, 5000);
