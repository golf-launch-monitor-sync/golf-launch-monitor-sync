// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Runs in the Trackman portal's own page (world MAIN), before the portal's scripts: it finds the
 * player's own key where the portal keeps it, as the bookmark did, and hands it to the extension's
 * other content script (portal-relay.ts) through a message on this window. It only reads; the
 * portal's own calls go out exactly as they would.
 *
 * Which keys: one Trackman's sign-in issued (found in storage or cookies), or the one the portal
 * itself sends to Trackman's API. A token of some other service on the page is never taken.
 */

import { bearer, best, cookieValues, fromTrackman, rank, strings } from '@glmsync/provider-trackman/portal';

const API_HOST = 'api.trackmangolf.com';
const sent = new Set<string>();

function hand(token: string | null): void {
  if (!token || sent.has(token) || rank(token, Date.now()) === 0) return;
  sent.add(token);
  window.postMessage({ glmsync: 'portal-key', token }, window.location.origin);
}

function scan(): void {
  const found: string[] = [];
  try {
    for (const s of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null) found.push(...strings(s.getItem(k)));
      }
    }
  } catch {
    // storage switched off
  }
  try {
    for (const v of cookieValues(document.cookie)) found.push(...strings(v));
  } catch {
    // no cookies
  }
  hand(best(found.filter(fromTrackman), Date.now()));
}

function toApi(url: unknown): boolean {
  try {
    return new URL(String(url), window.location.href).host === API_HOST;
  } catch {
    return false;
  }
}

function fromHeaders(headers: unknown): string | null {
  if (!headers) return null;
  try {
    if (typeof (headers as Headers).get === 'function') return bearer((headers as Headers).get('Authorization'));
    if (Array.isArray(headers)) {
      const pair = (headers as [string, string][]).find(([k]) => String(k).toLowerCase() === 'authorization');
      return pair ? bearer(pair[1]) : null;
    }
    const o = headers as Record<string, unknown>;
    return bearer(o.Authorization ?? o.authorization);
  } catch {
    return null;
  }
}

// The portal's next call to Trackman's API carries the key: read it on the way, change nothing.
const ownFetch = window.fetch;
if (typeof ownFetch === 'function') {
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    try {
      const url = input instanceof Request ? input.url : input;
      if (toApi(url)) hand(fromHeaders(init?.headers) ?? (input instanceof Request ? fromHeaders(input.headers) : null));
    } catch {
      // never in the portal's way
    }
    return ownFetch.apply(this, [input, init] as Parameters<typeof fetch>);
  } as typeof fetch;
}

const ownOpen = XMLHttpRequest.prototype.open;
const ownSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const urls = new WeakMap<XMLHttpRequest, unknown>();
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
  urls.set(this, args[1]);
  return (ownOpen as (...a: unknown[]) => void).apply(this, args);
} as typeof XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
  try {
    if (String(name).toLowerCase() === 'authorization' && toApi(urls.get(this))) hand(bearer(value));
  } catch {
    // never in the portal's way
  }
  return ownSetHeader.call(this, name, value);
};

// Storage fills as the portal starts; look again once it has, and whenever the tab comes back.
window.addEventListener('DOMContentLoaded', scan);
window.addEventListener('load', () => {
  scan();
  setTimeout(scan, 3000);
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scan();
});
