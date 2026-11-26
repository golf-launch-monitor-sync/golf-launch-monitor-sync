// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the handicap record's state says on the phone. Where the extension's words fit the app as well (the line on
 * golf.de's page, what a target last answered, a connection a target ended), the app says the very same, from
 * @glmsync/browser; the rest is the app's own (src/i18n). Pure, so it is tested without a phone.
 */

import type { HcpEntry, HcpView } from '@glmsync/browser/hcp';
import { hcpLastText, lineOf, type Line } from '@glmsync/browser/hcpView';
import { formatDate, translator } from '@glmsync/browser/i18n';
import type { Lang } from './text.ts';

/** The line under the golf.de window, as the extension shows it on golf.de's page; null without a connection. */
export function hcpLine(v: HcpView, lang: Lang): Line | null {
  return lineOf(v, translator(lang));
}

/** A run of *Fetch all* by itself under way (spec 1.17.0): its window is behind the screen, so the home page says it. */
export function autoRunning(v: Pick<HcpView, 'fetch_all' | 'run'>): boolean {
  return v.fetch_all === 'running' && !!v.run?.auto;
}

/** What a target last answered; null before anything was sent. */
export function hcpLast(e: HcpEntry, lang: Lang, now: number): string | null {
  return hcpLastText(e, translator(lang), lang, now);
}

/** A connection a target ended (or a token it revoked), with its day. */
export function hcpEnded(e: HcpView['ended'][number], lang: Lang): string {
  const t = translator(lang);
  const at = Date.parse(e.at);
  return t(e.why === 'revoked' ? 'ended.revoked' : 'ended.disconnected', { name: e.name, date: Number.isFinite(at) ? formatDate(at, lang) : '–' });
}

/** The app's text (src/i18n) for a pairing that didn't work. */
export function pairErrorKey(error: string): string {
  switch (error) {
    case 'link':
      return 'link.invalid';
    case 'code':
      return 'error.codeInvalid';
    case 'provider':
      return 'error.providerUnknown';
    case 'unreachable':
      return 'error.targetUnreachable';
    case 'rate_limited':
      return 'error.targetBusy';
    case 'answer':
      return 'error.targetOdd';
    default:
      return 'error.generic';
  }
}
