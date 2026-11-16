// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The web app by hand: no extension, so the player brings the Trackman key (the bookmark copies it
 * from the portal) and fetches while the page is open - to a connected app (*Fetch now*, still only
 * when its plan says so) or into a file. The same client, guard and rules as the extension.
 */

import { type ClientStatus, type KeyOutcome } from '@glmsync/browser';
import { download, logName } from '@glmsync/browser/download';
import { button, fill, h, PORTAL_URL, renderStatus, type Actions } from '@glmsync/browser/render';
import { $, client, lang, t, texts } from './common.ts';

declare const __BOOKMARKLET__: string;

texts('web.title');
const panel = $('status');
const keyBox = $('key');
const fileBox = $('file');
const busy = new Set<string>();
let asking: string | null = null;
let last: ClientStatus | null = null;
let keyMessage: { text: string; undo?: boolean } | null = null;
let fileMessage = '';

async function refresh(): Promise<void> {
  last = await client.status();
  draw(last);
}

function draw(s: ClientStatus): void {
  renderStatus(panel, s, { t, lang, now: Date.now(), busy, client: 'web', asking }, actions);
  drawKey(s);
  drawFile(s);
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

const actions: Actions = {
  confirm: (yes) => void client.confirm(yes).then(refresh),
  retryWho: () => void client.retryWho().then(refresh),
  fetchNow: (id) => {
    busy.add(id);
    if (last) draw(last);
    void client.run('manual', id).finally(() => {
      busy.delete(id);
      void refresh();
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
};

void refresh();
