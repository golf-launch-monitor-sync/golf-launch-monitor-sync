// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of a player's own page of a world ranking (OWGR, Rolex Rankings; spec/prores.md), in its own
 * isolated world. It shows one small line - but only when an app is connected for a pro's pages; otherwise nothing at
 * all - and reads the page only when the player taps *Send* there: what the page shows, as the site's own scripts built
 * it (OWGR's table comes a moment after the page, so it waits for it a little). Nothing here asks the site anything.
 *
 * When an app finds another name on the page than the player's, the line says so and offers *Answer*, which only brings
 * the extension's own page to the front: the answer is given there, out of reach of the site's scripts. The line lives
 * in a shadow root, so the site's styles don't reach it, and it can be hidden for the page.
 */

import { pickLang, proLineOf, translator, type LinePhase, type ProView } from '@glmsync/browser';
import { hasTable, playerPageOf, readPage } from '@glmsync/provider-rankings';
import type { Reply } from './messages.ts';

const t = translator(pickLang(navigator.languages));
const at = playerPageOf(location.href);
/** How long *Send* waits for the page's table of tournaments before it sends the ranking alone. */
const TABLE_WAIT_MS = 15_000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;
let phase: LinePhase = 'ready';
let last: ProView | undefined;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function draw(v: ProView | undefined): void {
  if (v) last = v;
  const line = last && at ? proLineOf(last, at.site, phase, t) : null;
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
  box.setAttribute('data-test', 'ranking-line');
  const text = document.createElement('span');
  text.textContent = line.text;
  box.append(text);
  if (line.answer) {
    const answer = document.createElement('button');
    answer.type = 'button';
    answer.textContent = t('proLine.answer');
    answer.setAttribute('data-test', 'ranking-answer');
    answer.addEventListener('click', () => void ask({ type: 'ranking-answer' }));
    box.append(answer);
  }
  if (line.send) {
    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = t('proLine.send');
    send.setAttribute('data-test', 'ranking-send');
    send.addEventListener('click', () => void sendPage());
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

type Ask = { type: 'ranking-line'; site: 'owgr' | 'rolex' } | { type: 'ranking-send'; page: object } | { type: 'ranking-answer' };

async function ask(m: Ask): Promise<Extract<Reply, { ok: true }> | null> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    if (!r?.ok) return null;
    draw(r.pro);
    return r;
  } catch {
    // The extension was updated or reloaded meanwhile: the page goes on without the line.
    return null;
  }
}

/** *Send*: the page as it shows now (its table waited for a little), then to the background. */
async function sendPage(): Promise<void> {
  if (!at || phase === 'reading') return;
  phase = 'reading';
  draw(undefined);
  const started = Date.now();
  while (!hasTable(document) && Date.now() - started < TABLE_WAIT_MS) await new Promise((resolve) => setTimeout(resolve, 500));
  let read;
  try {
    read = readPage(document, location.href, document.title, today());
  } catch {
    read = { ok: false as const, why: 'changed_page' as const };
  }
  if (!read.ok) {
    phase = 'changed_page';
    draw(undefined);
    return;
  }
  const r = await ask({ type: 'ranking-send', page: read.page });
  phase = r ? 'done' : 'error';
  draw(undefined);
}

// The line once the page is there (only with a connected app), and again now and then for an answer given meanwhile.
if (at) {
  const site = at.site;
  void ask({ type: 'ranking-line', site });
  setInterval(() => {
    if (host && !hidden && phase !== 'reading') void ask({ type: 'ranking-line', site });
  }, 5000);
}
