// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The connect window: opened when the web app's pairing page hands over a code. It shows where the data would go and
 * asks the player; the browser's own prompt for that one address follows from the same click. Then connecting goes on
 * as steps with their progress, the same for every service (`@glmsync/browser`'s wizard): sign in, *Is this your
 * account?*, the first data shown plainly, and *Back to …* (which closes this tab). For a launch monitor the steps are
 * the status panel's; for the handicap record (kind=hcp) the golf.de steps - also when golf.de's page brought this
 * window to the front for the yes (*Confirm* on its line).
 */

import type { ClientStatus, HcpView } from '@glmsync/browser';
import { button, fill, h, type WizardMemory } from '@glmsync/browser/render';
import { finished } from './finished.ts';
import type { Pending } from './messages.ts';
import { hcpPanel, heading, send, statusPanel, t } from './page.ts';

heading('connect.title');
const done = document.getElementById('done') as HTMLElement;
const ask = document.getElementById('ask') as HTMLElement;
const panel = document.getElementById('status') as HTMLElement;
// The handicap record's steps, above the launch monitor's.
const hcpRoot = document.createElement('div');
panel.before(hcpRoot);

let pendingNow: Pending | null = null;
let statusNow: ClientStatus | null = null;
let hcpNow: HcpView | null = null;
const memory: WizardMemory = { walked: false };

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
  // Only the handicap record here (asked for it, or brought here by golf.de's page): no Trackman panel in the way.
  panel.hidden = isHcp() || (!!statusNow && !statusNow.pairings.length && !!hcpNow && hcpNow.pairings.length > 0);
  // The steps end with their own *Back to …*; a window opened when everything was done already just says so.
  const now = !isHcp() && !memory.walked && finished(pendingNow, statusNow);
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
      // What comes next is the steps' first one (sign in at the service).
      fill(ask, h('p', { class: 'note', 'data-test': 'paired' }, t('connect.done', { name: p.name ?? host })));
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
  memory,
  back: () => void closeTab(),
  onStatus: (s) => {
    statusNow = s;
    showDone();
  },
});
hcpPanel(hcpRoot, {
  back: () => void closeTab(),
  onView: (v) => {
    hcpNow = v;
    showDone();
  },
});
