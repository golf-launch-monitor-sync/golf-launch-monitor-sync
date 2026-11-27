// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The page script: runs in golf.de's own page (the extension's content script in the world MAIN, before the page's
 * own scripts; in the companion app's golf.de window injected before them as well), and reads along. It wraps the page's `fetch` and `XMLHttpRequest`
 * only to look at the answers golf.de's page receives for the few requests observe.ts names, and posts what it made of
 * them (`Seen`: no names, no numbers) to the extension's side.
 *
 * Of a fetch it hears the text the page itself reads (`text()` or `json()` of that very answer: the page gets the
 * same promise, untouched) and, besides, reads a clone - whichever comes first, once. The page's own read is the one
 * that holds: golf.de's reports (dgv-reports-js 1.23, whose GraphQL client is urql) give each request an AbortSignal
 * and abort it as soon as they have read the answer, and Chrome then fails a clone not yet read with `AbortError`
 * (seen on golf.de, 27 Nov 2026) - a clone alone saw nothing.
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

  const tell = (watch: Watch, status: number, body: unknown) => {
    try {
      const seen = reduce(watch, status, body);
      if (seen) post(seen);
    } catch {
      // Not an answer we know: the page shows what it shows.
    }
  };
  const say = (watch: Watch, status: number, text: string) => {
    let body: unknown;
    try {
      body = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      return; // not JSON: the page shows what it shows
    }
    tell(watch, status, body);
  };

  /**
   * Hears an answer once: from the page's own `text()` / `json()` of it (own properties on that one answer, each
   * returning the very promise the browser gave), or from a clone, whichever is read first.
   */
  const hear = (watch: Watch, res: Response) => {
    let heard = false;
    const once = (body: unknown) => {
      if (heard) return;
      heard = true;
      tell(watch, res.status, body);
    };
    for (const name of ['text', 'json'] as const) {
      try {
        const own = res[name];
        if (typeof own !== 'function') continue;
        Object.defineProperty(res, name, {
          configurable: true,
          writable: true,
          value: function (this: Response, ...args: unknown[]) {
            const read = (own as (...a: unknown[]) => Promise<unknown>).apply(this, args);
            try {
              read.then(
                (v) => {
                  if (name === 'json') return once(v);
                  if (typeof v !== 'string') return;
                  try {
                    const body = v ? (JSON.parse(v) as unknown) : null;
                    once(body);
                  } catch {
                    // not JSON: nothing to see
                  }
                },
                () => undefined,
              );
            } catch {
              // never in the page's way
            }
            return read;
          },
        });
      } catch {
        // an answer we can't add to: the clone below still reads it
      }
    }
    try {
      res
        .clone()
        .text()
        .then(
          (t) => {
            if (heard) return;
            let body: unknown;
            try {
              body = t ? (JSON.parse(t) as unknown) : null;
            } catch {
              return; // not JSON
            }
            once(body);
          },
          () => undefined, // aborted by the page once it read the answer: its own read tells
        );
    } catch {
      // the page read the body first: its own read tells
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
          // Registered before the page gets the promise back, so this runs before the page can read the answer.
          answer.then(
            (res) => hear(watch, res),
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
              else if (type === 'json') tell(watch, this.status, this.response);
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
