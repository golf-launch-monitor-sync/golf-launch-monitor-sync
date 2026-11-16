// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the clients say about a state, as text: the same in the extension's popup and the web app.
 * Pure, so it is tested without a browser; `render.ts` puts it on a page.
 */

import type { ImportResult, Notice } from '@glmsync/core';
import type { ClientStatus, Entry } from './client.ts';
import { formatTime, formatWhen, type Lang, type T } from './i18n.ts';
import type { MessageKey } from './messages.ts';

export function resultText(r: ImportResult | undefined, t: T): string {
  if (!r || (r.sessions === 0 && r.rounds === 0 && r.round_shots === 0)) {
    return t('result.nothing') + (r?.duplicates ? t('result.duplicates', { duplicates: r.duplicates }) : '');
  }
  return t('result.some', { sessions: r.sessions, shots: r.shots, rounds: r.rounds }) + (r.duplicates ? t('result.duplicates', { duplicates: r.duplicates }) : '');
}

export function noticeText(n: Notice, t: T, lang: Lang): string {
  const until = n.until ? Date.parse(n.until) : NaN;
  if (n.code === 'guard_limit' && Number.isFinite(until)) return t('notice.guard_limit_until', { time: formatTime(until, lang) });
  const key = `notice.${n.code}` as MessageKey;
  return t(key);
}

const ERRORS = new Set(['unreachable', 'unavailable', 'rate_limited', 'too_large', 'invalid_batch', 'bad_answer', 'provider_unknown']);

export function errorText(code: string | undefined, t: T): string {
  return t(`error.${code && ERRORS.has(code) ? code : 'error'}` as MessageKey);
}

/** One line about what a target last answered; null before anything happened. */
export function lastText(e: Entry, t: T, lang: Lang, now: number): string | null {
  const l = e.last;
  if (!l) return null;
  let what: string;
  switch (l.status) {
    case 'synced':
      what = resultText(l.result, t);
      break;
    case 'not_due':
      what = t('last.not_due', { name: e.name });
      break;
    case 'busy':
      what = t('last.busy');
      break;
    case 'other_account':
      what = t('last.other_account', { name: e.name });
      break;
    case 'told_expired':
      what = t('last.told_expired', { name: e.name });
      break;
    case 'cancelled':
      what = t('last.cancelled');
      break;
    case 'failed':
      what = t('last.failed', { error: errorText(l.error, t) });
      break;
    default:
      return null;
  }
  const at = Date.parse(l.at);
  return t('pairing.last', { when: Number.isFinite(at) ? formatWhen(at, now, lang) : '–', what });
}

export function historyText(e: Entry, t: T): string | null {
  if (e.history?.done === true && e.last_synced_at) return t('pairing.history.done');
  if (e.history?.done === false) return t('pairing.history.more');
  return null;
}

/** The toolbar icon's badge: "!" sign in, "?" answer "Is this you?", "×" another account. */
export function badge(s: Pick<ClientStatus, 'attention'>): { text: string; color: string } {
  switch (s.attention) {
    case 'sign_in':
      return { text: '!', color: '#c0392b' };
    case 'confirm':
      return { text: '?', color: '#d68910' };
    case 'other_account':
      return { text: '×', color: '#c0392b' };
    default:
      return { text: '', color: '#1e8449' };
  }
}
