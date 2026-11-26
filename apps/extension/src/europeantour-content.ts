// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's side of a player's own pages on europeantour.com (DP World Tour, HotelPlanner Tour; spec/prores.md,
 * `@glmsync/provider-tours`), in its own isolated world. Only while an app is connected for a pro's pages; otherwise
 * it reads nothing and shows nothing.
 *
 * - On each page of his it reads what the page shows now (his ranks, his results with their rounds of the season
 *   picked, the season statistics of the tour picked) and hands it to the background, which keeps it merged; when he
 *   picks another season or tour in the page's own select, it reads again a moment later.
 * - *Send* sends what was read, a page per tour, to the apps connected for it.
 * - *Fetch all* (decision 57) opens his pages and picks the seasons and tours for him, one step at a time at a
 *   person's pace (tour-run.ts), each page read as when he opens or picks it; what was read goes out once at the end.
 *
 * Nothing here asks the site anything: it reads the document the site's own scripts built. The line lives in a shadow
 * root. A page of another player replaces what was kept (the target checks the name in any case).
 */

import { pickLang, proLineOf, translator, type LinePhase, type ProView } from '@glmsync/browser';
import { europeantour, snapshotOf, type TourSite } from '@glmsync/provider-tours';
import type { Reply } from './messages.ts';
import type { EtView } from '@glmsync/browser/europeantour';
import { runNote, type RunView } from '@glmsync/browser/runs';
import { resumeRun, startRun, stopRun, type RunHooks } from './tour-run.ts';

const t = translator(pickLang(navigator.languages));
/** How long a page may take to show its table (the site's scripts build it a moment after the page). */
const TABLE_WAIT_MS = 10_000;
/** After a pick in the page's select, the site needs a moment to show the new table. */
const AFTER_PICK_MS = 1500;
const SITES: readonly TourSite[] = Object.values(europeantour.SITE);

let host: HTMLElement | null = null;
let root: ShadowRoot | null = null;
let hidden = false;
let phase: LinePhase = 'ready';
let pro: ProView | undefined;
let et: EtView | undefined;
/** The tour the line speaks of: the one an app asks about, else the one sent last, else the address's. */
let lastSent: TourSite | null = null;
let runView: RunView | undefined;
/** A pick of *Fetch all* is being done: the page's `change` is the run's, which reads after it itself. */
let picking = false;
/** Why *Fetch all* didn't start (run often enough today, or going on in another tab). */
let note: string | null = null;
const FAMILY = 'europeantour';

const hooks: RunHooks = {
  look: async () => ((await look()) ? 'read' : 'unread'),
  player: () => europeantour.playerPageOf(location.href)?.id ?? null,
  answer: (r) => take(r),
  picking: (on) => {
    picking = on;
  },
};

/** What the background answered: the line follows it; a run that just ended sent what was read. */
function take(r: Extract<Reply, { ok: true }>): void {
  if (r.pro) pro = r.pro;
  if (r.et) et = r.et;
  if (r.run) runView = r.run;
  // A run sent a page per tour: the line speaks of the one sent last.
  if (r.sent?.length) lastSent = r.sent.at(-1) ?? lastSent;
  if (r.runStep?.do === 'end') phase = 'done';
  draw();
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type Ask = { type: 'et-seen'; read: object } | { type: 'et-line' } | { type: 'et-send' } | { type: 'et-answer' };

async function ask(m: Ask): Promise<Extract<Reply, { ok: true }> | null> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    if (!r?.ok) return null;
    take(r);
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

function lineSite(): TourSite {
  const asked = pro?.question?.site;
  if (asked && (SITES as readonly string[]).includes(asked)) return asked as TourSite;
  return lastSent ?? europeantour.siteOfUrl(location.href);
}

function draw(): void {
  const line = pro ? proLineOf(pro, lineSite(), phase, t) : null;
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
  box.setAttribute('data-test', 'et-line');
  const text = document.createElement('span');
  const running = runView?.running?.family === FAMILY ? runView.running : null;
  const ran = runView ? runNote(runView, FAMILY, t) : null;
  text.textContent = running || (ran && phase === 'ready') ? (ran ?? '') : (note ?? line.text);
  box.append(text);
  if (running) box.append(button(t('line.stop'), 'et-stop', () => void stop()));
  else {
    if (line.answer) box.append(button(t('proLine.answer'), 'et-answer', () => void ask({ type: 'et-answer' })));
    if (line.send) box.append(button(t('proLine.send'), 'et-send', () => void send()));
    // *Fetch all* stays after a send, as on the Pro Golf Tour: another run brings what changed since.
    if (!line.answer && phase !== 'reading') box.append(button(t('line.fetchAll'), 'et-fetch-all', () => void fetchAll()));
  }
  box.append(button('×', 'et-hide', () => {
    hidden = true;
    draw();
  }, true));
  root?.replaceChildren(style, box);
}

/** The page as it shows now, what the module reads of it waited for a little. */
async function snapshot(): Promise<ReturnType<typeof snapshotOf>> {
  const started = Date.now();
  let snap = snapshotOf(document, location.href, [], europeantour.BEFORE);
  while (!europeantour.shows(snap) && Date.now() - started < TABLE_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    snap = snapshotOf(document, location.href, [], europeantour.BEFORE);
  }
  return snap;
}

/** What this page shows of the player, to the background. False when it couldn't be read. */
async function look(): Promise<boolean> {
  try {
    const r = europeantour.readPage(await snapshot(), document.title, localDay());
    if (r?.kind === 'page') {
      if (phase === 'changed_page') phase = 'ready';
      await ask({ type: 'et-seen', read: r });
      return true;
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
  if (!(await look())) return;
  const r = await ask({ type: 'et-send' });
  // An app keeps what it answered last, i.e. to the tour sent last: the line speaks of that one.
  lastSent = r?.et?.sent?.at(-1) ?? lastSent;
  phase = r ? 'done' : 'error';
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
  draw();
}

void (async () => {
  await ask({ type: 'et-line' });
  if (!pro?.pairings.length) return; // no app connected for a pro's pages: read nothing
  const read = await look();
  // A page a run of *Fetch all* opened in this tab: said so, and the run goes on.
  await resumeRun(hooks, async () => (read ? 'read' : 'unread'));
  // Another season or tour picked in the page's own select: the table it shows next is read too.
  document.addEventListener('change', (e) => {
    if (picking || !(e.target instanceof HTMLSelectElement)) return;
    setTimeout(() => {
      // Something new to send: *Send* is offered again.
      void look().then((ok) => {
        if (ok && phase === 'done') {
          phase = 'ready';
          draw();
        }
      });
    }, AFTER_PICK_MS);
  });
})();
