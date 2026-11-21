// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Who may tell the background what. A message carries no proof of its own, so the background goes by
 * where it came from (`sender.url`, which the browser sets): the Trackman key only from the portal,
 * a pairing code only from the web app's pairing page, a bridge request only from a page's top frame
 * (the background then checks its origin is a paired target's: bridge.ts), and the rest only from the
 * extension's own pages. Pure, so it is tested without a browser.
 */

import { PORTAL_ORIGIN } from '@glmsync/provider-trackman/portal';
import { PAIR_PATH, WEB_APP_ORIGIN } from '@glmsync/browser';
import { readBridgeRequest } from '@glmsync/spec';
import type { Message } from './messages.ts';

export type Source = 'portal' | 'pair-page' | 'target-page' | 'extension' | 'other';

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
  'pair-cancel': 'extension',
  'test-fetch': 'extension',
  'test-confirm': 'extension',
  'test-end': 'extension',
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
