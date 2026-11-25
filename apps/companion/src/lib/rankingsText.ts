// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the world ranking window's bar says, and which buttons it offers (spec/prores.md). The extension's line on the
 * page (`proLineOf`) where its words fit the app as well; the app's own words (src/i18n) where they speak of the
 * extension or of a page that isn't the player's yet. Pure, so it is tested without a phone.
 *
 * One difference from the extension: when an app asks whether the page is the player's, the question is asked right
 * here, in the app's own bar - the site's page can't reach it, so it needs no second place as the extension's does.
 */

import type { ProView } from '@glmsync/browser/pro';
import { proLineOf, type LinePhase } from '@glmsync/browser/proView';
import { translator } from '@glmsync/browser/i18n';
import { playerPageOf } from './rankingsPage.ts';
import type { Lang } from './text.ts';

export type { LinePhase };

/** The app's own words (src/i18n), as the bar needs them. */
export type AppText = (key: 'rankings.find' | 'rankings.changed' | 'pro.pairFirst') => string;

export interface RankingsBar {
  text: string;
  warn: boolean;
  /** Offer *Send* (only on a player's page, never while reading or asking). */
  send: boolean;
  /** Ask *Is this page yours?* with yes and no, in the bar. */
  ask: boolean;
}

export function rankingsBar(v: ProView | null, url: string | null, phase: LinePhase, lang: Lang, app: AppText): RankingsBar {
  const tr = translator(lang);
  // Not read yet (or unreadable: the window says so beside it): nothing to offer, nothing wrong to say.
  if (!v) return { text: '', warn: false, send: false, ask: false };
  if (!v.pairings.length) return { text: app('pro.pairFirst'), warn: true, send: false, ask: false };
  if (v.question) {
    const targets = v.question.targets.join(', ') || [...new Set(v.pairings.map((p) => p.name))].join(', ');
    return { text: tr('pro.question', { site: v.question.siteName, name: v.question.name, targets }), warn: true, send: false, ask: true };
  }
  const at = playerPageOf(url);
  if (!at) return { text: app('rankings.find'), warn: false, send: false, ask: false };
  if (phase === 'changed_page') return { text: app('rankings.changed'), warn: true, send: false, ask: false };
  const line = proLineOf(v, at.site, phase, tr);
  if (!line) return { text: app('pro.pairFirst'), warn: true, send: false, ask: false };
  return { text: line.text, warn: line.warn, send: line.send, ask: false };
}
