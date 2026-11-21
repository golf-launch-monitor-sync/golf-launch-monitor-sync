// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script: runs in golf.de's own page (the extension's content script in the world MAIN, before the page's
 * own scripts; later the companion app's window), and reads along. It wraps the page's `fetch` and `XMLHttpRequest`
 * only to look at the answers golf.de's page receives for the few requests observe.ts names - a clone of the answer,
 * read after the page got it, so the page notices nothing - and posts what it made of them (`Seen`: no names, no
 * numbers) to the extension's side.
 *
 * It sends nothing to golf.de, ever: no request of its own, no header added, no request changed or held up. A
 * failure in here is swallowed - the page must go on as if nobody looked.
 */

import { reduce, watchOf, type Seen, type Watch } from './observe.ts';

/** The message the page script posts on its window (and the extension's side listens for). */
export const SEEN_MESSAGE = 'golfde-seen';

export interface PageWindow {
  fetch: typeof fetch;
  XMLHttpRequest: typeof XMLHttpRequest;
  location: { href: string; origin: string };
}

/** Wraps the window's fetch and XMLHttpRequest once; `post` hears every answer worth saying. */
export function watchPage(win: PageWindow, post: (seen: Seen) => void): void {
  const tag = win as unknown as { __glmsyncGolfde?: boolean };
  if (tag.__glmsyncGolfde) return;
  tag.__glmsyncGolfde = true;

  const say = (watch: Watch, status: number, text: string) => {
    try {
      const body = text ? (JSON.parse(text) as unknown) : null;
      const seen = reduce(watch, status, body);
      if (seen) post(seen);
    } catch {
      // Not JSON, or not an answer we know: the page shows what it shows.
    }
  };

  const ownFetch = win.fetch;
  if (typeof ownFetch === 'function') {
    win.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const answer = ownFetch.apply(this, [input, init] as Parameters<typeof fetch>);
      try {
        const isRequest = typeof Request !== 'undefined' && input instanceof Request;
        const url = isRequest ? (input as Request).url : String(input);
        const method = init?.method ?? (isRequest ? (input as Request).method : 'GET');
        // A body we can read without touching the page's own request: a string (GraphQL sends JSON text).
        const body = typeof init?.body === 'string' ? init.body : null;
        const watch = watchOf(url, method, body, win.location.href);
        if (watch) {
          answer.then(
            (res) => {
              try {
                res.clone().text().then((t) => say(watch, res.status, t), () => undefined);
              } catch {
                // the page read the body first: nothing to see
              }
            },
            () => undefined,
          );
        }
      } catch {
        // never in the page's way
      }
      return answer;
    } as typeof fetch;
  }

  const XHR = win.XMLHttpRequest;
  if (typeof XHR === 'function' && XHR.prototype) {
    const ownOpen = XHR.prototype.open;
    const ownSend = XHR.prototype.send;
    const asked = new WeakMap<XMLHttpRequest, { method: unknown; url: unknown }>();
    XHR.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      try {
        asked.set(this, { method: args[0], url: args[1] });
      } catch {
        // never in the page's way
      }
      return (ownOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof XHR.prototype.open;
    XHR.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      try {
        const a = asked.get(this);
        const watch = a ? watchOf(a.url, a.method, typeof body === 'string' ? body : null, win.location.href) : null;
        if (watch) {
          this.addEventListener('load', () => {
            try {
              const type = this.responseType;
              if (type === '' || type === 'text') say(watch, this.status, this.responseText);
              else if (type === 'json') say(watch, this.status, JSON.stringify(this.response));
            } catch {
              // nothing to see
            }
          });
        }
      } catch {
        // never in the page's way
      }
      return ownSend.call(this, body);
    };
  }
}
