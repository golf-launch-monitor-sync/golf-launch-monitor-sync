// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tour window's bar says, and which buttons it offers (spec/prores.md). The extension's line on the tour's
 * page (`proLineOf`, `tourLine.*`) where its words fit the app as well; the app's own words (src/i18n) where they speak
 * of the extension or of a page that isn't his profile. Pure, so it is tested without a phone.
 *
 * As in the world ranking window, *Is this page yours?* is asked right here in the bar. *Send* and *Fetch all* only on
 * his profile, as on the extension's line; while a *Fetch all* run goes on, only how far it got and *Stop*.
 */

import type { ProView } from '@glmsync/browser/pro';
import { proLineOf, type LinePhase } from '@glmsync/browser/proView';
import type { TourView } from '@glmsync/browser/tours';
import { translator } from '@glmsync/browser/i18n';
import type { TourSite } from '@glmsync/provider-tours';
import { onProfile } from './toursPage.ts';
import type { Lang } from './text.ts';

export type { LinePhase };

/** The app's own words (src/i18n), as the bar needs them. */
export type AppText = (key: 'tours.find' | 'rankings.changed' | 'pro.pairFirst') => string;

export interface ToursBar {
  text: string;
  warn: boolean;
  send: boolean;
  fetchAll: boolean;
  stop: boolean;
  /** Ask *Is this page yours?* with yes and no, in the bar. */
  ask: boolean;
}

const none = { send: false, fetchAll: false, stop: false, ask: false };

/** `limit`: *Fetch all* was refused just now, today's runs being used up. */
export function toursBar(v: ProView | null, tour: TourView | null, site: TourSite, url: string | null, phase: LinePhase, limit: boolean, lang: Lang, app: AppText): ToursBar {
  const tr = translator(lang);
  if (!v) return { text: '', warn: false, ...none };
  if (!v.pairings.length) return { text: app('pro.pairFirst'), warn: true, ...none };
  if (v.question) {
    const targets = v.question.targets.join(', ') || [...new Set(v.pairings.map((p) => p.name))].join(', ');
    return { text: tr('pro.question', { site: v.question.siteName, name: v.question.name, targets }), warn: true, ...none, ask: true };
  }
  if (tour?.run) return { text: tr('tourLine.running', { done: tour.run.done, total: tour.run.total }), warn: false, ...none, stop: true };
  if (phase === 'changed_page') return { text: app('rankings.changed'), warn: true, ...none };
  const profile = onProfile(url);
  // Elsewhere on the site, before anything was done: where his profile is. After a run (it ends on a tournament's
  // page) the bar says how the send went.
  if (!profile && phase === 'ready') return { text: app('tours.find'), warn: false, ...none };
  const line = proLineOf(v, site, phase, tr);
  if (!line) return { text: app('pro.pairFirst'), warn: true, ...none };
  const text = limit && phase !== 'reading' ? tr('tourLine.limit') : line.text;
  return { text, warn: line.warn, send: profile && line.send, fetchAll: profile && phase !== 'reading', stop: false, ask: false };
}
