// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own page of a world ranking in the app's own window (spec/prores.md): the OWGR for men, the Rolex
 * Women's World Golf Rankings for women. Which pages the window shows, how the app asks the page script to read the
 * page the player has open, and what a message from it may say. Pure, so the rules are tested; the page script
 * (scripts/rankings-page.mjs builds it) runs this file's helpers inside the site's page too, so nothing here may need
 * more than the page has.
 *
 * The window loads the site as this phone's web view is - its own engine, its own user agent, no header added. The
 * player searches for their name there and opens their page; nothing is read until they tap *Send* in the app's bar,
 * and then only what the page shows (`@glmsync/provider-rankings`, the extension's very reading). The app sends the
 * sites nothing of its own.
 */

import { checkPage, playerPageOf, SITES, type ProPage, type RankingSite } from '@glmsync/provider-rankings';

export { SITES, playerPageOf, type RankingSite };

/** What the page script posts (and nothing else counts): its tag, the app's ask it answers, and the page or why not. */
export const RANKING_MESSAGE = 'ranking-page';
/** The function the page script gives the page, which the app calls on *Send* (`readScript`). */
export const READ_FUNCTION = '__glmsyncReadRanking';
/** How long the page script waits for the page's table of tournaments (OWGR's comes a moment after the page). */
export const TABLE_WAIT_MS = 15_000;
/** How long the app waits for the page script's answer before it says the read didn't work. */
export const ANSWER_MS = TABLE_WAIT_MS + 10_000;
const ASK = /^[0-9a-f]{16,32}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_MESSAGE = 1_000_000;

function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The sites' own hosts (with and without www): the pages the window shows. */
const HOSTS: ReadonlySet<string> = new Set(
  Object.values(SITES).flatMap((s) => {
    const h = new URL(s.origin).hostname;
    return [h, h.replace(/^www\./, '')];
  }),
);

/** A page of one of the two sites, over https. */
export function onRankingSite(url: unknown): boolean {
  const h = typeof url === 'string' && url.length <= 4096 ? httpsHost(url) : null;
  return !!h && HOSTS.has(h);
}

const pageMayLoad = (url: string) => onRankingSite(url) || url === 'about:blank';

/** A page's own frames (a consent banner's, a chart's): only over https, or its blank ones. */
function frameMayLoad(url: string): boolean {
  return url === 'about:blank' || url === 'about:srcdoc' || httpsHost(url) !== null;
}

/**
 * Where a new window the site opens (`target=_blank`, `window.open`) goes: into this same window when the window may
 * show it, else nowhere (null). Never into the system's browser.
 */
export function openInRankingsWindow(url: unknown): string | null {
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
 * tour's site, a sponsor's - simply doesn't open.
 */
export const rankingsWindowRules = {
  originWhitelist: ['*'],
  onShouldStartLoadWithRequest: (req: Navigation): boolean => (req.isTopFrame === false ? frameMayLoad(req.url) : pageMayLoad(req.url)),
};

/**
 * A new ask: the page script's answer names it, so a message the app didn't ask for is never taken. No secret (the page
 * sees it when it is called): it only ties an answer to the tap it answers.
 */
export function askId(random: (n: number) => Uint8Array = someRandom): string {
  return Array.from(random(9), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The runtime's random source where it has one (Hermes may not), else Math.random - enough for an ask. */
function someRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  try {
    if (c && typeof c.getRandomValues === 'function') return c.getRandomValues(out);
  } catch {
    // fall through
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** The player's day (the ranking's `as_of`: neither site names its ranking's day), on this phone's clock. */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The script the app injects on *Send*: it only calls the page script's function, with the ask and the day. */
export function readScript(ask: string, day: string): string | null {
  if (!ASK.test(ask) || !DAY.test(day)) return null;
  return `(function(){try{var f=window[${JSON.stringify(READ_FUNCTION)}];if(typeof f==='function')f(${JSON.stringify(ask)},${JSON.stringify(day)});}catch(e){}})();true;`;
}

/** Whether a call of the page script's function is one the app could have made. */
export function callFits(ask: unknown, day: unknown): ask is string {
  return typeof ask === 'string' && ASK.test(ask) && typeof day === 'string' && DAY.test(day);
}

export type RankingAnswer = { ok: true; page: ProPage } | { ok: false; why: 'not_player_page' | 'changed_page' };

/**
 * A message from the window, read strictly: only from a player's page of the two sites, only in the page script's
 * shape, only answering the app's open ask, and the page read again as the extension's side reads it (a page can
 * post anything) - and only of the player whose page the window shows. null: not one.
 */
export function readRankingMessage(pageUrl: unknown, data: unknown, ask: string | null): RankingAnswer | null {
  if (!ask || !onRankingSite(pageUrl)) return null;
  if (typeof data !== 'string' || data.length > MAX_MESSAGE) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { glmsync?: unknown; ask?: unknown; page?: unknown; why?: unknown };
  if (m.glmsync !== RANKING_MESSAGE || m.ask !== ask) return null;
  if (m.why === 'not_player_page' || m.why === 'changed_page') return { ok: false, why: m.why };
  const at = playerPageOf(pageUrl);
  const page = checkPage(m.page);
  if (!at) return { ok: false, why: 'not_player_page' };
  // The window moved on to someone else's page meanwhile: nothing of it is taken.
  if (!page || page.site !== at.site || page.id !== at.id) return null;
  return { ok: true, page };
}

/** The address kept to open the window there next time: only a player's page of the two sites. */
export function keptPage(url: unknown): string | null {
  return typeof url === 'string' && url.length <= 2048 && playerPageOf(url) ? url : null;
}
