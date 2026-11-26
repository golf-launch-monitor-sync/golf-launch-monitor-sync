// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of the Alps Tour's site (spec/prores.md; `alps` of `@glmsync/provider-tours`), in its own
 * isolated world. Only while an app is connected for a pro's pages; otherwise it reads nothing and shows nothing.
 *
 * - On his profile it reads the report the page shows (*This Season record*, *Results*, *Order of Merit*) and hands it
 *   to the background, which keeps them merged; when he picks another report in the page's own select, it reads again a
 *   moment later. The line says which report to pick while his rounds weren't read.
 * - *Send* sends what was read to the apps connected for it.
 *
 * The site is one app that changes its address without loading a page, so the script runs on every page of it and
 * looks again whenever the address changes. Nothing here asks the site anything: it reads the document the site's own
 * scripts built. The line lives in a shadow root.
 */

import { pickLang, proLineOf, translator, type LinePhase, type ProView } from '@glmsync/browser';
import { alpsNote, type AlpsView } from '@glmsync/browser/alps';
import { alps, type Snapshot } from '@glmsync/provider-tours';
import type { Reply } from './messages.ts';

const t = translator(pickLang(navigator.languages));
/** How long his profile may take to show its report (the site draws it a moment after the page). */
const TABLE_WAIT_MS = 15_000;
/** After a pick in the page's select, the site needs a moment to show the new report. */
const AFTER_PICK_MS = 1500;
/** How often the address is looked at (the site changes it without loading a page). */
const WATCH_MS = 1_000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;
let phase: LinePhase = 'ready';
let pro: ProView | undefined;
let view: AlpsView | undefined;
let here = location.href;

type Ask = { type: 'alps-seen'; read: object } | { type: 'alps-line' } | { type: 'alps-send' } | { type: 'alps-answer' };

async function ask(m: Ask): Promise<Extract<Reply, { ok: true }> | null> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    if (!r?.ok) return null;
    if (r.pro) pro = r.pro;
    if (r.alps) view = r.alps;
    draw();
    return r;
  } catch {
    // The extension was updated or reloaded meanwhile: the page goes on without the line.
    return null;
  }
}

function button(text: string, test: string, act: () => void, plain = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (plain) b.className = 'plain';
  b.setAttribute('data-test', test);
  b.addEventListener('click', act);
  return b;
}

function draw(): void {
  const line = pro ? proLineOf(pro, alps.SITE, phase, t) : null;
  // Only on his profile, with an app connected.
  if (!line || hidden || !alps.profileIdOf(location.href)) {
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
  box.setAttribute('data-test', 'alps-line');
  const text = document.createElement('span');
  // Before a send, the line says which report to pick, or what was read; a question, a warning or an outcome speaks for itself.
  text.textContent = phase === 'ready' && !line.warn && !line.answer && view ? alpsNote(view, t) : line.text;
  box.append(text);
  if (line.answer) box.append(button(t('proLine.answer'), 'alps-answer', () => void ask({ type: 'alps-answer' })));
  if (line.send && phase !== 'reading') box.append(button(t('proLine.send'), 'alps-send', () => void send()));
  box.append(button('×', 'alps-hide', () => {
    hidden = true;
    draw();
  }, true));
  root?.replaceChildren(style, box);
}

/** His profile as it shows now, waited for a little until it shows his name and a report. */
async function snapshot(): Promise<Snapshot> {
  const started = Date.now();
  let snap = alps.snapshotAt(document, location.href);
  while (!alps.shows(snap) && Date.now() - started < TABLE_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snap = alps.snapshotAt(document, location.href);
  }
  return snap;
}

/** What the report shown now says of him, to the background. False when there was nothing to read. */
async function look(): Promise<boolean> {
  const url = location.href;
  if (!alps.profileIdOf(url)) return false;
  try {
    const r = alps.readPage(await snapshot());
    if (location.href !== url) return false; // he went on meanwhile: that page reads itself
    if (r?.kind === 'alps') {
      if (phase === 'changed_page') phase = 'ready';
      return (await ask({ type: 'alps-seen', read: r })) !== null;
    }
    if (r?.kind === 'unread') {
      phase = 'changed_page';
      draw();
    }
    return false;
  } catch {
    // A page whose shape we can't walk: say so on the line, read nothing.
    phase = 'changed_page';
    draw();
    return false;
  }
}

async function send(): Promise<void> {
  if (phase === 'reading') return;
  phase = 'reading';
  draw();
  if (!(await look())) {
    if (phase === 'reading') phase = 'ready';
    draw();
    return;
  }
  const r = await ask({ type: 'alps-send' });
  phase = r ? 'done' : 'error';
  draw();
}

void (async () => {
  await ask({ type: 'alps-line' });
  if (!pro?.pairings.length) return; // no app connected for a pro's pages: read nothing
  await look();
  // Another report picked in the page's own select: what it shows next is read too, and *Send* is offered again.
  document.addEventListener('change', (e) => {
    if (!(e.target instanceof HTMLSelectElement) || !alps.profileIdOf(location.href)) return;
    setTimeout(() => {
      void look().then((ok) => {
        if (ok && phase === 'done') {
          phase = 'ready';
          draw();
        }
      });
    }, AFTER_PICK_MS);
  });
  // The site changes its address without loading a page: a profile opened so is looked at again.
  setInterval(() => {
    if (location.href === here) return;
    here = location.href;
    phase = 'ready';
    hidden = false;
    draw();
    void look();
  }, WATCH_MS);
})();
