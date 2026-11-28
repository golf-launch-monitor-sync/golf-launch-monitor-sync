// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page behind the universal links (`link/pair/`, `link/sync/`, since spec 1.27.0 `link/signin/`; spec/deep-links.md, *Universal links*). It comes up
 * only where the phone didn't open the companion app for the address: it offers to open it by its own scheme and the
 * way to install it. On a computer a pair link goes on to the pairing page. The keys stay in the fragment, which
 * reaches no server; nothing here sends anything anywhere.
 */

import { fill, h } from '@glmsync/browser/render';
import { $, t, texts } from './texts.ts';
import { COMPANION_APK_URL, COMPANION_IOS_URL, linkPage } from './linkPage.ts';

texts('link.title');
const main = $('link');
// The pairing page beside this one: the site's root is what comes before `/link/`.
const pairPage = `${location.href.split('#')[0]!.split('/link/')[0]}/pair`;
const page = linkPage(location.href, navigator.userAgent, pairPage);

switch (page.show) {
  case 'forward':
    fill(main, h('p', { 'data-test': 'link-status' }, t('link.forwarding')));
    location.replace(page.to);
    break;
  case 'phone':
    fill(
      main,
      h('p', { 'data-test': 'link-status' }, t('link.notInstalled')),
      h('p', {}, h('a', { class: 'button', href: page.open, 'data-test': 'link-open' }, t('link.open'))),
      h('p', {}, page.platform === 'android'
        ? h('a', { href: COMPANION_APK_URL, 'data-test': 'link-install' }, t('link.installAndroid'))
        : h('a', { href: COMPANION_IOS_URL, 'data-test': 'link-install' }, t('link.installIos'))),
      h('p', { class: 'muted small' }, t('link.again')),
    );
    break;
  case 'computer-sync':
    fill(main, h('p', { 'data-test': 'link-status' }, t('link.computerSync')));
    break;
  case 'computer-signin':
    fill(main, h('p', { 'data-test': 'link-status' }, t('link.computerSignin')));
    break;
  default:
    fill(main, h('p', { class: 'note warn', 'data-test': 'link-status' }, t('link.invalid')));
}
