// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Who may tell the background what. A message carries no proof of its own, so the background goes by
 * where it came from (`sender.url`, which the browser sets): the Trackman key only from the portal,
 * a pairing code only from the web app's pairing page, a bridge request only from a page's top frame
 * (the background then checks its origin is a paired target's: bridge.ts), what golf.de's page showed only
 * from the top frame of a page on golf.de, a world ranking's page only from the top frame of a player's page there, a tour's pages only from the top frame of
 * that tour's site (on europeantour.com only a player's page; a season page's from the top frame of the sites of
 * `seasonPage`; the LET's and LET Access Series' named by the message, checked by the background
 * against the page), and
 * the rest only from the extension's own pages. Pure, so it is
 * tested without a browser.
 */

import { PORTAL_ORIGIN } from '@glmsync/provider-trackman/portal';
import { PAIR_PATH, WEB_APP_ORIGIN } from '@glmsync/browser';
import { PAGE_ORIGIN as GOLFDE_ORIGIN } from '@glmsync/provider-golfde';
import { playerPageOf } from '@glmsync/provider-rankings';
import { europeantour, ocs, onSeasonSite, progolftour } from '@glmsync/provider-tours';
import { readBridgeRequest } from '@glmsync/spec';
import type { Message } from './messages.ts';

export type Source = 'portal' | 'pair-page' | 'golfde' | 'ranking' | 'tour' | 'europeantour' | 'season' | 'ocs' | 'target-page' | 'extension' | 'other';

export interface SenderLike {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
  frameId?: number | undefined;
}

function parse(url: string | undefined): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function sourceOf(sender: SenderLike, extensionId: string, extensionOrigin: string): Source {
  if (sender.id !== extensionId) return 'other';
  const u = parse(sender.url);
  if (!u) return 'other';
  if (u.origin === PORTAL_ORIGIN && sender.tab) return 'portal';
  if (u.origin === WEB_APP_ORIGIN && sender.tab && /^\/golf-launch-monitor-sync\/pair(?:\.html|\/(?:index\.html)?)?$/.test(u.pathname)) return 'pair-page';
  if (`${u.protocol}//${u.host}` === extensionOrigin.replace(/\/$/, '')) return 'extension';
  // golf.de's page (the relay content script): only its top frame, where the extension's scripts run.
  if (u.origin === GOLFDE_ORIGIN && sender.tab && sender.frameId === 0) return 'golfde';
  // A player's own page of a world ranking (rankings-content.ts): only its top frame, only such a page.
  if (playerPageOf(u.href) && sender.tab && sender.frameId === 0) return 'ranking';
  if (u.origin === progolftour.ORIGIN && sender.tab && sender.frameId === 0) return 'tour';
  // A player's own page on europeantour.com (europeantour-content.ts): only its top frame, only such a page.
  if (europeantour.playerPageOf(u.href) && sender.tab && sender.frameId === 0) return 'europeantour';
  // A site of the tours whose player page shows the season (season-content.ts): only its top frame.
  if (onSeasonSite(u.href) && sender.tab && sender.frameId === 0) return 'season';
  // The LET's and LET Access Series' pages (ocs-content.ts): only their top frame. Which of the two it is, the background
  // checks against the tour a message names.
  if (ocs.siteAt(u.href) && sender.tab && sender.frameId === 0) return 'ocs';
  // The bridge's content script, on some site's page: only its top frame, never the project's own site.
  if ((u.protocol === 'https:' || u.protocol === 'http:') && sender.tab && sender.frameId === 0 && u.origin !== WEB_APP_ORIGIN) return 'target-page';
  return 'other';
}

const FROM: Record<Message['type'], Source> = {
  'portal-key': 'portal',
  'pair-offer': 'pair-page',
  'pair-status': 'pair-page',
  status: 'extension',
  run: 'extension',
  confirm: 'extension',
  'retry-who': 'extension',
  unpair: 'extension',
  'export-log': 'extension',
  'clear-ended': 'extension',
  'forget-key': 'extension',
  'open-portal': 'extension',
  'switch-account': 'extension',
  bridge: 'target-page',
  pending: 'extension',
  'pair-confirm': 'extension',
  'open-connect': 'extension',
  'pair-cancel': 'extension',
  'test-fetch': 'extension',
  'test-confirm': 'extension',
  'test-end': 'extension',
  'golfde-seen': 'golfde',
  'golfde-line': 'golfde',
  'golfde-send': 'golfde',
  'golfde-confirm': 'golfde',
  'golfde-fetch-all': 'golfde',
  'golfde-step': 'golfde',
  'golfde-stop': 'golfde',
  'hcp-status': 'extension',
  'hcp-send': 'extension',
  'hcp-auto': 'extension',
  'hcp-unpair': 'extension',
  'hcp-clear-ended': 'extension',
  'hcp-confirm': 'extension',
  'open-golfde': 'extension',
  'ranking-line': 'ranking',
  'ranking-send': 'ranking',
  'ranking-answer': 'ranking',
  'tour-seen': 'tour',
  'tour-line': 'tour',
  'tour-send': 'tour',
  'tour-fetch-all': 'tour',
  'tour-step': 'tour',
  'tour-stop': 'tour',
  'tour-answer': 'tour',
  'et-seen': 'europeantour',
  'et-line': 'europeantour',
  'et-send': 'europeantour',
  'et-answer': 'europeantour',
  'season-line': 'season',
  'season-send': 'season',
  'season-answer': 'season',
  'ocs-seen': 'ocs',
  'ocs-line': 'ocs',
  'ocs-send': 'ocs',
  'ocs-answer': 'ocs',
  'pro-status': 'extension',
  'pro-answer': 'extension',
  'pro-unpair': 'extension',
  'pro-clear-ended': 'extension',
  'open-ranking': 'extension',
};

/** A message of a known kind, with fields of the right type, from where that kind may come; else null. */
export function accept(raw: unknown, source: Source): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const type = m.type;
  if (typeof type !== 'string' || !Object.hasOwn(FROM, type) || FROM[type as Message['type']] !== source) return null;
  switch (type) {
    case 'portal-key':
      return typeof m.token === 'string' && m.token.length <= 16_384 ? { type, token: m.token } : null;
    case 'pair-offer':
      return typeof m.fragment === 'string' && m.fragment.length <= 2048 ? { type, fragment: m.fragment } : null;
    case 'run':
      return m.id === undefined ? { type } : typeof m.id === 'string' ? { type, id: m.id } : null;
    case 'confirm':
      return typeof m.yes === 'boolean' ? { type, yes: m.yes } : null;
    case 'unpair':
      return typeof m.id === 'string' ? { type, id: m.id } : null;
    case 'test-fetch':
      // A code, or the test link a tester pasted (deep links are at most 2048 long); `id` a pairing's (16 characters).
      if (typeof m.code !== 'string' || m.code.length > 2048) return null;
      if (m.id === undefined) return { type, code: m.code };
      return typeof m.id === 'string' && m.id.length <= 64 ? { type, code: m.code, id: m.id } : null;
    case 'test-confirm':
      return typeof m.yes === 'boolean' ? { type, yes: m.yes } : null;
    case 'test-end':
      return typeof m.id === 'string' && m.id.length <= 64 ? { type, id: m.id } : null;
    case 'hcp-unpair':
      return typeof m.id === 'string' && m.id.length <= 64 ? { type, id: m.id } : null;
    case 'hcp-auto':
      return typeof m.auto === 'boolean' ? { type, auto: m.auto } : null;
    case 'hcp-confirm':
      return typeof m.yes === 'boolean' ? { type, yes: m.yes } : null;
    case 'pair-confirm':
      // A service is a lower-case id (spec/deep-links.md, `provider`).
      if (m.provider === undefined) return { type };
      return typeof m.provider === 'string' && /^[a-z][a-z0-9_-]{1,39}$/.test(m.provider) ? { type, provider: m.provider } : null;
    case 'ranking-line':
      return m.site === 'owgr' || m.site === 'rolex' ? { type, site: m.site } : null;
    case 'ranking-send':
      // The page itself is read again strictly by the background (checkPage); here only its frame.
      return m.page && typeof m.page === 'object' && !Array.isArray(m.page) ? { type, page: m.page } : null;
    case 'tour-seen': {
      // Read again strictly by the background (checkProfile, checkOwnLine); here only its frame and size.
      const v = m.seen && typeof m.seen === 'object' && !Array.isArray(m.seen) ? (m.seen as Record<string, unknown>) : null;
      if (!v || JSON.stringify(v).length > 65_536) return null;
      if ('profile' in v) return { type, seen: { profile: v.profile } };
      if (typeof v.key !== 'string' || v.key.length > 200) return null;
      if ('line' in v) return { type, seen: { key: v.key, line: v.line } };
      return v.unread === 'changed_page' || v.unread === 'not_him' || v.unread === 'no_result' ? { type, seen: { key: v.key, unread: v.unread } } : null;
    }
    case 'et-seen':
      // Read again strictly by the background (checkRead); here only its frame and size.
      return m.read && typeof m.read === 'object' && !Array.isArray(m.read) && JSON.stringify(m.read).length <= 262_144 ? { type, read: m.read } : null;
    case 'season-send':
      // The page itself is read again strictly by the background (checkTourPage); here only its frame and size.
      return m.page && typeof m.page === 'object' && !Array.isArray(m.page) && JSON.stringify(m.page).length <= 262_144 ? { type, page: m.page } : null;
    case 'ocs-line':
    case 'ocs-send':
      return ocs.isOcsSite(m.site) ? { type, site: m.site } : null;
    case 'ocs-seen': {
      // Read again strictly by the background (checkProfile, checkOom); here only its frame and size.
      const v = m.seen && typeof m.seen === 'object' && !Array.isArray(m.seen) ? (m.seen as Record<string, unknown>) : null;
      if (!ocs.isOcsSite(m.site) || !v || JSON.stringify(v).length > 65_536) return null;
      if ('profile' in v) return { type, site: m.site, seen: { profile: v.profile } };
      return 'oom' in v ? { type, site: m.site, seen: { oom: v.oom } } : null;
    }
    case 'pro-answer':
      return typeof m.yes === 'boolean' ? { type, yes: m.yes } : null;
    case 'pro-unpair':
      return typeof m.id === 'string' && m.id.length <= 64 ? { type, id: m.id } : null;
    case 'open-ranking':
      return m.site === 'owgr' || m.site === 'rolex' ? { type, site: m.site } : null;
    case 'golfde-seen':
      // The seen itself is read again strictly by the background (readSeen); here only its frame.
      return typeof m.page === 'string' && /^[0-9a-f]{8,64}$/.test(m.page) && m.seen && typeof m.seen === 'object' ? { type, page: m.page, seen: m.seen } : null;
    case 'bridge': {
      // Read again here, as strictly as on the page: the content script runs where the page can reach.
      const request = readBridgeRequest(m.request);
      return request ? { type, request } : null;
    }
    default:
      return { type } as Message;
  }
}

/** The pairing page in the address form the background compares with. */
export const PAIR_PAGE = `${WEB_APP_ORIGIN}${PAIR_PATH}`;
