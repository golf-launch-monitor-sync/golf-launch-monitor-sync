// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * golf.de in the app's own window (spec/hcp.md, *A client that only observes*): which pages the window shows, on
 * which the page script reads along, and what a message from it may say. Pure, so the rules are tested; the page
 * script (scripts/golfde-page.mjs builds it from @glmsync/provider-golfde/page) runs this file's `onReadPage` inside
 * golf.de's page too, so nothing here may need more than the page has.
 *
 * The window loads golf.de as this phone's web view is - its own engine, its own user agent, no header added - and
 * the player signs in there themselves. The app sends golf.de nothing of its own: what it learns is what golf.de's
 * page loaded when the player opened it.
 */

import { EVENT_PAGE_MATCHES, HISTORY_SHEET_URL, PAGE_MATCHES, PAGE_ORIGIN, readSeen, type Seen } from '@glmsync/provider-golfde';

export { HISTORY_SHEET_URL };

/** What the page script posts (and nothing else counts): its tag, which page posted, and what it made of an answer. */
export const GOLFDE_MESSAGE = 'golfde-seen';
const PAGE_ID = /^[0-9a-f]{16,32}$/;
const MAX_MESSAGE = 1_000_000;

/** The extension's matches as patterns: the very same pages, nowhere else (a `*` stands for anything). */
const asPattern = (m: string) => new RegExp(`^${m.replace(/[.?+^$()[\]{}|\\/]/g, '\\$&').replace(/\*/g, '.*')}$`);
const READ_PAGES = PAGE_MATCHES.map(asPattern);
const CALENDAR_PAGES = EVENT_PAGE_MATCHES.map(asPattern);

/** Whether the page script reads along on this page: golf.de's *Mein Bereich* and its club tournaments, as in the extension. */
export function onReadPage(href: unknown): boolean {
  return typeof href === 'string' && href.length <= 4096 && READ_PAGES.some((re) => re.test(href));
}

function httpsHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** golf.de's own sites (www, login …): the pages the window shows, and the only ones a message is taken from. */
export function fromGolfde(url: unknown): boolean {
  const h = typeof url === 'string' ? httpsHost(url) : null;
  return !!h && (h === 'golf.de' || h.endsWith('.golf.de'));
}

/**
 * Where golf.de's sign-in may send a player who picks Google or Apple: shown in the window so it can finish there,
 * though in an app's window it often doesn't (the app says so; e-mail and password work).
 */
const SIGN_IN_HOSTS = new Set(['appleid.apple.com', 'idmsa.apple.com', 'accounts.google.com']);
const isSignInPage = (url: string) => SIGN_IN_HOSTS.has(httpsHost(url) ?? '');

const pageMayLoad = (url: string) => fromGolfde(url) || isSignInPage(url) || url === 'about:blank';

/** A page's own frames (a consent banner's, a captcha's): only over https, or its blank ones. */
function frameMayLoad(url: string): boolean {
  return url === 'about:blank' || url === 'about:srcdoc' || httpsHost(url) !== null;
}

/**
 * Where a new window golf.de's page opens (`target=_blank`, `window.open`) goes: into this same window when the
 * window may show it, else nowhere (null). Never into the system's browser, where the reading along isn't.
 */
export function openInGolfdeWindow(url: unknown): string | null {
  return typeof url === 'string' && url !== 'about:blank' && pageMayLoad(url) ? url : null;
}

/** A navigation as the web view asks about it (react-native-webview's `onShouldStartLoadWithRequest`). */
export interface Navigation {
  url: string;
  isTopFrame?: boolean;
}

/**
 * What the golf.de window hands its web view. Every load is decided here, so `originWhitelist` lets everything
 * through (react-native-webview gives a URL that misses it to the system's browser, frames included); a link
 * elsewhere simply doesn't open.
 */
export const golfdeWindowRules = {
  originWhitelist: ['*'],
  onShouldStartLoadWithRequest: (req: Navigation): boolean => (req.isTopFrame === false ? frameMayLoad(req.url) : pageMayLoad(req.url)),
};

/**
 * The window nobody sees, for a run by itself while the app is open (spec 1.17.0; lib/autoFetch.ts): its top frame
 * only on the pages the page script reads along on, its frames as in the player's window. Anything else - golf.de's
 * sign-in, Google's or Apple's, golf.de's start page - doesn't load: this window never signs in, and a page that leads
 * elsewhere ends its run (`refused`, called with nothing of the address).
 */
export function unseenWindowRules(refused: () => void) {
  return {
    originWhitelist: ['*'],
    onShouldStartLoadWithRequest: (req: Navigation): boolean => {
      if (req.isTopFrame === false) return frameMayLoad(req.url);
      if (req.url === 'about:blank' || onReadPage(req.url)) return true;
      try {
        refused();
      } catch {
        // the caller's trouble is its own; the page still doesn't load
      }
      return false;
    },
  };
}

/** A new id for a page the script runs in: results of a page go to the account that page named (HcpClient.see). */
export function pageId(random: (n: number) => Uint8Array): string {
  return Array.from(random(9), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A message from the window, read strictly: only from a golf.de page, only in the page script's shape, and what was
 * seen read again as the extension's side reads it (a page can post anything). null: not one.
 */
export function readGolfdeMessage(pageUrl: unknown, data: unknown): { page: string; seen: Seen } | null {
  if (!fromGolfde(pageUrl) || httpsHost(String(pageUrl)) !== new URL(PAGE_ORIGIN).hostname) return null;
  if (typeof data !== 'string' || data.length > MAX_MESSAGE) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { glmsync?: unknown; page?: unknown; seen?: unknown };
  if (m.glmsync !== GOLFDE_MESSAGE || typeof m.page !== 'string' || !PAGE_ID.test(m.page)) return null;
  const seen = readSeen(m.seen);
  return seen ? { page: m.page, seen } : null;
}

// ---------------------------------------------------------------------------
// One tournament from golf.de's page (spec/hcp.md, *Taking one tournament*, 1.19.0)
// ---------------------------------------------------------------------------

/** What the page script posts about a tournament's page: whether to offer taking it, and on the tap what it read. */
export const EVENT_MESSAGE = 'golfde-event';
/** The function the page script gives golf.de's page for the tap: it reads the page's lines now and posts them. */
export const TAKE_FUNCTION = '__glmsyncGolfdeTake';

/** Whether the page script looks for a tournament here: golf.de's tournament calendar, as in the extension. */
export function onCalendarPage(href: unknown): boolean {
  return typeof href === 'string' && href.length <= 4096 && CALENDAR_PAGES.some((re) => re.test(href));
}

/** The script the window injects on the player's tap: the page reads its tournament now and posts it. */
export function takeScript(): string {
  return `(function () { try { var f = window[${JSON.stringify(TAKE_FUNCTION)}]; if (typeof f === 'function') f(); } catch (e) {} })(); true;`;
}

export type EventMessage =
  | { page: string; offer: boolean }
  | { page: string; event: object }
  | { page: string; refused: 'not_a_tournament' | 'changed_page' };

/**
 * A message about a tournament's page, read strictly: only from golf.de's own pages, only in the page script's shape.
 * The tournament itself is read again by `HcpClient.takeEvent` before it goes anywhere. null: not one.
 */
export function readEventMessage(pageUrl: unknown, data: unknown): EventMessage | null {
  if (!fromGolfde(pageUrl) || httpsHost(String(pageUrl)) !== new URL(PAGE_ORIGIN).hostname) return null;
  if (typeof data !== 'string' || data.length > 32_768) return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object') return null;
  const m = msg as { glmsync?: unknown; page?: unknown; offer?: unknown; event?: unknown; refused?: unknown };
  if (m.glmsync !== EVENT_MESSAGE || typeof m.page !== 'string' || !PAGE_ID.test(m.page)) return null;
  if (typeof m.offer === 'boolean') return { page: m.page, offer: m.offer };
  if (m.event && typeof m.event === 'object' && !Array.isArray(m.event)) return { page: m.page, event: m.event };
  if (m.refused === 'not_a_tournament' || m.refused === 'changed_page') return { page: m.page, refused: m.refused };
  return null;
}
