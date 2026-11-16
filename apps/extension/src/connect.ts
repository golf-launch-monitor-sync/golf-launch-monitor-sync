// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The connect window: opened when the web app's pairing page hands over a code. It shows where the
 * data would go and asks the player; the browser's own prompt for that one address follows from the
 * same click. Afterwards, and when it was opened for "Is this you?", it shows the status panel.
 */

import { button, fill, h } from '@glmsync/browser/render';
import type { Pending } from './messages.ts';
import { heading, send, statusPanel, t } from './page.ts';

heading('connect.title');
const ask = document.getElementById('ask') as HTMLElement;
const panel = document.getElementById('status') as HTMLElement;

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
        h('h3', {}, t('connect.ask', { host })),
        h('p', {}, t('connect.what', { host })),
        h('p', { class: 'muted small' }, t('connect.permission', { host })),
        h('div', { class: 'row' }, allow, button(t('connect.cancel'), () => void send({ type: 'pair-cancel' }).then((r) => show(r.ok ? r.pending : null)), { 'data-test': 'cancel' })),
      );
      break;
    }
    case 'working':
      fill(ask, h('p', { 'data-test': 'working' }, t('connect.working')));
      break;
    case 'paired':
      fill(ask, h('p', { class: 'note', 'data-test': 'paired' }, t('connect.done', { name: p.name ?? host })), h('p', { class: 'muted' }, t('connect.next')));
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
  const said = p ? `${p.target}|${p.at}|${p.state}` : '';
  if (said !== shown) {
    shown = said;
    show(p);
  }
};
void look();
setInterval(() => void look(), 1000);
statusPanel(panel);
