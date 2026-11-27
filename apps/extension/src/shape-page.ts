// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The developer page (the extension's options, shape.html): the shape recorder. Pick a portal of the list; *Start*
 * asks the browser for that portal's address on the same click (an optional host permission, never up front) and
 * opens the portal in a tab of its own; click through it; *Stop*. Then the preview of the whole file, the short
 * repeating values to tick or not, *I have read the file*, and only then *Save*: a download made in this page, sent
 * nowhere.
 */

import { formatTime } from '@glmsync/browser';
import { download } from '@glmsync/browser/download';
import { button, fill, h } from '@glmsync/browser/render';
import { candidates, fileName, PORTALS, portalOf, toFile, type Candidate } from '@glmsync/shape';
import type { Reply } from './messages.ts';
import { heading, lang, send, t } from './page.ts';
import type { ShapeState } from './shape-keeper.ts';
import { errorText, portalName, reasonOf } from './shape-view.ts';

heading('shape.title');

const root = document.getElementById('shape') as HTMLElement;
const POLL_MS = 2_000;
/** Recording this long with nothing seen: the hint that the portal may not be open (or was open before). */
const QUIET_MS = 20_000;

let state: ShapeState = { state: 'idle' };
let chosen: string = PORTALS[0]!.id;
let busy = false;
let error: string | null = null;
let saved: string | null = null;
let read = false;
const released = new Set<string>();

function version(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return '?';
  }
}

async function apply(r: Reply): Promise<void> {
  if (r.ok) {
    error = null;
    if (r.shape) state = r.shape;
  } else {
    error = errorText(r.error, state.portal ?? chosen, t);
    if (r.shape) state = r.shape;
  }
  draw();
}

async function refresh(): Promise<void> {
  const r = await send({ type: 'shape-state' });
  if (r.ok && r.shape) {
    const was = state.state;
    state = r.shape;
    // A step of the player's draws by itself; the poll only when the state moved, or the counts while recording.
    if (!busy && (was !== state.state || state.state === 'recording')) draw();
  } else if (!r.ok) {
    error = errorText(r.error, chosen, t);
    draw();
  }
}

function start(): void {
  if (busy) return;
  const portal = portalOf(chosen);
  if (!portal) return;
  busy = true;
  error = null;
  saved = null;
  read = false;
  released.clear();
  draw();
  // On the click itself: the browser asks for a permission only in answer to the player's gesture.
  let asked: Promise<boolean>;
  try {
    asked = chrome.permissions.request({ origins: portal.matches });
  } catch (e) {
    asked = Promise.reject(e);
  }
  void asked
    .then(
      async (granted) => (granted ? send({ type: 'shape-start', portal: portal.id }) : ({ ok: false, error: 'no_permission' } as Reply)),
      () => ({ ok: false, error: 'no_permission' }) as Reply,
    )
    .then(apply)
    .finally(() => {
      busy = false;
      draw();
    });
}

function act(m: { type: 'shape-stop' } | { type: 'shape-discard' }): void {
  if (busy) return;
  busy = true;
  draw();
  void send(m)
    .then(apply)
    .finally(() => {
      busy = false;
      if (m.type === 'shape-discard') {
        saved = null;
        read = false;
        released.clear();
      }
      draw();
    });
}

function openPortal(): void {
  const portal = portalOf(state.portal);
  if (!portal) return;
  chrome.tabs.create({ url: portal.start }).catch((e: unknown) => {
    error = t('shape.error.other', { reason: reasonOf(e) });
    draw();
  });
}

function picker(): HTMLElement {
  const box = h('fieldset', { class: 'portals', 'data-test': 'shape-portals' }, h('legend', {}, t('shape.portal')));
  for (const p of PORTALS) {
    const input = h('input', { type: 'radio', name: 'portal', value: p.id, 'data-test': `shape-portal-${p.id}` }) as HTMLInputElement;
    input.checked = p.id === chosen;
    input.addEventListener('change', () => {
      chosen = p.id;
    });
    box.append(h('label', { class: 'row' }, input, ` ${p.name}`));
  }
  return box;
}

function candidateList(list: Candidate[]): HTMLElement {
  if (!list.length) return h('p', { class: 'muted small', 'data-test': 'shape-no-candidates' }, t('shape.noCandidates'));
  const box = h('div', { 'data-test': 'shape-candidates' }, h('p', { class: 'small' }, t('shape.candidates')));
  for (const c of list) {
    const input = h('input', { type: 'checkbox', 'data-test': 'shape-candidate', 'data-field': c.field }) as HTMLInputElement;
    input.checked = released.has(c.id);
    input.addEventListener('change', () => {
      if (input.checked) released.add(c.id);
      else released.delete(c.id);
      // What the file says changed: it has to be read again.
      read = false;
      draw();
    });
    box.append(h('label', { class: 'row small' }, input, ` ${t('shape.candidate', { field: c.field, endpoint: c.endpoint, values: c.values.join(', ') })}`));
  }
  return box;
}

function stoppedView(): HTMLElement[] {
  const r = state.recording;
  const name = portalName(state.portal);
  const out: HTMLElement[] = [];
  if (!r || !state.calls) {
    out.push(h('p', { class: 'note warn', 'data-test': 'shape-empty' }, t('shape.empty')));
    out.push(h('div', { class: 'row' }, button(t('shape.new'), () => act({ type: 'shape-discard' }), { class: 'primary', 'data-test': 'shape-new' })));
    return out;
  }
  out.push(h('p', { 'data-test': 'shape-stopped' }, t('shape.stopped', { portal: name, calls: state.calls ?? 0, addresses: state.addresses ?? 0 })));
  let text: string;
  let list: Candidate[];
  try {
    list = candidates(r);
    text = `${JSON.stringify(toFile(r, { portal: r.portal, portalName: name, madeWith: `Golf Stats Sync extension ${version()}` }, released), null, 2)}\n`;
  } catch (e) {
    out.push(h('p', { class: 'note warn', 'data-test': 'shape-error' }, t('shape.error.preview_failed', { reason: reasonOf(e) })));
    out.push(h('div', { class: 'row' }, button(t('shape.discard'), () => act({ type: 'shape-discard' }), { 'data-test': 'shape-discard' })));
    return out;
  }
  out.push(h('p', { class: 'note small', 'data-test': 'shape-what' }, t('shape.whatIsIn')));
  out.push(candidateList(list));
  out.push(h('h2', {}, t('shape.preview')));
  out.push(h('pre', { class: 'preview', 'data-test': 'shape-preview', tabindex: '0' }, text));
  const check = h('input', { type: 'checkbox', 'data-test': 'shape-read' }) as HTMLInputElement;
  check.checked = read;
  check.addEventListener('change', () => {
    read = check.checked;
    draw();
  });
  const save = button(
    t('shape.save'),
    () => {
      const file = fileName(r.portal, r.started);
      try {
        download(file, text);
        saved = file;
        error = null;
      } catch (e) {
        error = t('shape.error.save_failed', { reason: reasonOf(e) });
      }
      draw();
    },
    { class: 'primary', 'data-test': 'shape-save' },
  );
  save.disabled = !read;
  out.push(h('label', { class: 'row' }, check, ` ${t('shape.read')}`));
  out.push(h('div', { class: 'row' }, save, button(t('shape.discard'), () => act({ type: 'shape-discard' }), { 'data-test': 'shape-discard' })));
  if (saved) out.push(h('p', { class: 'note', 'data-test': 'shape-saved' }, t('shape.saved', { name: saved })));
  return out;
}

function draw(): void {
  const name = portalName(state.portal);
  const parts: (HTMLElement | null)[] = [h('p', { class: 'small' }, t('shape.intro'))];
  if (error) parts.push(h('p', { class: 'note warn', role: 'alert', 'data-test': 'shape-error' }, error));
  if (state.state === 'idle') {
    parts.push(picker());
    const b = button(busy ? t('shape.starting') : t('shape.start'), start, { class: 'primary', 'data-test': 'shape-start' });
    b.disabled = busy;
    parts.push(h('div', { class: 'row' }, b));
  } else if (state.state === 'recording') {
    const since = state.started ?? Date.now();
    parts.push(h('p', { 'data-test': 'shape-recording' }, t('shape.recording', { portal: name, time: formatTime(since, lang), calls: state.calls ?? 0, addresses: state.addresses ?? 0 })));
    if (state.full) parts.push(h('p', { class: 'note warn', 'data-test': 'shape-full' }, t('shape.full')));
    else if (!state.calls && Date.now() - since > QUIET_MS) parts.push(h('p', { class: 'note warn', 'data-test': 'shape-quiet' }, t('shape.nothingYet')));
    parts.push(h('p', { class: 'small' }, t('shape.howTo')));
    parts.push(h('p', { class: 'small muted' }, t('shape.oldTabs')));
    const stop = button(t('shape.stop'), () => act({ type: 'shape-stop' }), { class: 'primary', 'data-test': 'shape-stop' });
    stop.disabled = busy;
    parts.push(h('div', { class: 'row' }, stop, button(t('shape.openPortal', { portal: name }), openPortal, { 'data-test': 'shape-open' })));
  } else if (state.state === 'interrupted') {
    parts.push(h('p', { class: 'note warn', 'data-test': 'shape-interrupted' }, t('shape.interrupted', { portal: name })));
    parts.push(h('div', { class: 'row' }, button(t('shape.new'), () => act({ type: 'shape-discard' }), { class: 'primary', 'data-test': 'shape-new' })));
  } else parts.push(...stoppedView());
  fill(root, ...parts);
}

draw();
void refresh();
setInterval(() => {
  // Only while recording: the counts move. A stopped recording's preview isn't drawn again under the reader's eyes.
  if (state.state === 'recording' || state.state === 'idle') void refresh();
}, POLL_MS);
