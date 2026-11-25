// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages of a tour in the app's own window (spec/prores.md; `@glmsync/provider-tours`): which pages
 * the window shows, how the app asks the page script to read the page it has open, and what a message from it may say.
 * Pure, so the rules are tested; the page script (scripts/tours-page.mjs builds it) runs this file's helpers inside the
 * site's page too, so nothing here may need more than the page has.
 *
 * Today the Pro Golf Tour: on his profile the page script reads his ranking and his season's tournaments, on a
 * tournament's page only his own line of the final result (by the name of the profile read last) and of the field its
 * size - the snapshot with the others' names never leaves the page script. It reads only when the app asks: on his tap
 * on *Send* or *Fetch all*, and during a *Fetch all* run on each page the run opened. The app sends the site nothing of
 * its own.
 */

import { isTourSite, progolftour, TOUR_SITES, type TourSite } from '@glmsync/provider-tours';

/** What the page script posts (and nothing else counts): its tag, the app's ask it answers, and what it read or why not. */
export const TOUR_MESSAGE = 'tour-page';
/** The function the page script gives the page, which the app calls (`readScript`). */
export const READ_FUNCTION = '__glmsyncReadTour';
/** How long the page script waits for the page's table (the site fills the final result in a moment after the page). */
export const TABLE_WAIT_MS = 10_000;
/** How long the app waits for the page script's answer before it takes the read as failed. */
export const ANSWER_MS = TABLE_WAIT_MS + 10_000;
/**
 * The keeper's tab (`TourKeeper` of `@glmsync/browser/tours` ties a *Fetch all* run to the tab it started in): the app
 * has one window, so always this one.
 */
export const WINDOW = 1;
const ASK = /^[0-9a-f]{16,32}$/;
const MAX_MESSAGE = 1_000_000;
const MAX_WHO = 120;

function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The tours whose module the window's page script runs. DP World Tour and HotelPlanner Tour (europeantour.com) are read
 * in the extension only, so far: the window neither offers nor loads them until the page script reads them too.
 */
const APP_TOURS: readonly TourSite[] = ['tour:pro_golf_tour'];

/** Each tour's own hosts (from its `matches`, with and without www). */
const HOSTS: ReadonlyMap<string, TourSite> = new Map(
  APP_TOURS.flatMap((site) => (TOUR_SITES[site] ? [TOUR_SITES[site]] : [])).flatMap((info) =>
    info.matches.flatMap((m) => {
      const h = httpsHost(m.replace(/\*$/, ''));
      return h ? [[h, info.site] as const, [h.replace(/^www\./, ''), info.site] as const] : [];
    }),
  ),
);

/** The tour whose site this page is (over https); null for any other. */
export function tourSiteOf(url: unknown): TourSite | null {
  const h = typeof url === 'string' && url.length <= 4096 ? httpsHost(url) : null;
  return (h && HOSTS.get(h)) || null;
}

export const onTourSite = (url: unknown): boolean => tourSiteOf(url) !== null;

/** The tours the app's window opens, in the order offered. */
export const WINDOW_TOURS: readonly TourSite[] = APP_TOURS.filter(isTourSite);

const pageMayLoad = (url: string) => onTourSite(url) || url === 'about:blank';

/** A page's own frames (a consent banner's, a video's): only over https, or its blank ones. */
function frameMayLoad(url: string): boolean {
  return url === 'about:blank' || url === 'about:srcdoc' || httpsHost(url) !== null;
}

/** Where a new window the site opens goes: into this same window when it may show it, else nowhere (null). */
export function openInTourWindow(url: unknown): string | null {
  return typeof url === 'string' && url !== 'about:blank' && pageMayLoad(url) ? url : null;
}

/** A navigation as the web view asks about it (react-native-webview's `onShouldStartLoadWithRequest`). */
export interface Navigation {
  url: string;
  isTopFrame?: boolean;
}

/**
 * What the window hands its web view. Every load is decided here, so `originWhitelist` lets everything through
 * (react-native-webview gives a URL that misses it to the system's browser, frames included); a link elsewhere - a
 * sponsor's, the scoring service's - simply doesn't open.
 */
export const tourWindowRules = {
  originWhitelist: ['*'],
  onShouldStartLoadWithRequest: (req: Navigation): boolean => (req.isTopFrame === false ? frameMayLoad(req.url) : pageMayLoad(req.url)),
};

/** His profile on the Pro Golf Tour (the page *Send* and *Fetch all* start from). */
export const onProfile = (url: unknown): boolean => tourSiteOf(url) === progolftour.SITE && progolftour.profileOf(url) !== null;

/** The name `ownLine` looks for: the profile's, as the keeper has it; nothing else is taken. */
function whoFits(who: unknown): who is string | null {
  return who === null || (typeof who === 'string' && who.length >= 2 && who.length <= MAX_WHO && !/[\u0000-\u001f]/.test(who));
}

/**
 * The script the app injects to ask for a read: it only calls the page script's function, with the ask and - on a
 * tournament's page during a run - the name of his profile. null when the values aren't ones the app makes.
 */
export function readScript(ask: string, who: string | null): string | null {
  if (!ASK.test(ask) || !whoFits(who)) return null;
  return `(function(){try{var f=window[${JSON.stringify(READ_FUNCTION)}];if(typeof f==='function')f(${JSON.stringify(ask)},${JSON.stringify(who)});}catch(e){}})();true;`;
}

/** Whether a call of the page script's function is one the app could have made. */
export function callFits(ask: unknown, who: unknown): ask is string {
  return typeof ask === 'string' && ASK.test(ask) && whoFits(who);
}

export type Unread = progolftour.Unread['why'];
const UNREAD: ReadonlySet<string> = new Set(['changed_page', 'not_him', 'no_result']);

export type TourAnswer =
  | { ok: true; profile: progolftour.Profile }
  | { ok: true; key: string; line: progolftour.OwnLine }
  | { ok: true; key: string; unread: Unread }
  | { ok: false; why: 'not_player_page' | 'changed_page' };

/**
 * A message from the window, read strictly: only from a page of the tour's site, only in the page script's shape, only
 * answering the app's open ask, and what it read read again as the extension's side reads it (a page can post
 * anything) - a profile only of the profile the window shows, a line only of the tournament it shows. null: not one.
 */
export function readTourMessage(pageUrl: unknown, data: unknown, ask: string | null): TourAnswer | null {
  if (!ask || !onTourSite(pageUrl)) return null;
  if (typeof data !== 'string' || data.length > MAX_MESSAGE) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { glmsync?: unknown; ask?: unknown; why?: unknown; profile?: unknown; key?: unknown; line?: unknown; unread?: unknown };
  if (m.glmsync !== TOUR_MESSAGE || m.ask !== ask) return null;
  if (m.why === 'not_player_page' || m.why === 'changed_page') return { ok: false, why: m.why };
  const shown = progolftour.profileOf(pageUrl);
  if (m.profile !== undefined) {
    const p = progolftour.checkProfile(m.profile);
    // The window moved on to someone else's profile meanwhile: nothing of it is taken.
    return shown && p && p.player_id === shown.id ? { ok: true, profile: p } : null;
  }
  const key = typeof pageUrl === 'string' ? progolftour.resultKey(pageUrl) : null;
  if (!key || m.key !== key) return null;
  if (m.line !== undefined) {
    const line = progolftour.checkOwnLine(m.line);
    return line && line.key === key ? { ok: true, key, line } : null;
  }
  return typeof m.unread === 'string' && UNREAD.has(m.unread) ? { ok: true, key, unread: m.unread as Unread } : null;
}

/** The address kept to open the window there next time: only his profile on a tour's site. */
export function keptTourPage(url: unknown): string | null {
  return typeof url === 'string' && url.length <= 2048 && onProfile(url) ? url : null;
}
