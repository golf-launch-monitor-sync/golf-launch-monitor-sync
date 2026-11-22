// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The pairing page: an app sends the player here with its address and a code in the fragment
 * (`#target=…&code=…`), which the browser sends to no server. With the extension installed, it takes
 * over (its content script read the fragment before this script ran) and this page says how it went.
 * Without it, the page offers the extension and waits for it - every two seconds, up to five minutes:
 * install, leave the page open, and it pairs by itself (the extension reaches a page that was open when
 * it was installed). Or it connects this page itself, as *Connect new*'s first two steps (`@glmsync/browser`'s
 * wizard): allow the app, then what to connect; the rest follows on the page by hand (`app.html#connect`). In a
 * browser that can't run the extension (Safari, a phone's) that is the only way it offers.
 *
 * The code is taken out of the address as soon as it was used, so it doesn't stay in the history.
 *
 * The handicap record (kind=hcp, spec/hcp.md) is read along on golf.de's own pages: only the extension can do that,
 * so for it this page offers the extension and no way by hand.
 */

import { BrowserClient, canHaveExtension, INSTALL_URL, storeFor } from '@glmsync/browser';
import { fill, h, offerWizard, type OfferContext } from '@glmsync/browser/render';
import { $, client, t, texts } from './common.ts';

texts('pair.title');
const status = $('status');
const install = $('install');
const without = $('without');
const MARK = 'data-glmsync-extension';
const hasExtension = () => document.documentElement.hasAttribute(MARK);
const forgetCode = () => history.replaceState(null, '', location.pathname + location.search);
const line = (text: string, cls = '') => fill(status, h('p', { class: cls, 'data-test': 'pair-status' }, text));

/** Waiting for the extension to arrive: how often the page looks, and for how long (the code is good for ten). */
const WAIT_EVERY_MS = 2_000;
const WAIT_MAX_MS = 5 * 60_000;

const offer = BrowserClient.readFragment(location.hash);
let extensionMode = false;

function extensionTakesOver(): void {
  if (extensionMode) return;
  extensionMode = true;
  install.hidden = true;
  without.hidden = true;
  line(t('pair.extension'));
}

/**
 * The extension has the offer and its connect tab stands beside this page: this page has done its part and
 * closes itself (18 Nov: too many tabs) - which the browser allows only when the app opened it by script. Else
 * it says it may be closed, and goes on showing how the pairing goes.
 */
let handedOver = false;
let paired = false;
function handOver(): void {
  if (handedOver) return;
  handedOver = true;
  setTimeout(() => {
    window.close();
    // Still running 300 ms later: the page stayed (a browser may say `window.closed` and keep it open), so it says
    // it may be closed. A page that did close runs nothing more.
    setTimeout(() => {
      if (!paired) line(t('pair.handedOver'));
    }, 300);
  }, 1500);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window || event.origin !== location.origin) return;
  const s = (event.data as { glmsyncExtension?: { state?: unknown; name?: unknown; error?: unknown } } | null)?.glmsyncExtension;
  if (!s || typeof s.state !== 'string') return;
  extensionTakesOver();
  const name = typeof s.name === 'string' ? s.name : '';
  switch (s.state) {
    case 'asking':
      line(t('pair.extension'));
      handOver();
      break;
    case 'working':
      line(t('connect.working'));
      handOver();
      break;
    case 'paired':
      forgetCode();
      paired = true;
      line(t('pair.paired', { name }), 'note');
      handOver();
      break;
    case 'failed': {
      forgetCode();
      const why = s.error === 'denied' ? t('connect.denied', { host: offer ? new URL(offer.target).host : '' }) : t(`connect.error.${typeof s.error === 'string' ? s.error : 'refused'}` as Parameters<typeof t>[0]);
      line(t('pair.failed', { why }), 'note warn');
      break;
    }
    default:
      forgetCode();
      line(t('connect.gone'), 'note warn');
  }
});

/** Errors after which the same code can't be tried again (the player starts again in the app). */
const FINAL = new Set(['link', 'code', 'provider']);

/** This page connected by hand: steps 1 and 2 of *Connect new*. */
function byHand(target: { target: string; code: string; provider?: string }): void {
  const host = new URL(target.target).host;
  let state: OfferContext['state'] = 'asking';
  let error: string | null = null;
  const frame = h('div', {});
  const draw = () =>
    fill(
      frame,
      offerWizard(
        {
          t,
          state,
          kind: 'lm',
          host,
          services: [{ id: client.provider.id, name: client.provider.name }],
          error,
          allowLabel: t('pair.useWeb', { host }),
        },
        {
          allow: () => {
            state = 'allowed';
            draw();
          },
          cancel: () => {
            forgetCode();
            state = 'none';
            error = null;
            draw();
          },
          choose: (id) => {
            state = 'working';
            error = null;
            draw();
            client.offerPairing({ ...target, provider: target.provider ?? id }).then(
              (out) => {
                if (out.ok) {
                  forgetCode();
                  location.assign('./app.html#connect');
                  return;
                }
                error = t('pair.failed', { why: t(`connect.error.${out.error}`) });
                state = FINAL.has(out.error) ? 'none' : 'allowed';
                if (state === 'none') forgetCode();
                draw();
              },
              () => {
                error = t('pair.failed', { why: t('connect.error.unreachable') });
                state = 'allowed';
                draw();
              },
            );
          },
        },
      ),
    );
  draw();
  without.hidden = false;
  fill(without, h('h2', {}, t('pair.withoutTitle')), h('p', { class: 'muted small' }, t('pair.without')), frame);
}

function noExtension(target: { target: string; code: string; provider?: string; kind?: 'hcp' }, possible: boolean, waiting: boolean): void {
  if (extensionMode) return;
  const hcp = target.kind === 'hcp';
  if (possible) {
    line(hcp ? t('pair.hcpNeedsExtension') : t('pair.noExtension'));
    const store = storeFor(navigator.userAgent);
    install.hidden = false;
    fill(install,
      h('a', { class: 'button primary', href: store ?? INSTALL_URL, target: '_blank', rel: 'noopener', 'data-test': 'install' }, t('pair.install')),
      h('p', { class: 'muted small', 'data-test': 'waiting' }, waiting ? t('pair.waiting') : t('pair.waitOver')),
      store ? null : h('p', { class: 'muted small' }, t('pair.notInStores')),
    );
  } else {
    line(hcp ? t('pair.hcpNeedsExtension') : t('pair.noExtensionHere'));
    install.hidden = true;
  }
  // golf.de can only be read along by the extension: no connecting this page instead.
  if (hcp) {
    without.hidden = true;
    return;
  }
  // Drawn once: the waiting above may say "stopped" later without starting the steps again.
  if (!without.hidden) return;
  byHand(target);
}

if (!offer) {
  forgetCode();
  line(t('pair.invalid'), 'note warn');
} else if (hasExtension()) {
  extensionTakesOver();
} else if (!canHaveExtension(navigator.userAgent)) {
  noExtension(offer, false, false);
} else {
  line(t('pair.looking'));
  // The extension may still be installed while the page is open: it then marks the page and takes over.
  setTimeout(() => {
    if (!hasExtension()) noExtension(offer, true, true);
  }, 1500);
  const started = Date.now();
  const watch = setInterval(() => {
    if (hasExtension()) {
      clearInterval(watch);
      extensionTakesOver();
    } else if (Date.now() - started >= WAIT_MAX_MS) {
      clearInterval(watch);
      noExtension(offer, true, false);
    }
  }, WAIT_EVERY_MS);
}
