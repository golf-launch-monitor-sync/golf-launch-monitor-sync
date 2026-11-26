// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A tournament's page of golf.de's calendar (spec/hcp.md, *Taking one tournament*, 1.19.0): by its heading a button
 * per connected app, *Add to …*; one tap reads that page's lines under *Turnierinformationen* and sends that one
 * tournament to that app (through the background, which reads it again). Nothing without the tap, nothing on the list
 * or a result list, nothing in a tab a run of *Fetch all* opened (the background answers there with no app at all).
 * It reads only what the page shows and asks golf.de nothing; the registration box beside the lines is never read.
 *
 * golf.de's calendar is one page that changes its address without loading (`#/<number>`) and fills in a tournament's
 * lines a moment later, so the script looks every second whether it is on a tournament's page. The button shows once
 * the lines are there, or a few seconds after the address became a tournament's even when they aren't (golf.de may
 * have changed its page: the tap then says it can't read it, and nothing is sent). It lives in a shadow root, so
 * golf.de's styles don't reach it.
 */

import { eventText, pickLang, translator, type TakeOutcome } from '@glmsync/browser';
import { eventOnPage, eventPageOf, offerEvent, type PageDoc } from '@glmsync/provider-golfde/event';
import type { Reply } from './messages.ts';

const t = translator(pickLang(navigator.languages));
const LOOK_MS = 1000;

type Target = { id: string; name: string };
type Ask = { type: 'golfde-event-line' } | { type: 'golfde-event-take'; target: string; event: unknown };

async function ask(m: Ask): Promise<Extract<Reply, { ok: true }> | null> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    return r?.ok ? r : null;
  } catch {
    // The extension was updated or reloaded meanwhile: the page goes on without the button.
    return null;
  }
}

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let targets: Target[] = [];
/** The tournament the button is for, since when, and what its last tap said. */
let shownFor: string | null = null;
let since = 0;
let said: { text: string; warn: boolean } | null = null;
let busy: string | null = null;

const doc = () => document as unknown as PageDoc;

function remove(): void {
  drawn = '';
  host?.remove();
  host = null;
  root = null;
}

/** What the button shows: drawn again only when it changes (a button drawn anew every second would flicker). */
let drawn = '';

function draw(heading: Element | null): void {
  const now = JSON.stringify([targets, busy, said, !heading]);
  const placed = host?.isConnected && (heading ? host.previousElementSibling === heading : true);
  if (placed && now === drawn) return;
  drawn = now;
  if (!host || !root) {
    host = document.createElement('glmsync-event');
    root = host.attachShadow({ mode: 'open' });
  }
  // By the heading where golf.de has one; else in a corner of its own.
  if (heading && host.previousElementSibling !== heading) heading.after(host);
  else if (!heading && !host.isConnected) (document.body ?? document.documentElement).append(host);
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; display: block; margin: 8px 0 12px; }
    :host(.corner) { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; margin: 0; }
    .box { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font: 14px/1.4 system-ui, sans-serif; color: #1d2b1f; }
    button { font: inherit; border: 1px solid #1e8449; background: #1e8449; color: #fff; border-radius: 6px; padding: 4px 12px; cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    .said { padding: 2px 8px; border-left: 3px solid #1e8449; background: #fff; border-radius: 4px; }
    .said.warn { border-left-color: #c0392b; }`;
  host.classList.toggle('corner', !heading);
  const box = document.createElement('div');
  box.className = 'box';
  box.setAttribute('data-test', 'golfde-event');
  for (const target of targets) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = busy === target.id ? t('event.taking', { name: target.name }) : t('event.take', { name: target.name });
    button.disabled = busy !== null;
    button.setAttribute('data-test', 'golfde-event-take');
    button.addEventListener('click', () => void take(target));
    box.append(button);
  }
  if (said) {
    const line = document.createElement('span');
    line.className = said.warn ? 'said warn' : 'said';
    line.setAttribute('role', 'status');
    line.setAttribute('data-test', 'golfde-event-said');
    line.textContent = said.text;
    box.append(line);
  }
  root?.replaceChildren(style, box);
}

/** The page's heading, where the button goes: the last h2 before golf.de's lines (else the page's first h2). */
function headingOf(): Element | null {
  return document.querySelector('main h2') ?? document.querySelector('h2');
}

/** On the tap only: the page's lines now, read by the rule, and that one tournament to the app picked. */
async function take(target: Target): Promise<void> {
  if (busy) return;
  const read = eventOnPage(location.href, doc());
  if (!('event' in read)) {
    // Not loaded, or golf.de changed its page: nothing is sent.
    said = eventText({ ok: false, name: target.name, error: 'changed_page' }, t);
    look();
    return;
  }
  busy = target.id;
  said = null;
  look();
  const r = await ask({ type: 'golfde-event-take', target: target.id, event: read.event });
  busy = null;
  const outcome: TakeOutcome = r?.take ?? { ok: false, name: target.name, error: 'failed' };
  said = eventText(outcome, t);
  if (!outcome.ok && (outcome.error === 'ended' || outcome.error === 'no_pairing')) await refreshTargets();
  look();
}

async function refreshTargets(): Promise<void> {
  const r = await ask({ type: 'golfde-event-line' });
  targets = r?.targets ?? [];
}

/** Whether this is a tournament's page, its lines there (or long enough waited for), and an app to take it. */
function look(): void {
  try {
    const page = eventPageOf(location.href);
    if (!page) {
      shownFor = null;
      said = null;
      remove();
      return;
    }
    if (shownFor !== page.id) {
      // Another tournament: what the last tap said was about the one before.
      shownFor = page.id;
      since = Date.now();
      said = null;
    }
    if (!offerEvent(location.href, doc(), since, Date.now()) || !targets.length) {
      remove();
      return;
    }
    draw(headingOf());
  } catch {
    // never in the page's way
  }
}

void refreshTargets().then(look);
setInterval(look, LOOK_MS);
// A pairing made or ended meanwhile shows on the next look of this kind.
setInterval(() => void refreshTargets(), 30_000);
window.addEventListener('hashchange', look);
