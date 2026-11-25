// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages of a tour in the app's own window (spec/prores.md; `@glmsync/provider-tours`): which pages
 * the window shows, how the app asks the page script to read the page it has open, and what a message from it may say.
 * Pure, so the rules are tested; the page script (scripts/tours-page.mjs builds it) runs this file's helpers inside the
 * site's page too, so nothing here may need more than the page has.
 *
 * The Pro Golf Tour: on his profile the page script reads his ranking and his season's tournaments, on a tournament's
 * page only his own line of the final result (by the name of the profile read last) and of the field its size - the
 * snapshot with the others' names never leaves the page script. It reads only when the app asks: on his tap on *Send*
 * or *Fetch all*, and during a *Fetch all* run on each page the run opened.
 *
 * DP World Tour and HotelPlanner Tour (europeantour.com, one page per player for both): on each page of his the page
 * script reads what it shows (his ranks, his results with their rounds of the season picked, the statistics of the tour
 * picked) when the app asks - as the extension does, on each of his pages once it has loaded and again a moment after
 * he picks another season or tour in the page's own select (the page script only says that he picked, `PICKED`), and
 * on his tap on *Send*. Nothing on that site is anyone else's. The app sends the site nothing of its own.
 */

import { europeantour, isTourSite, progolftour, TOUR_SITES, type TourSite } from '@glmsync/provider-tours';

/** What the page script posts (and nothing else counts): its tag, the app's ask it answers, and what it read or why not. */
export const TOUR_MESSAGE = 'tour-page';
/** The function the page script gives the page, which the app calls (`readScript`). */
export const READ_FUNCTION = '__glmsyncReadTour';
/** How long the page script waits for the page's table (the site fills the final result in a moment after the page). */
export const TABLE_WAIT_MS = 10_000;
/** How long the app waits for the page script's answer before it takes the read as failed. */
export const ANSWER_MS = TABLE_WAIT_MS + 10_000;
/** After a pick in the page's own select, the site needs a moment to show the new table (as in the extension). */
export const AFTER_PICK_MS = 1500;
/**
 * The keeper's tab (`TourKeeper` of `@glmsync/browser/tours` ties a *Fetch all* run to the tab it started in): the app
 * has one window, so always this one.
 */
export const WINDOW = 1;
const ASK = /^[0-9a-f]{16,32}$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
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
 * The tours whose module the window's page script runs. The season pages (PGA Tour, Korn Ferry, LPGA, Epson:
 * `seasonPage`) and the LET's tours (`ocs`) are read in the extension only, so far: the window neither offers nor
 * loads them until the page script reads them too.
 */
const APP_TOURS: readonly TourSite[] = ['tour:pro_golf_tour', 'tour:dp_world', 'tour:hotelplanner'];
/** The two tours of europeantour.com: one site, one page per player for both. */
const ET_SITES: readonly TourSite[] = europeantour.TOURS.map((t) => europeantour.SITE[t]);
/** Whether a tour is one of europeantour.com's (its window reads each page of his, without *Fetch all*). */
export const isEt = (site: TourSite | null | undefined): boolean => !!site && ET_SITES.includes(site);

/** Each tour's own hosts (from its `matches`, with and without www); a host two tours share has both. */
const HOSTS: ReadonlyMap<string, readonly TourSite[]> = (() => {
  const out = new Map<string, TourSite[]>();
  for (const info of APP_TOURS.flatMap((site) => (TOUR_SITES[site] ? [TOUR_SITES[site]] : []))) {
    for (const m of info.matches) {
      const h = httpsHost(m.replace(/\*$/, ''));
      for (const host of h ? new Set([h, h.replace(/^www\./, '')]) : []) {
        const list = out.get(host) ?? [];
        if (!list.includes(info.site)) list.push(info.site);
        out.set(host, list);
      }
    }
  }
  return out;
})();

/**
 * The tour whose site this page is (over https); null for any other. On europeantour.com the tour the address names
 * (`?tour=…`), else the DP World Tour, the site's own default.
 */
export function tourSiteOf(url: unknown): TourSite | null {
  const h = typeof url === 'string' && url.length <= 4096 ? httpsHost(url) : null;
  const sites = (h && HOSTS.get(h)) || [];
  if (sites.length > 1 && sites.every(isEt)) return europeantour.siteOfUrl(url);
  return sites[0] ?? null;
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

/** A player's page on europeantour.com (any of its parts, either tour): read once it has loaded, and on *Send*. */
export const onEtPage = (url: unknown): boolean => isEt(tourSiteOf(url)) && europeantour.playerPageOf(url) !== null;

/** Whether the window of `site` shows this page's tour: europeantour.com's two tours share one window's pages. */
export function sameWindow(url: unknown, site: TourSite): boolean {
  const at = tourSiteOf(url);
  return at === site || (isEt(at) && isEt(site));
}

/** The name `ownLine` looks for: the profile's, as the keeper has it; nothing else is taken. */
function whoFits(who: unknown): who is string | null {
  return who === null || (typeof who === 'string' && who.length >= 2 && who.length <= MAX_WHO && !/[\u0000-\u001f]/.test(who));
}

const dayFits = (today: unknown): today is string | null | undefined => today === undefined || today === null || (typeof today === 'string' && DAY.test(today));

/**
 * The script the app injects to ask for a read: it only calls the page script's function, with the ask, - on a
 * tournament's page during a run - the name of his profile, and the player's day (europeantour.com's results take only
 * tournaments that ended before it). null when the values aren't ones the app makes.
 */
export function readScript(ask: string, who: string | null, today: string | null = null): string | null {
  if (!ASK.test(ask) || !whoFits(who) || !dayFits(today)) return null;
  return `(function(){try{var f=window[${JSON.stringify(READ_FUNCTION)}];if(typeof f==='function')f(${JSON.stringify(ask)},${JSON.stringify(who)},${JSON.stringify(today)});}catch(e){}})();true;`;
}

/** Whether a call of the page script's function is one the app could have made. */
export function callFits(ask: unknown, who: unknown, today?: unknown): ask is string {
  return typeof ask === 'string' && ASK.test(ask) && whoFits(who) && dayFits(today);
}

export type Unread = progolftour.Unread['why'];
const UNREAD: ReadonlySet<string> = new Set(['changed_page', 'not_him', 'no_result']);

export type TourAnswer =
  | { ok: true; profile: progolftour.Profile }
  | { ok: true; et: europeantour.EtRead }
  | { ok: true; key: string; line: progolftour.OwnLine }
  | { ok: true; key: string; unread: Unread }
  | { ok: false; why: 'not_player_page' | 'changed_page' };

/**
 * A message from the window, read strictly: only from a page of the tour's site, only in the page script's shape, only
 * answering the app's open ask, and what it read read again as the extension's side reads it (a page can post
 * anything) - a profile only of the profile the window shows, a line only of the tournament it shows, a read of
 * europeantour.com only of the player whose page it shows. null: not one.
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
  const m = msg as { glmsync?: unknown; ask?: unknown; why?: unknown; profile?: unknown; key?: unknown; line?: unknown; unread?: unknown; read?: unknown };
  if (m.glmsync !== TOUR_MESSAGE || m.ask !== ask) return null;
  if (m.why === 'not_player_page' || m.why === 'changed_page') return { ok: false, why: m.why };
  const et = onEtPage(pageUrl) ? europeantour.playerPageOf(pageUrl) : null;
  if (et) {
    const read = m.read !== undefined ? europeantour.checkRead(m.read) : null;
    // The window moved on to another player's page meanwhile: nothing of it is taken.
    return read && read.player_id === et.id ? { ok: true, et: read } : null;
  }
  if (m.read !== undefined) return null; // a read of europeantour.com from any other page
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

/**
 * The page script's note that he picked another season or tour in the page's own select (nothing read, nothing of
 * his): only from a player's page of europeantour.com, only in exactly that shape. The app then asks for a read.
 */
export function readPickMessage(pageUrl: unknown, data: unknown): boolean {
  if (!onEtPage(pageUrl) || typeof data !== 'string' || data.length > 200) return false;
  try {
    const m = JSON.parse(data) as unknown;
    return !!m && typeof m === 'object' && !Array.isArray(m) && Object.keys(m).length === 2 && (m as { glmsync?: unknown }).glmsync === TOUR_MESSAGE && (m as { picked?: unknown }).picked === true;
  } catch {
    return false;
  }
}

/** The address kept to open the window there next time: only his profile on a tour's site or his page on europeantour.com. */
export function keptTourPage(url: unknown): string | null {
  return typeof url === 'string' && url.length <= 2048 && (onProfile(url) || onEtPage(url)) ? url : null;
}
