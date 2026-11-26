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
import { europeantour, type TourSite } from '@glmsync/provider-tours';
import type { OcsView } from '@glmsync/browser/ocs';
import type { OcsNote } from './ocsSession.ts';
import type { SeasonNote } from './seasonSession.ts';
import { onEtPage, onOcsOom, onOcsProfile, onProfile, onSeasonResults, tourSiteOf } from './toursPage.ts';
import type { Lang } from './text.ts';

export type { LinePhase };

/** The app's own words (src/i18n), as the bar needs them. */
export type AppText = (key: 'tours.find' | 'tours.findEt' | 'tours.findOcs' | 'tours.findSeason' | 'rankings.changed' | 'pro.pairFirst') => string;

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

const ET_SITES: readonly TourSite[] = europeantour.TOURS.map((t) => europeantour.SITE[t]);

/**
 * The bar on europeantour.com (DP World Tour, HotelPlanner Tour): *Send* on any page of his, no *Fetch all* (his results
 * page has the rounds). It speaks of the tour an app asks about, else of the one sent last, else of the address's - as
 * the extension's line on the site does.
 */
export function etBar(v: ProView | null, url: string | null, phase: LinePhase, sent: TourSite | null, lang: Lang, app: AppText): ToursBar {
  const tr = translator(lang);
  if (!v) return { text: '', warn: false, ...none };
  if (!v.pairings.length) return { text: app('pro.pairFirst'), warn: true, ...none };
  if (v.question) {
    const targets = v.question.targets.join(', ') || [...new Set(v.pairings.map((p) => p.name))].join(', ');
    return { text: tr('pro.question', { site: v.question.siteName, name: v.question.name, targets }), warn: true, ...none, ask: true };
  }
  if (phase === 'changed_page') return { text: app('rankings.changed'), warn: true, ...none };
  const page = onEtPage(url);
  if (!page && phase === 'ready') return { text: app('tours.findEt'), warn: false, ...none };
  const site = sent && ET_SITES.includes(sent) ? sent : europeantour.siteOfUrl(url);
  const line = proLineOf(v, site, phase, tr);
  if (!line) return { text: app('pro.pairFirst'), warn: true, ...none };
  return { text: line.text, warn: line.warn, send: page && line.send, fetchAll: false, stop: false, ask: false };
}

/** What a note of the LET's pages says, in the extension's words (`ocsLine.*`). */
function noteText(note: OcsNote, tr: ReturnType<typeof translator>): string {
  if (note.kind === 'oomRead') return tr('ocsLine.oomRead', { rank: note.rank });
  return tr(note.kind === 'noResults' ? 'ocsLine.noResults' : 'ocsLine.oomMissing');
}

/**
 * The bar on the LET and the LET Access Series: *Send* on her profile, and on the tour's Order of Merit once a profile
 * of this tour was read (her rank goes with it); no *Fetch all* (her profile has the rounds). What a read found (no
 * results, her rank, not on this table) stands in place of the line's words, as on the extension's line.
 */
export function ocsBar(v: ProView | null, kept: OcsView | null, site: TourSite, url: string | null, phase: LinePhase, note: OcsNote | null, lang: Lang, app: AppText): ToursBar {
  const tr = translator(lang);
  if (!v) return { text: '', warn: false, ...none };
  if (!v.pairings.length) return { text: app('pro.pairFirst'), warn: true, ...none };
  if (v.question) {
    const targets = v.question.targets.join(', ') || [...new Set(v.pairings.map((p) => p.name))].join(', ');
    return { text: tr('pro.question', { site: v.question.siteName, name: v.question.name, targets }), warn: true, ...none, ask: true };
  }
  if (phase === 'changed_page') return { text: app('rankings.changed'), warn: true, ...none };
  const page = onOcsProfile(url) || (onOcsOom(url) && !!kept?.who);
  if (!page && phase === 'ready') return { text: app('tours.findOcs'), warn: false, ...none };
  const line = proLineOf(v, site, phase, tr);
  if (!line) return { text: app('pro.pairFirst'), warn: true, ...none };
  const text = note && phase !== 'reading' ? noteText(note, tr) : line.text;
  return { text, warn: line.warn || note?.kind === 'oomMissing', send: page && line.send && phase !== 'reading', fetchAll: false, stop: false, ask: false };
}

/**
 * The bar on the season pages (PGA Tour and Korn Ferry Tour, LPGA Tour, Epson Tour): *Send* on his *Results* page, no
 * *Fetch all* (that page has the rounds). It speaks of the tour the page's address names (on pgatour.com the window's
 * other tour too, as his page has both). A tour no module reads, or a season with nothing to send yet, stands in place
 * of the line's words, as on the extension's line, and keeps *Send* for another pick.
 */
export function seasonBar(v: ProView | null, site: TourSite, url: string | null, phase: LinePhase, note: SeasonNote | null, lang: Lang, app: AppText): ToursBar {
  const tr = translator(lang);
  if (!v) return { text: '', warn: false, ...none };
  if (!v.pairings.length) return { text: app('pro.pairFirst'), warn: true, ...none };
  if (v.question) {
    const targets = v.question.targets.join(', ') || [...new Set(v.pairings.map((p) => p.name))].join(', ');
    return { text: tr('pro.question', { site: v.question.siteName, name: v.question.name, targets }), warn: true, ...none, ask: true };
  }
  if (phase === 'changed_page') return { text: app('rankings.changed'), warn: true, ...none };
  const page = onSeasonResults(url);
  if (!page && phase === 'ready') return { text: app('tours.findSeason'), warn: false, ...none };
  const line = proLineOf(v, (page && tourSiteOf(url)) || site, phase, tr);
  if (!line) return { text: app('pro.pairFirst'), warn: true, ...none };
  const text = note && phase !== 'reading' ? tr(note === 'otherTour' ? 'seasonLine.otherTour' : 'seasonLine.nothing') : line.text;
  return { text, warn: line.warn || !!note, send: page && line.send && phase !== 'reading', fetchAll: false, stop: false, ask: false };
}
