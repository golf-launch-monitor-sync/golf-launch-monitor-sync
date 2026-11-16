// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The pairing page: an app sends the player here with its address and a code in the fragment
 * (`#target=…&code=…`), which the browser sends to no server. With the extension installed, it takes
 * over (its content script read the fragment before this script ran) and this page says how it went.
 * Without it, the page offers the extension, or to connect this page itself.
 *
 * The code is taken out of the address as soon as it was used, so it doesn't stay in the history.
 */

import { BrowserClient, INSTALL_URL, storeFor } from '@glmsync/browser';
import { button, fill, h } from '@glmsync/browser/render';
import { $, client, t, texts } from './common.ts';

texts('pair.title');
const status = $('status');
const install = $('install');
const without = $('without');
const MARK = 'data-glmsync-extension';
const hasExtension = () => document.documentElement.hasAttribute(MARK);
const forgetCode = () => history.replaceState(null, '', location.pathname + location.search);
const line = (text: string, cls = '') => fill(status, h('p', { class: cls, 'data-test': 'pair-status' }, text));

const offer = BrowserClient.readFragment(location.hash);
let extensionMode = false;

function extensionTakesOver(): void {
  if (extensionMode) return;
  extensionMode = true;
  install.hidden = true;
  without.hidden = true;
  line(t('pair.extension'));
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
      break;
    case 'working':
      line(t('connect.working'));
      break;
    case 'paired':
      forgetCode();
      line(t('pair.paired', { name }), 'note');
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

function noExtension(target: { target: string; code: string; provider?: string }): void {
  if (extensionMode) return;
  line(t('pair.noExtension'));
  const store = storeFor(navigator.userAgent);
  install.hidden = false;
  fill(install,
    h('a', { class: 'button primary', href: store ?? INSTALL_URL, target: '_blank', rel: 'noopener', 'data-test': 'install' }, t('pair.install')),
    h('p', { class: 'muted small' }, t('pair.installHint')),
    store ? null : h('p', { class: 'muted small' }, t('pair.notInStores')),
  );
  const host = new URL(target.target).host;
  const connect = button(
    t('pair.useWeb', { host }),
    async () => {
      connect.disabled = true;
      line(t('connect.working'));
      const out = await client.offerPairing(target);
      if (out.ok) {
        forgetCode();
        location.assign('./app.html');
      } else {
        connect.disabled = false;
        line(t('pair.failed', { why: t(`connect.error.${out.error}`) }), 'note warn');
      }
    },
    { 'data-test': 'use-web' },
  );
  without.hidden = false;
  fill(without, h('h2', {}, t('pair.withoutTitle')), h('p', {}, t('pair.without')), h('p', { class: 'muted small' }, t('connect.what', { host })), h('div', { class: 'row' }, connect));
}

if (!offer) {
  forgetCode();
  line(t('pair.invalid'), 'note warn');
} else if (hasExtension()) {
  extensionTakesOver();
} else {
  line(t('pair.looking'));
  // The extension may still be installed while the page is open: it then marks the page and takes over.
  setTimeout(() => {
    if (!hasExtension()) noExtension(offer);
  }, 1500);
  const watch = setInterval(() => {
    if (hasExtension()) {
      clearInterval(watch);
      extensionTakesOver();
    }
  }, 1000);
}
