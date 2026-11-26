// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of the pages of the Ladies European Tour and the LET Access Series (spec/prores.md; `ocs` of
 * `@glmsync/provider-tours`), in its own isolated world. Only while an app is connected for a pro's pages; otherwise it
 * reads nothing and shows nothing.
 *
 * - On a player's profile it reads her results of the season the page shows (with every round), and shows the line with
 *   *Send*.
 * - On the Order of Merit it takes only her own line (by the link to the profile read last on this tour), and the line
 *   says so; *Send* there sends the profile with it.
 * - *Fetch all* (decision 57) on her profile picks the seasons of the reach there and opens each season's Order of
 *   Merit, one step at a time at a person's pace (tour-run.ts), each read as when she does it; what was read goes out
 *   once at the end.
 *
 * Each site is one app that changes its address without loading a page, so the script runs on every page of it and
 * looks again whenever the address changes. Nothing here asks the site anything: it reads what the site's own page
 * shows. The line lives in a shadow root.
 */

import { pickLang, proLineOf, translator, type LinePhase, type ProView } from '@glmsync/browser';
import { ocs, snapshotOf, type Snapshot } from '@glmsync/provider-tours';
import type { Reply } from './messages.ts';
import { resumeRun, startRun, stopRun, type RunHooks } from './tour-run.ts';
import type { OcsView } from '@glmsync/browser/ocs';
import { runNote, type RunView } from '@glmsync/browser/runs';

const t = translator(pickLang(navigator.languages));
const SITE = ocs.siteAt(location.href)?.site;
/** How long a page may take to show its table (the site loads it a moment after the page). */
const TABLE_WAIT_MS = 15_000;
/** How often the address is looked at (the site changes it without loading a page). */
const WATCH_MS = 1_000;

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;
let phase: LinePhase = 'ready';
let pro: ProView | undefined;
let view: OcsView | undefined;
let note: string | null = null;
let here = location.href;
let runView: RunView | undefined;

const hooks: RunHooks = {
  look: async () => ((await look()) ? 'read' : 'unread'),
  player: () => ocs.profileIdOf(location.href),
  answer: (r) => take(r),
  // Her profile reads only on loading and on an address changed: a pick of the run reads after it itself.
  picking: () => undefined,
};

/** What the background answered: the line follows it; a run that just ended sent what was read. */
function take(r: Extract<Reply, { ok: true }>): void {
  if (r.pro) pro = r.pro;
  if (r.ocs) view = r.ocs;
  if (r.run) runView = r.run;
  if (r.runStep?.do === 'end') {
    phase = 'done';
    note = null;
  }
  draw();
}

type Ask = { type: 'ocs-line' } | { type: 'ocs-seen'; seen: object } | { type: 'ocs-send' } | { type: 'ocs-answer' };

async function ask(m: Ask): Promise<Extract<Reply, { ok: true }> | null> {
  if (!SITE) return null;
  try {
    const r = (await chrome.runtime.sendMessage(m.type === 'ocs-answer' ? m : { ...m, site: SITE })) as Reply | undefined;
    if (!r?.ok) return null;
    take(r);
    return r;
  } catch {
    // The extension was updated or reloaded meanwhile: the page goes on without the line.
    return null;
  }
}

const kindOf = (url: string): 'profile' | 'oom' | null => (ocs.profileIdOf(url) ? 'profile' : ocs.isOomPage(url) ? 'oom' : null);

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
  const kind = kindOf(location.href);
  const line = pro && SITE ? proLineOf(pro, SITE, phase, t) : null;
  // On her profile always (with an app connected); on the Order of Merit only once a profile of this tour was read.
  if (!line || hidden || !kind || (kind === 'oom' && !view?.who)) {
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
  box.setAttribute('data-test', 'ocs-line');
  const text = document.createElement('span');
  const running = SITE && runView?.running?.family === SITE ? runView.running : null;
  const ran = SITE && runView ? runNote(runView, SITE, t) : null;
  text.textContent = running || (ran && phase === 'ready' && !note) ? (ran ?? '') : (note ?? line.text);
  box.append(text);
  if (running) box.append(button(t('line.stop'), 'ocs-stop', () => void stop()));
  else {
    if (line.answer) box.append(button(t('proLine.answer'), 'ocs-answer', () => void ask({ type: 'ocs-answer' })));
    if (line.send && phase !== 'reading') box.append(button(t('proLine.send'), 'ocs-send', () => void send()));
    // *Fetch all* starts on her profile, where its seasons are picked.
    if (kind === 'profile' && !line.answer && phase !== 'reading') box.append(button(t('line.fetchAll'), 'ocs-fetch-all', () => void fetchAll()));
  }
  box.append(button('×', 'ocs-hide', () => {
    hidden = true;
    draw();
  }, true));
  root?.replaceChildren(style, box);
}

/** The page as it shows now, waited for a little until `ready`. */
async function snapshot(ready: (s: Snapshot) => boolean): Promise<Snapshot> {
  const started = Date.now();
  let snap = snapshotOf(document, location.href);
  while (!ready(snap) && Date.now() - started < TABLE_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snap = snapshotOf(document, location.href);
  }
  return snap;
}

/** What this page shows of her, to the background; false when there was nothing to read. */
async function look(): Promise<boolean> {
  const url = location.href;
  try {
    const kind = kindOf(url);
    if (kind === 'profile') {
      const p = ocs.readProfile(await snapshot((s) => ocs.readProfile(s)?.kind === 'profile'));
      if (location.href !== url) return false; // she went on meanwhile: that page reads itself
      if (p?.kind === 'profile') return (await ask({ type: 'ocs-seen', seen: { profile: p } })) !== null;
      if (p?.kind === 'unread' && p.why === 'no_result') note = t('ocsLine.noResults');
      else phase = 'changed_page';
      draw();
      return false;
    }
    const who = view?.who;
    if (kind === 'oom' && who) {
      const l = ocs.readOom(await snapshot((s) => ocs.readOom(s, who.id)?.kind === 'oom'), who.id);
      if (location.href !== url) return false;
      // Only her line goes; the snapshot with everyone else's names stays here.
      if (l?.kind === 'oom') {
        const r = await ask({ type: 'ocs-seen', seen: { oom: l } });
        note = l.rank !== undefined ? t('ocsLine.oomRead', { rank: l.rank }) : null;
        draw();
        return r !== null;
      }
      if (l?.kind === 'unread' && l.why === 'not_him') note = t('ocsLine.oomMissing');
      else phase = 'changed_page';
      draw();
      // Her profile, read before, can still go.
      return true;
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
  note = null;
  draw();
  if (!(await look()) && kindOf(location.href) === 'profile') {
    if (phase === 'reading') phase = 'ready';
    draw();
    return;
  }
  const r = await ask({ type: 'ocs-send' });
  phase = r ? 'done' : 'error';
  note = null;
  draw();
}

async function fetchAll(): Promise<void> {
  note = null;
  phase = 'ready';
  const r = await startRun(hooks);
  if (r?.start === 'limit') note = t('tourLine.limit');
  else if (r?.start === 'busy') note = t('runLine.busy');
  draw();
}

async function stop(): Promise<void> {
  const r = await stopRun(hooks);
  phase = r ? 'done' : 'error';
  note = null;
  draw();
}

void (async () => {
  if (!SITE) return;
  await ask({ type: 'ocs-line' });
  if (!pro?.pairings.length) return; // no app connected for a pro's pages: read nothing
  const read = kindOf(location.href) ? await look() : null;
  // A page a run of *Fetch all* opened in this tab (an Order of Merit): said so, and the run goes on.
  await resumeRun(hooks, async () => (read === null ? null : read ? 'read' : 'unread'));
  // The site changes its address without loading a page: a new page of hers is looked at again.
  setInterval(() => {
    if (location.href === here) return;
    here = location.href;
    phase = 'ready';
    note = null;
    hidden = false;
    draw();
    void look();
  }, WATCH_MS);
})();
