// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of the tours whose player page shows the whole season with its rounds (PGA Tour and Korn Ferry
 * Tour on pgatour.com, LPGA Tour on lpga.com, Epson Tour on epsontour.com; spec/prores.md, `@glmsync/provider-tours`
 * `seasonPage`), in its own isolated world. On the player's own *Results* page it shows one small line - only when an
 * app is connected for a pro's pages; otherwise nothing at all - and reads the page only when the player taps *Send*:
 * the season the page shows then (the season he picked), as the site's own scripts built it. Nothing is opened for it,
 * and nothing here asks the site anything.
 *
 * The sites move between their pages without loading them, so the script runs on all of a site and shows the line only
 * while the address is a player's *Results* page. When an app finds another name on the page than the player's, the
 * line offers *Answer*, which only brings the extension's own page to the front. The line lives in a shadow root.
 */

import { pickLang, proLineOf, translator, type LinePhase, type ProView } from '@glmsync/browser';
import { figuresOf, readSeasonPage, seasonSiteOf, seasonTakes, snapshotOf, type TourSite } from '@glmsync/provider-tours';
import type { Reply } from './messages.ts';

const t = translator(pickLang(navigator.languages));
/** How long *Send* waits for the season's table (the site puts it in a moment after the page). */
const TABLE_WAIT_MS = 15_000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;
let phase: LinePhase = 'ready';
let note: string | null = null;
let last: ProView | undefined;
let at: { url: string; site: TourSite | null } = { url: '', site: null };

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function draw(v: ProView | undefined): void {
  if (v) last = v;
  const line = last && at.site ? proLineOf(last, at.site, phase, t) : null;
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
  box.className = line.warn || note ? 'box warn' : 'box';
  box.setAttribute('role', 'status');
  box.setAttribute('data-test', 'season-line');
  const text = document.createElement('span');
  text.textContent = note ?? line.text;
  box.append(text);
  if (line.answer) box.append(button(t('proLine.answer'), 'season-answer', () => void ask({ type: 'season-answer' })));
  if (line.send) box.append(button(t('proLine.send'), 'season-send', () => void sendPage()));
  box.append(button('×', 'season-hide', () => {
    hidden = true;
    draw(undefined);
  }, true));
  root?.replaceChildren(style, box);
}

type Ask = { type: 'season-line' } | { type: 'season-send'; page: object } | { type: 'season-answer' };

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

/** The page as it shows now, its season's table waited for a little; then read, and only his season goes on. */
async function sendPage(): Promise<void> {
  if (!at.site || phase === 'reading') return;
  phase = 'reading';
  note = null;
  draw(undefined);
  const url = location.href;
  const takes = seasonTakes(url);
  const started = Date.now();
  let snap = snapshotOf(document, url, takes.labels);
  while (!snap.tables.some((x) => x.head.some((h) => h.toUpperCase() === 'R1')) && Date.now() - started < TABLE_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snap = snapshotOf(document, url, takes.labels);
  }
  let read;
  try {
    read = readSeasonPage(snap, figuresOf(document, takes.figures), today());
  } catch {
    read = { kind: 'unread' as const, why: 'changed_page' as const };
  }
  if (read.kind === 'unread') {
    // A tour of the site no module reads, or a season with nothing in it yet: said so; a page it doesn't know: the
    // line's own word for it.
    phase = read.why === 'changed_page' ? 'changed_page' : 'ready';
    note = read.why === 'other_tour' ? t('seasonLine.otherTour') : read.why === 'nothing' ? t('seasonLine.nothing') : null;
    draw(undefined);
    return;
  }
  const r = await ask({ type: 'season-send', page: read.page });
  phase = r ? 'done' : 'error';
  draw(undefined);
}

/** Where the player is now: the line follows him between the site's pages (they change without loading). */
function look(): void {
  if (location.href === at.url) return;
  at = { url: location.href, site: seasonSiteOf(location.href) };
  phase = 'ready';
  note = null;
  if (at.site) void ask({ type: 'season-line' });
  else draw(undefined);
}

look();
let ticks = 0;
setInterval(() => {
  try {
    look();
    ticks += 1;
    // Again every few seconds for an answer given meanwhile.
    if (ticks % 5 === 0 && host && !hidden && phase !== 'reading') void ask({ type: 'season-line' });
  } catch {
    // The page goes on without the line.
  }
}, 1000);
