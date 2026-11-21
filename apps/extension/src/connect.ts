// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The connect window: opened when the web app's pairing page hands over a code. It shows where the
 * data would go and asks the player; the browser's own prompt for that one address follows from the
 * same click. Afterwards, and when it was opened for "Is this you?", it shows the status panel - and,
 * once all is done (paired, signed in, confirmed), says so with a button that closes this tab. For the handicap record
 * (kind=hcp) there is nothing to sign in to here: once paired it points to golf.de's History Sheet, and is done.
 */

import type { ClientStatus } from '@glmsync/browser';
import { button, fill, h } from '@glmsync/browser/render';
import { finished } from './finished.ts';
import type { Pending } from './messages.ts';
import { heading, send, statusPanel, t } from './page.ts';

heading('connect.title');
const done = document.getElementById('done') as HTMLElement;
const ask = document.getElementById('ask') as HTMLElement;
const panel = document.getElementById('status') as HTMLElement;

let pendingNow: Pending | null = null;
let statusNow: ClientStatus | null = null;

/** This tab, closed: by the browser's tab API (an extension page may close its own tab), else by the window. */
async function closeTab(): Promise<void> {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await chrome.tabs.remove(tab.id);
      return;
    }
  } catch {
    // below
  }
  window.close();
}

const isHcp = () => pendingNow?.kind === 'hcp';

let wasDone = false;
function showDone(): void {
  // The handicap record has no sign-in here and no "Is this you?": paired is done.
  panel.hidden = isHcp();
  const now = isHcp() ? pendingNow?.state === 'paired' : finished(pendingNow, statusNow);
  if (now === wasDone) return;
  wasDone = now;
  fill(done, now ? h('div', { class: 'note', 'data-test': 'finished', role: 'status' }, h('p', {}, t('connect.finished')), h('div', { class: 'row' }, button(t('connect.close'), () => void closeTab(), { class: 'primary', 'data-test': 'close' }))) : null);
  show(pendingNow);
}

function show(p: Pending | null | undefined): void {
  if (!p) {
    fill(ask);
    return;
  }
  const host = p.host;
  switch (p.state) {
    case 'asking': {
      const origins = [`${new URL(p.target).origin}/*`];
      const allow = button(t('connect.allow'), () => {
        // The browser's prompt needs this very click: ask first, then tell the background.
        allow.disabled = true;
        chrome.permissions.request({ origins }).then(
          () => void send({ type: 'pair-confirm' }).then((r) => show(r.ok ? r.pending : null)),
          () => void send({ type: 'pair-confirm' }).then((r) => show(r.ok ? r.pending : null)),
        );
        show({ ...p, state: 'working' });
      }, { class: 'primary', 'data-test': 'allow' });
      fill(ask,
        h('h3', {}, t(p.kind === 'hcp' ? 'connect.askHcp' : 'connect.ask', { host })),
        h('p', {}, t(p.kind === 'hcp' ? 'connect.whatHcp' : 'connect.what', { host })),
        h('p', { class: 'muted small' }, t('connect.permission', { host })),
        h('div', { class: 'row' }, allow, button(t('connect.cancel'), () => void send({ type: 'pair-cancel' }).then((r) => show(r.ok ? r.pending : null)), { 'data-test': 'cancel' })),
      );
      break;
    }
    case 'working':
      fill(ask, h('p', { 'data-test': 'working' }, t('connect.working')));
      break;
    case 'paired':
      if (p.kind === 'hcp') {
        fill(ask,
          h('p', { class: 'note', 'data-test': 'paired' }, t('connect.done', { name: p.name ?? host })),
          h('p', {}, t('connect.nextHcp')),
          h('div', { class: 'row' }, button(t('connect.openHcp'), () => void send({ type: 'open-golfde' }), { 'data-test': 'open-golfde' })),
        );
      } else {
        fill(ask, h('p', { class: 'note', 'data-test': 'paired' }, t('connect.done', { name: p.name ?? host })), wasDone ? null : h('p', { class: 'muted' }, t('connect.next')));
      }
      break;
    case 'failed':
      fill(ask,
        h('p', { class: 'note warn', 'data-test': 'failed' }, p.error === 'denied' ? t('connect.denied', { host }) : t(`connect.error.${p.error ?? 'refused'}` as Parameters<typeof t>[0])),
      );
      break;
    case 'cancelled':
      fill(ask, h('p', { class: 'muted' }, t('connect.gone')));
      break;
  }
}

// Another app's page may hand over a new code while this window is open: it shows the newest request.
let shown = '';
const look = async () => {
  const r = await send({ type: 'pending' });
  const p = r.ok ? r.pending : null;
  pendingNow = p ?? null;
  const said = p ? `${p.target}|${p.at}|${p.state}` : '';
  if (said !== shown) {
    shown = said;
    show(p);
  }
  showDone();
};
void look();
setInterval(() => void look(), 1000);
statusPanel(panel, {
  onStatus: (s) => {
    statusNow = s;
    showDone();
  },
});
