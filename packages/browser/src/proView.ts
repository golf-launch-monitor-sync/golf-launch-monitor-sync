// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What a professional's pages' state says, as text (spec/prores.md): the line the extension shows on the player's own
 * page of a world ranking, and a pairing's last answer. Pure, so it is tested without a browser. Little text: the line
 * sits on someone else's page.
 */

import { SITES, type RankingSite } from '@glmsync/provider-rankings';
import { formatWhen, type Lang, type T } from './i18n.ts';
import type { ProEntry, ProView } from './pro.ts';
import { errorText } from './view.ts';

/**
 * What the line on the page has just done: nothing yet, reading, sent (the view says how it went), a page it can't
 * read, or the extension itself couldn't take it (updated meanwhile, an error of its own).
 */
export type LinePhase = 'ready' | 'reading' | 'done' | 'changed_page' | 'error';

export interface ProLine {
  text: string;
  /** Offer *Send*. */
  send: boolean;
  /** Offer *Answer*: an app asks whether the page is the player's (answered in the extension's own page). */
  answer: boolean;
  warn: boolean;
}

const names = (v: ProView) => [...new Set(v.pairings.map((p) => p.name))].join(', ');

/** The line on a ranking's page; null when no app is connected for it (then the extension shows nothing there). */
export function proLineOf(v: ProView, site: RankingSite, phase: LinePhase, t: T): ProLine | null {
  if (!v.pairings.length) return null;
  const targets = names(v);
  if (phase === 'reading') return { text: t('proLine.reading'), send: false, answer: false, warn: false };
  if (phase === 'changed_page') return { text: t('proLine.changed'), send: false, answer: false, warn: true };
  if (phase === 'error') return { text: t('proLine.failed', { error: errorText(undefined, t) }), send: true, answer: false, warn: true };
  if (v.question?.site === site) return { text: t('proLine.ask', { targets: v.question.targets.join(', ') || targets }), send: false, answer: true, warn: true };
  if (phase === 'done') {
    const last = v.pairings.map((p) => p.last).filter((l) => l?.site === site);
    const failed = last.find((l) => l?.status === 'failed');
    if (failed) return { text: t('proLine.failed', { error: errorText(failed.error, t) }), send: true, answer: false, warn: true };
    if (last.some((l) => l?.status === 'other_account')) return { text: t('proLine.otherAccount', { targets }), send: false, answer: false, warn: true };
    if (last.some((l) => l?.status === 'rejected')) return { text: t('proLine.rejected'), send: true, answer: false, warn: false };
    const sent = v.pairings.filter((p) => p.last?.site === site && p.last.status === 'sent').map((p) => p.name);
    if (sent.length) return { text: t('proLine.sent', { targets: [...new Set(sent)].join(', ') }), send: false, answer: false, warn: false };
    if (last.some((l) => l?.status === 'not_due')) return { text: t('proLine.notDue', { targets }), send: true, answer: false, warn: false };
  }
  return { text: t('proLine.ready', { targets }), send: true, answer: false, warn: false };
}

/** One line about what an app last answered; null before anything was sent to it. */
export function proLastText(e: ProEntry, t: T, lang: Lang, now: number): string | null {
  const l = e.last;
  if (!l) return null;
  const at = Date.parse(l.at);
  const when = Number.isFinite(at) ? formatWhen(at, now, lang) : '–';
  const site = SITES[l.site]?.name ?? l.site;
  switch (l.status) {
    case 'sent':
      return t('pro.last.sent', { when, site, count: l.tournaments ?? 0 });
    case 'failed':
      return t('pro.last.failed', { when, site, error: errorText(l.error, t) });
    default:
      return t(`pro.last.${l.status}`, { when, site });
  }
}
