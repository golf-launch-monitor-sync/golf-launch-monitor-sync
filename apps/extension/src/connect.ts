// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The connect window: *Connect new*, step by step, the same for every service (`@glmsync/browser`'s wizard), one button
 * per step. (1) An app asks - the web app's pairing page handed over its code - by its address, and the tap on what to
 * connect (the offer's service; later more launch monitors) is the yes: the browser's own prompt for that one address
 * follows from the same click, and refused, the step stays with its sentence. Opened from the popup (`?new`) before any
 * app asked, it says where to start and waits. (2) The service's steps (Trackman: *Open the Trackman portal*, small
 * *Enter a test code*; golf.de: open the History Sheet), (3) *Is this your account?*, (4) the first data shown plainly,
 * (5) *Back to …*, which closes this tab. Steps 2 to 5 are the status panel's (or the handicap record's, kind=hcp - also
 * when golf.de's page brought this window to the front for the yes).
 */

import type { ClientStatus, HcpView } from '@glmsync/browser';
import { button, fill, h, offerWizard, type OfferContext, type WizardMemory } from '@glmsync/browser/render';
import { PROVIDER_ID as GOLFDE } from '@glmsync/provider-golfde';
import { finished } from './finished.ts';
import type { Pending, Reply } from './messages.ts';
import { hcpPanel, heading, send, statusPanel, t } from './page.ts';

heading('connect.title');
const done = document.getElementById('done') as HTMLElement;
const ask = document.getElementById('ask') as HTMLElement;
const panel = document.getElementById('status') as HTMLElement;
// The handicap record's steps, above the launch monitor's.
const hcpRoot = document.createElement('div');
panel.before(hcpRoot);

/** Opened by *Connect new*: the first step, also when no app has asked yet. */
const fresh = new URLSearchParams(location.search).has('new');

let pendingNow: Pending | null = null;
let statusNow: ClientStatus | null = null;
let hcpNow: HcpView | null = null;
const memory: WizardMemory = { walked: false };
/** The browser's prompt for the app's address is open (a second tap meanwhile asks nothing more). */
let requesting = false;
/** The yes with the service is on its way. */
let choosing = false;
/** What went wrong with the last answer of the background, said on the step. */
let failure: string | null = null;
const panels: { lm?: { refresh(): Promise<void> }; hcp?: { refresh(): Promise<void> } } = {};

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

/** The first step while the pairing doesn't stand yet; null once it does (or there is nothing to start here). */
function offerState(p: Pending | null): Pick<OfferContext, 'state' | 'error'> | null {
  if (!p) return fresh ? { state: 'none' } : null;
  switch (p.state) {
    case 'asking':
      return { state: choosing ? 'working' : 'asking', error: failure };
    case 'working':
      return { state: 'working' };
    case 'failed':
      return { state: 'none', error: p.error === 'denied' ? t('connect.denied', { host: p.host }) : t(`connect.error.${p.error ?? 'refused'}` as Parameters<typeof t>[0]) };
    case 'cancelled':
      return { state: 'none' };
    case 'paired':
      // Paired, but the panel hasn't heard yet: still "connecting", not an overview without the new app.
      return (p.kind === 'hcp' ? hcpNow && !hcpNow.pairings.length : statusNow && !statusNow.pairings.length) ? { state: 'working' } : null;
    default:
      return null;
  }
}

/** What can be connected for the offer: its own service when it named one, else this version's. */
function services(p: Pending | null): OfferContext['services'] {
  if (p?.kind === 'hcp') return [{ id: GOLFDE, name: 'golf.de' }];
  const own = statusNow?.provider ?? { id: 'trackman', name: 'Trackman' };
  return p?.provider && p.provider !== own.id ? [{ id: p.provider, name: p.provider }] : [{ id: own.id, name: own.name }];
}

function apply(r: Reply): void {
  if (r.ok) {
    failure = null;
    if (r.pending !== undefined) pendingNow = r.pending;
  } else failure = t('last.failed', { error: t('error.error') });
  draw();
}

function draw(): void {
  const p = pendingNow;
  const offer = offerState(p);
  if (offer) {
    memory.walked = true;
    fill(
      ask,
      offerWizard(
        { t, ...offer, kind: p?.kind ?? 'lm', ...(p ? { host: p.host } : {}), services: services(p) },
        {
          cancel: () => {
            void send({ type: 'pair-cancel' }).then(apply);
          },
          choose: (id) => {
            if (!p || requesting || choosing) return;
            // The tap is the yes, and the browser's prompt needs this very click. Then what the browser holds decides
            // (a permission given before counts); refused, the step stays and says so (the background checks again
            // before pairing).
            const origins = [`${new URL(p.target).origin}/*`];
            const refused = () => {
              requesting = false;
              failure = t('connect.denied', { host: p.host });
              draw();
            };
            const pair = () => {
              requesting = false;
              choosing = true;
              failure = null;
              draw();
              void send({ type: 'pair-confirm', provider: id }).then((r) => {
                choosing = false;
                apply(r);
                // The next step is the panel's: it hears of the new pairing now, not at its next look.
                void panels.lm?.refresh();
                void panels.hcp?.refresh();
              });
            };
            const check = () => chrome.permissions.contains({ origins }).then((has) => (has ? pair() : refused()), refused);
            requesting = true;
            try {
              chrome.permissions.request({ origins }).then(check, check);
            } catch {
              void check();
            }
          },
        },
      ),
    );
  } else fill(ask);
  // The first step stands alone; then only the service asked for (the handicap record, or the launch monitor).
  const lmHidden = !!offer || isHcp() || (!!statusNow && !statusNow.pairings.length && !!hcpNow && hcpNow.pairings.length > 0);
  panel.hidden = lmHidden;
  hcpRoot.hidden = !!offer;
  // The steps end with their own *Back to …*; a window opened when everything was done already just says so.
  const now = !offer && !isHcp() && !memory.walked && finished(p, statusNow);
  fill(done, now ? h('div', { class: 'note', 'data-test': 'finished', role: 'status' }, h('p', {}, t('connect.finished')), h('div', { class: 'row' }, button(t('connect.close'), () => void closeTab(), { class: 'primary', 'data-test': 'close' }))) : null);
}

// Another app's page may hand over a new code while this window is open: it shows the newest request.
let shown = '';
const look = async () => {
  const r = await send({ type: 'pending' });
  const p = r.ok ? (r.pending ?? null) : pendingNow;
  const said = p ? `${p.target}|${p.at}|${p.state}` : '';
  pendingNow = p;
  if (said !== shown) {
    shown = said;
    failure = null;
  }
  draw();
};
void look();
setInterval(() => void look(), 1000);
const lm = statusPanel(panel, {
  memory,
  back: () => void closeTab(),
  onStatus: (s) => {
    statusNow = s;
    draw();
  },
});
panels.lm = lm;
panels.hcp = hcpPanel(hcpRoot, {
  back: () => void closeTab(),
  onView: (v) => {
    hcpNow = v;
    draw();
  },
});
