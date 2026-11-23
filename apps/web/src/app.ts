// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The web app by hand: no extension, so the player brings the Trackman key (the bookmark copies it
 * from the portal) and fetches while the page is open - to a connected app (*Fetch now*, still only
 * when its plan says so) or into a file. The same client, guard and rules as the extension. While the
 * page is open, a connected app's older history comes a chunk at a time, when its plan says it may.
 *
 * The main view: *Connect new* and the list of connections (connections.ts); a row opens its details. *Connect new*
 * starts in the app that should get the data (its pairing page brings the player back here, `#connect`). Connecting
 * goes as steps (`@glmsync/browser`'s wizard): allowed and chosen on the pairing page, then here the key (the
 * bookmark, pasted), *Is this you?*, the first sync right after the yes, shown plainly, and done - the overview then
 * follows below.
 *
 * Test mode (spec/test-mode.md): small, under the sign-in (the wizard's step 3, the overview's sign-in), *Enter a test
 * code*, for testing a connected app with its made-up scenario instead of a Trackman account.
 */

import { connectionsOfStatus, sortConnections, type ClientStatus, type KeyOutcome, type TestOutcome } from '@glmsync/browser';
import { download, logName } from '@glmsync/browser/download';
import { backLink, button, endedNotes, fill, h, offerWizard, PORTAL_URL, renderConnections, renderStatus, testEntry, type Actions, type WizardMemory } from '@glmsync/browser/render';
import { $, client, lang, t, texts } from './common.ts';

declare const __BOOKMARKLET__: string;

texts('web.title');
const listView = $('list');
const listRoot = $('connections');
const newView = $('new');
const detail = $('detail');
const panel = $('status');
const keyBox = $('key');
// Shown only where the panel puts it (the sign-in), never on its own.
keyBox.remove();
const fileBox = $('file');
const busy = new Set<string>();
let asking: string | null = null;
let askingEnd: string | null = null;
let testConfirming = false;
let last: ClientStatus | null = null;
let keyMessage: { text: string; undo?: boolean } | null = null;
let fileMessage = '';
let confirming = false;
const memory: WizardMemory = { walked: false };

type View = 'list' | 'new' | 'detail';
// Back from an app's pairing page (`#connect`): its steps go on in the details.
let view: View = location.hash === '#connect' ? 'detail' : 'list';
if (location.hash) window.history.replaceState(null, '', location.pathname + location.search);
let first = true;

function show(next: View): void {
  view = next;
  // *Connect new* here: it starts in the app (its pairing page brings the player back). Drawn only while shown.
  fill($('new-steps'), view === 'new' ? offerWizard({ t, state: 'none', kind: 'lm', services: [] }, { allow: () => undefined, cancel: () => show('list'), choose: () => undefined }) : null);
  listView.hidden = view !== 'list';
  newView.hidden = view !== 'new';
  detail.hidden = view !== 'detail';
  if (last) draw(last);
}
for (const el of [newView, detail]) fill(el.querySelector('.back-link') as HTMLElement, backLink(t, () => show('list')));

// *Enter a test code*, drawn apart from the panel (typing survives a redraw), which puts it under the sign-in.
const testRoot = h('div', {});
const entry = testEntry(testRoot, t, async (code, id) => {
  const out = await client.fetchTest(code, id);
  await refresh();
  return out;
});

async function refresh(): Promise<void> {
  try {
    last = await client.status();
  } catch {
    return; // the storage couldn't be read this once: the page keeps what it shows, the next refresh tries again
  }
  draw(last);
}

function draw(s: ClientStatus): void {
  // A test's question waits for an answer in the details (it came from a code typed there).
  if (first && s.testAsking) view = 'detail';
  first = false;
  listView.hidden = view !== 'list';
  newView.hidden = view !== 'new';
  detail.hidden = view !== 'detail';
  const notes = endedNotes(s.ended, t, lang, () => void client.clearEnded().then(refresh));
  renderConnections(listRoot, sortConnections(connectionsOfStatus(s, busy)), { t }, { add: () => show('new'), open: () => show('detail') });
  if (notes.length) listRoot.prepend(...notes);
  drawKey(s);
  // The key's box and the test code go where the sign-in is (the panel says where): the wizard's step 3, or the
  // overview's sign-in for an app connected to the account.
  renderStatus(panel, s, { t, lang, now: Date.now(), busy, client: 'web', asking, askingEnd, testConfirming, confirming, memory, signinSlot: keyBox, testSlot: testRoot }, actions);
  // While a step stands, only it: the file comes with the overview, and only for the Trackman account's data.
  const step = panel.querySelector('[data-test="wizard"]')?.getAttribute('data-step');
  fileBox.hidden = (!!step && step !== 'done') || (!s.pairings.some((p) => !p.test) && s.key.state !== 'ready');
  drawFile(s);
  entry.update(s);
}

// ---------------------------------------------------------------------------
// While the page is open: the older history, a chunk when it is due (the extension's alarm, for a page)
// ---------------------------------------------------------------------------

/** How long the page waits at most before it looks again whether a chunk is due. */
const LOOK_MS = 5 * 60_000;
let historyTimer: ReturnType<typeof setTimeout> | null = null;

async function planHistory(): Promise<void> {
  if (historyTimer !== null) clearTimeout(historyTimer);
  historyTimer = null;
  let at: number | null = null;
  try {
    at = await client.nextBackfill();
  } catch {
    at = null;
  }
  if (at === null) return; // no app's history waits; a sync that brings `more` plans again
  const wait = Math.min(LOOK_MS, Math.max(1_000, at - Date.now()));
  historyTimer = setTimeout(() => void history(), wait);
}

async function history(): Promise<void> {
  historyTimer = null;
  try {
    const running = client.run('backfill');
    void refresh(); // says "fetching" while it runs
    await running;
  } catch {
    // What went wrong is the pairing's line; the next look tries again.
  } finally {
    await refresh();
    void planHistory();
  }
}

function drawKey(s: ClientStatus): void {
  if (s.key.state === 'ready' || s.key.state === 'confirm') {
    fill(keyBox);
    return;
  }
  const mark = h('a', { class: 'button bookmarklet', 'data-test': 'bookmarklet' }, t('web.bookmark'));
  mark.setAttribute('href', __BOOKMARKLET__);
  mark.addEventListener('click', (e) => e.preventDefault()); // for the bookmarks bar, not for this page
  const area = h('textarea', { rows: '3', id: 'paste', 'aria-label': t('web.pasteLabel'), placeholder: t('web.pasteLabel'), 'data-test': 'paste' }) as HTMLTextAreaElement;
  const use = button(t('web.pasteButton'), async () => {
    use.disabled = true;
    const r: KeyOutcome = await client.setKey(area.value);
    use.disabled = false;
    if (r.ok) {
      area.value = '';
      keyMessage = null;
    } else {
      keyMessage = r.error === 'rejected' ? { text: t('web.keyRejected'), undo: true } : { text: t(r.error === 'expired' ? 'web.keyExpired' : 'web.keyInvalid') };
    }
    await refresh();
  }, { class: 'primary', 'data-test': 'use-key' });
  fill(keyBox,
    h('p', {}, t('web.bookmarkHow')),
    h('div', { class: 'row' }, mark, h('a', { href: PORTAL_URL, target: '_blank', rel: 'noopener' }, t('key.openPortal'))),
    h('p', {}, area),
    h('div', { class: 'row' }, use),
    keyMessage ? h('p', { class: 'note warn', 'data-test': 'key-message' }, keyMessage.text) : null,
    keyMessage?.undo
      ? button(t('web.keyRejectedUndo'), async () => {
          await client.forgetRejected();
          keyMessage = null;
          await refresh();
        }, { class: 'link' })
      : null,
  );
}

function drawFile(s: ClientStatus): void {
  const ready = s.key.state === 'ready';
  const save = (reason: 'manual' | 'backfill') =>
    button(t(reason === 'manual' ? 'web.fileNew' : 'web.fileHistory'), async () => {
      fileMessage = t('pairing.fetching');
      drawFile(s);
      // A file only when there is something in it: an empty one would just clutter the downloads.
      const files: { name: string; text: string }[] = [];
      const out = await client.toFile(reason, async (f) => void files.push(f));
      const something = out.status === 'synced' && out.result.sessions + out.result.rounds + out.result.round_shots > 0;
      if (something) for (const f of files) download(f.name, f.text);
      if (something && out.status === 'synced') {
        fileMessage = t('web.fileDone', { what: t('result.some', { sessions: out.result.sessions, shots: out.result.shots, rounds: out.result.rounds }) });
        if (out.notice) fileMessage += ` ${t(`notice.${out.notice.code}`)}`;
      } else if (out.status === 'failed') fileMessage = t('last.failed', { error: t('error.error') });
      else fileMessage = t('web.fileNothing');
      await refresh();
    }, { ...(ready ? {} : { disabled: '' }), 'data-test': `file-${reason}` });
  fill(fileBox,
    h('h2', {}, t('web.fileTitle')),
    h('p', { class: 'muted small' }, t('web.fileHow')),
    h('div', { class: 'row' }, save('manual'), save('backfill')),
    fileMessage ? h('p', { 'data-test': 'file-message' }, fileMessage) : null,
  );
}

/** The first sync, right after the yes: the wizard's third step shows it coming. */
async function firstSync(): Promise<void> {
  let s: ClientStatus;
  try {
    s = await client.status();
  } catch {
    return;
  }
  const ids = s.pairings.filter((p) => !p.test).map((p) => p.id);
  for (const id of ids) busy.add(id);
  draw(s);
  try {
    await client.run('connect');
  } catch {
    // What went wrong is the step's line (and the pairing's), with *Fetch now* to try again.
  } finally {
    for (const id of ids) busy.delete(id);
    await refresh();
    void planHistory();
  }
}

const actions: Actions = {
  confirm: (yes) => {
    confirming = true;
    if (last) draw(last);
    void client
      .confirm(yes)
      .catch(() => null)
      .then(async (state) => {
        confirming = false;
        await refresh();
        if (yes && state?.state === 'ready') await firstSync();
      });
  },
  retryWho: () => void client.retryWho().then(refresh),
  fetchNow: (id) => {
    busy.add(id);
    if (last) draw(last);
    void client
      .run('manual', id)
      .catch(() => undefined)
      .finally(() => {
        busy.delete(id);
        void refresh();
        void planHistory();
      });
  },
  askDisconnect: (id) => {
    asking = id;
    if (last) draw(last);
  },
  disconnect: (id) => {
    asking = null;
    void client.removePairing(id).then(refresh);
  },
  exportLog: () => void client.exportLog().then((log) => download(logName(Date.now()), `${JSON.stringify(log, null, 2)}\n`)),
  clearEnded: () => void client.clearEnded().then(refresh),
  forgetKey: () => void client.dropKey().then(refresh),
  openPortal: () => window.open(PORTAL_URL, '_blank', 'noopener'),
  confirmTest: (yes) => {
    testConfirming = true;
    if (last) draw(last);
    void client.confirmTest(yes).catch((): TestOutcome => ({ ok: false, error: 'not_kept' })).then(async (out) => {
      testConfirming = false;
      await refresh();
      if (!yes) return;
      if (!out.ok) {
        entry.fail(out.error);
        return;
      }
      // The first sync from the scenario now, as after a sign-in's yes; then the history while the page is open.
      busy.add(out.id);
      if (last) draw(last);
      await client.run('connect', out.id).catch(() => undefined);
      busy.delete(out.id);
      await refresh();
      void planHistory();
    });
  },
  askEndTest: (id) => {
    askingEnd = id;
    if (last) draw(last);
  },
  endTest: (id) => {
    askingEnd = null;
    // Ending can't fail for the tester: what couldn't be removed is never read again without its listing.
    void client.endTest(id).catch(() => undefined).then(refresh).then(planHistory);
  },
};

void refresh().then(planHistory);
