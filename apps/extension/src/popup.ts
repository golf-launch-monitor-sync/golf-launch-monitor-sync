// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The toolbar popup. Its main view: *Connect new* and the list of connections (Trackman's account, golf.de's record,
 * a pairing in test mode), each with where it stands. A row opens its details: the sign-in, the connected apps, the
 * guard's counts - or, while a connection isn't set up yet, its steps (the wizard), whose *Back to …* closes the popup.
 * *Connect new* opens the connect window at its first step.
 */

import { connectionOfHcp, connectionsOfStatus, sortConnections, type ClientStatus, type HcpView } from '@glmsync/browser';
import { backLink, endedNotes, fill, h, renderConnections } from '@glmsync/browser/render';
import { hcpPanel, heading, lang, send, statusPanel, t } from './page.ts';

heading('app.name');

type View = 'list' | 'lm' | 'hcp';
const listRoot = document.getElementById('list') as HTMLElement;
const boxes: Record<Exclude<View, 'list'>, HTMLElement> = { lm: document.getElementById('lm') as HTMLElement, hcp: document.getElementById('hcp-box') as HTMLElement };
const notes = h('div', {});
const rows = h('div', {});
listRoot.append(notes, rows);

let view: View = 'list';
let status: ClientStatus | null = null;
let hcpView: HcpView | null = null;
let first = true;
/** *Connect new* couldn't open its window (said until the next try). */
let openFailed = false;

function show(next: View): void {
  view = next;
  listRoot.hidden = view !== 'list';
  for (const [k, el] of Object.entries(boxes)) el.hidden = k !== view;
  drawList();
}

for (const el of Object.values(boxes)) fill(el.querySelector('.back-link') as HTMLElement, backLink(t, () => show('list')));

function drawList(): void {
  if (view !== 'list') return;
  const hcpRow = hcpView ? connectionOfHcp(hcpView) : null;
  const list = sortConnections([...(status ? connectionsOfStatus(status) : []), ...(hcpRow ? [hcpRow] : [])]);
  // An app that ended its connection leaves the list: the line says so here too.
  fill(
    notes,
    openFailed ? h('p', { class: 'note warn', role: 'alert', 'data-test': 'open-failed' }, t('last.failed', { error: t('error.error') })) : null,
    ...(status ? endedNotes(status.ended, t, lang, () => void send({ type: 'clear-ended' }).then(() => lm.refresh())) : []),
    ...(hcpView ? endedNotes(hcpView.ended, t, lang, () => void send({ type: 'hcp-clear-ended' }).then(() => hcp.refresh())) : []),
  );
  renderConnections(rows, list, { t }, {
    add: () =>
      void send({ type: 'open-connect' }).then((r) => {
        openFailed = !r.ok;
        if (r.ok) window.close();
        else drawList();
      }),
    open: (id) => show(id === 'hcp' ? 'hcp' : 'lm'),
  });
}

const lm = statusPanel(document.getElementById('status') as HTMLElement, {
  onPortal: () => window.close(),
  back: () => window.close(),
  onStatus: (s) => {
    status = s;
    // A test's question waits for an answer in the details (it came from a code typed there).
    if (first && s.testAsking) show('lm');
    first = false;
    drawList();
  },
});
const hcp = hcpPanel(document.getElementById('hcp') as HTMLElement, {
  onGolfde: () => window.close(),
  back: () => window.close(),
  onView: (v) => {
    hcpView = v;
    drawList();
  },
});
show('list');
