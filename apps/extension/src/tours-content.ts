// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of the Pro Golf Tour's pages (spec/prores.md; `@glmsync/provider-tours`), in its own isolated
 * world. Only while an app is connected for a pro's pages; otherwise it reads nothing and shows nothing.
 *
 * - On the player's profile it reads his ranking and his season's tournaments, and shows the line with *Send* and
 *   *Fetch all*.
 * - On a tournament's page it takes only his own line of the final result (by the name of the profile read last) and
 *   of the field only its size; the page's other lines never leave this script.
 * - *Fetch all* opens his finished tournaments' pages one by one in this tab, as their links do, with the run's pause;
 *   the run's steps come from the background, only for the tab it started in. What it read goes out once at the end.
 *
 * Nothing here asks the site anything: it reads what the site's own page shows. The line lives in a shadow root.
 */

import { pickLang, proLineOf, translator, type LinePhase, type ProView } from '@glmsync/browser';
import { progolftour, snapshotOf } from '@glmsync/provider-tours';
import type { Reply } from './messages.ts';
import type { TourView } from '@glmsync/browser/tours';

const t = translator(pickLang(navigator.languages));
const SITE = progolftour.SITE;
/** How long a page may take to show its table (the site loads the final result a moment after the page). */
const TABLE_WAIT_MS = 10_000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;
let phase: LinePhase = 'ready';
let pro: ProView | undefined;
let tour: TourView | undefined;
let note: string | null = null;
const onProfile = progolftour.readProfile({ url: location.href, title: '', lines: [], pairs: {}, selected: [], tables: [], links: [] }) !== null;

type Ask =
  | { type: 'tour-seen'; seen: object }
  | { type: 'tour-line' }
  | { type: 'tour-send' }
  | { type: 'tour-fetch-all' }
  | { type: 'tour-step' }
  | { type: 'tour-stop' }
  | { type: 'tour-answer' };

async function ask(m: Ask): Promise<Extract<Reply, { ok: true }> | null> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    if (!r?.ok) return null;
    if (r.pro) pro = r.pro;
    if (r.tour) tour = r.tour;
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
  const running = tour?.run ?? null;
  const line = pro ? proLineOf(pro, SITE, phase, t) : null;
  // On a tournament's page the line shows only while a run goes on; on the profile always (with an app connected).
  if (!line || hidden || (!onProfile && !running)) {
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
  box.setAttribute('data-test', 'tour-line');
  const text = document.createElement('span');
  text.textContent = running ? t('tourLine.running', { done: running.done, total: running.total }) : note ?? line.text;
  box.append(text);
  if (running) box.append(button(t('line.stop'), 'tour-stop', () => void stop()));
  else {
    if (line.answer) box.append(button(t('proLine.answer'), 'tour-answer', () => void ask({ type: 'tour-answer' })));
    if (line.send) box.append(button(t('proLine.send'), 'tour-send', () => void send()));
    // Fetch all stays on the profile after a send: it is how the rounds of the tournaments not yet opened come in.
    if (onProfile && !line.answer && phase !== 'reading') box.append(button(t('line.fetchAll'), 'tour-fetch-all', () => void fetchAll()));
  }
  box.append(button('×', 'tour-hide', () => {
    hidden = true;
    draw();
  }, true));
  root?.replaceChildren(style, box);
}

/** The page as it shows now, its table waited for a little; null when it shows none of what we read. */
async function snapshot(want: (tables: number) => boolean): Promise<ReturnType<typeof snapshotOf>> {
  const started = Date.now();
  let snap = snapshotOf(document, location.href, progolftour.LABELS);
  while (!want(snap.tables.length) && Date.now() - started < TABLE_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snap = snapshotOf(document, location.href, progolftour.LABELS);
  }
  return snap;
}

/** What this page shows of the player, to the background. */
async function look(): Promise<void> {
  try {
    if (onProfile) {
      const p = progolftour.readProfile(await snapshot((n) => n > 0));
      if (p?.kind === 'profile') await ask({ type: 'tour-seen', seen: { profile: p } });
      else if (p?.kind === 'unread') {
        phase = 'changed_page';
        draw();
      }
      return;
    }
    const key = progolftour.resultKey(location.href);
    const who = tour?.who;
    if (!key || !who) return;
    const snap = await snapshot((n) => n > 0);
    const l = progolftour.ownLine(snap, who);
    // Only his line goes (or why there is none); the snapshot with the field's names stays here.
    if (l?.kind === 'result') await ask({ type: 'tour-seen', seen: { key, line: l } });
    else if (l?.kind === 'unread') await ask({ type: 'tour-seen', seen: { key, unread: l.why } });
  } catch {
    // A page whose shape we can't walk: say so on the line, read nothing.
    phase = 'changed_page';
    draw();
  }
}

async function send(): Promise<void> {
  if (phase === 'reading') return;
  phase = 'reading';
  note = null;
  draw();
  await look();
  const r = await ask({ type: 'tour-send' });
  phase = r ? 'done' : 'error';
  draw();
}

async function fetchAll(): Promise<void> {
  note = null;
  await look();
  const r = await ask({ type: 'tour-fetch-all' });
  if (r?.fetch === 'limit') note = t('tourLine.limit');
  draw();
  if (r?.fetch === 'started') await steps();
}

async function stop(): Promise<void> {
  const r = await ask({ type: 'tour-stop' });
  phase = r ? 'done' : 'error';
  draw();
}

/** The run's steps for this tab, one at a time; another tab gets none (then this loop just ends). */
async function steps(): Promise<void> {
  for (;;) {
    const r = await ask({ type: 'tour-step' });
    const step = r?.step;
    if (!step || !('do' in step)) return;
    if (step.do === 'wait') await new Promise((resolve) => setTimeout(resolve, step.ms));
    else if (step.do === 'open' && 'url' in step && progolftour.mayOpen(step.url)) {
      location.assign(step.url);
      return;
    } else {
      phase = 'done';
      draw();
      return;
    }
  }
}

void (async () => {
  await ask({ type: 'tour-line' });
  if (!pro?.pairings.length) return; // no app connected for a pro's pages: read nothing
  await look();
  if (tour?.run) await steps();
})();
