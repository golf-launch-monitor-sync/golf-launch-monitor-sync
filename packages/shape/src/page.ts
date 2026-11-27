// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Runs in the portal's own page (world MAIN), before its scripts: reads along with the requests the page makes and the
 * answers it gets (`fetch`, `XMLHttpRequest`), and with what it keeps in its storage, and hands on only their shapes
 * (exchange.ts) - the values stay in the page. It sends nothing of its own and changes nothing the page does: the
 * page's calls go out as they were made, its answers come back as they came, a failure of ours is swallowed here and
 * never reaches the page.
 */

import { exchangeOf, MAX_BODY, storageOf, type RawBody, type RawExchange, type Seen } from './exchange.ts';
import { found, MAX_HASHES, type Found } from './shape.ts';

export const SEEN_MESSAGE = 'glmsync-shape-seen';

/** What goes from the page to the extension: one shape, and the hashes found since the last post. */
export interface SeenPost {
  glmsync: typeof SEEN_MESSAGE;
  seen: Seen;
  personal: string[];
  ids: string[];
}

/** The parts of a window this needs (a test hands in its own). */
export interface PageWindow {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  location: { href: string; host: string };
  localStorage?: Storage;
  sessionStorage?: Storage;
  document?: { cookie: string; addEventListener?: (type: string, f: () => void) => void };
  setInterval?: (f: () => void, ms: number) => unknown;
}

/** Media types that are never JSON: only their size, from the header. */
const BINARY = /^(image|audio|video|font)\/|^application\/(octet-stream|pdf|zip|wasm)/;

function entriesOf(s: Storage | undefined): [string, string][] {
  const out: [string, string][] = [];
  if (!s) return out;
  for (let i = 0; i < Math.min(s.length, 500); i++) {
    const k = s.key(i);
    if (k === null) continue;
    out.push([k, s.getItem(k) ?? '']);
  }
  return out;
}

function headersOf(h: HeadersInit | Headers | undefined): [string, string][] {
  if (!h) return [];
  if (typeof Headers !== 'undefined' && h instanceof Headers) return [...h.entries()];
  if (Array.isArray(h)) return h.filter((x) => Array.isArray(x) && x.length === 2).map(([k, v]) => [String(k), String(v)]);
  if (typeof h === 'object') return Object.entries(h as Record<string, string>).map(([k, v]) => [k, String(v)]);
  return [];
}

/** A request's body as the page handed it over: text, a form's names, or only its kind. */
export function requestBodyOf(body: unknown): RawBody | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return { text: body };
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return { names: [...body.keys()] };
  if (typeof FormData !== 'undefined' && body instanceof FormData) return { names: [...body.keys()] };
  if (typeof Blob !== 'undefined' && body instanceof Blob) return { size: body.size };
  if (body instanceof ArrayBuffer) return { size: body.byteLength };
  if (ArrayBuffer.isView(body)) return { size: body.byteLength };
  return { skipped: 'unreadable' };
}

export interface Watcher {
  /** Ends reading along (the page's own functions back). */
  stop(): void;
  /** What the page keeps in storage, now. */
  lookAtStorage(): void;
}

export function watchShapes(win: PageWindow, post: (p: SeenPost) => void): Watcher {
  const f: Found = found();
  const sent = { personal: new Set<string>(), ids: new Set<string>() };

  const hand = (seen: Seen | null) => {
    if (!seen) return;
    const personal = [...f.personal].filter((h) => !sent.personal.has(h));
    const ids = [...f.ids].filter((h) => !sent.ids.has(h));
    for (const h of personal) if (sent.personal.size < MAX_HASHES) sent.personal.add(h);
    for (const h of ids) if (sent.ids.size < MAX_HASHES) sent.ids.add(h);
    try {
      post({ glmsync: SEEN_MESSAGE, seen, personal, ids });
    } catch {
      // never in the page's way
    }
  };
  const safely = (work: () => Seen | null) => {
    try {
      hand(work());
    } catch {
      // A shape we couldn't make is a shape less, never an error in the page.
    }
  };

  const origFetch = win.fetch;
  if (origFetch) {
    const patched = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      // What the request says is read before it goes: a Request's body is used up once sent.
      let url = '';
      let method: string | undefined;
      let headers: [string, string][] = [];
      let body: RawBody | Promise<RawBody> | undefined;
      let ok = true;
      try {
        if (typeof Request !== 'undefined' && input instanceof Request) {
          url = input.url;
          method = input.method;
          headers = [...input.headers.entries()];
          if (init?.body === undefined && input.body) {
            body = input
              .clone()
              .text()
              .then(
                (text): RawBody => ({ text }),
                (): RawBody => ({ skipped: 'unreadable' }),
              );
          }
        } else url = String(input instanceof URL ? input.href : input);
        if (init?.method) method = init.method;
        if (init?.headers) headers = [...headers, ...headersOf(init.headers)];
        if (init?.body !== undefined) body = requestBodyOf(init.body);
      } catch {
        ok = false;
      }
      const call = origFetch.call(win as unknown as typeof globalThis, input, init);
      if (!ok) return call;
      const inspect = async (res: Response | null, copy: Response | null) => {
        const reqBody = await body;
        if (!res) {
          safely(() => exchangeOf({ transport: 'fetch', method, url, base: win.location.href, requestHeaders: headers, ...(reqBody ? { requestBody: reqBody } : {}), status: 0, responseHeaders: [] }, f));
          return;
        }
        const type = res.headers.get('content-type');
        const names = [...res.headers.keys()];
        let rbody: RawBody | undefined;
        const length = Number(res.headers.get('content-length') ?? NaN);
        if (type && BINARY.test(type)) rbody = Number.isFinite(length) ? { size: length } : { skipped: 'binary' };
        else if (Number.isFinite(length) && length > MAX_BODY) rbody = { skipped: 'too_large' };
        else if (res.status !== 204 && res.status !== 304) {
          try {
            rbody = copy ? { text: await copy.text() } : { skipped: 'unreadable' };
          } catch {
            rbody = { skipped: 'unreadable' };
          }
        }
        const raw: RawExchange = { transport: 'fetch', method, url: res.url || url, base: win.location.href, requestHeaders: headers, status: res.status, responseHeaders: names, responseType: type };
        if (reqBody) raw.requestBody = reqBody;
        if (rbody) raw.responseBody = rbody;
        safely(() => exchangeOf(raw, f));
      };
      // Our copy is made the moment the answer is there, before the page's own handlers read its body; the page gets
      // the very same answer (or the very same failure) as without us.
      return call.then(
        (res) => {
          let copy: Response | null = null;
          try {
            copy = res.clone();
          } catch {
            copy = null;
          }
          inspect(res, copy).catch(() => undefined);
          return res;
        },
        (err: unknown) => {
          inspect(null, null).catch(() => undefined);
          throw err;
        },
      );
    };
    win.fetch = patched as typeof fetch;
  }

  const X = win.XMLHttpRequest;
  const proto = X?.prototype;
  const origOpen = proto?.open;
  const origHeader = proto?.setRequestHeader;
  const origSend = proto?.send;
  const meta = new WeakMap<XMLHttpRequest, { method: string; url: string; headers: [string, string][] }>();
  if (proto && origOpen && origHeader && origSend) {
    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      try {
        meta.set(this, { method, url: String(url instanceof URL ? url.href : url), headers: [] });
      } catch {
        // as above
      }
      return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof proto.open;
    proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
      try {
        meta.get(this)?.headers.push([name, value]);
      } catch {
        // as above
      }
      return origHeader.call(this, name, value);
    };
    proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      try {
        const m = meta.get(this);
        if (m) {
          const reqBody = requestBodyOf(body);
          this.addEventListener('loadend', () => {
            safely(() => {
              const names = this.getAllResponseHeaders()
                .split(/\r?\n/)
                .map((l) => l.split(':')[0]?.trim() ?? '')
                .filter(Boolean);
              const type = this.getResponseHeader('content-type');
              let rbody: RawBody | undefined;
              if (this.status === 0) rbody = undefined;
              else if (type && BINARY.test(type)) rbody = { skipped: 'binary' };
              else if (this.responseType === '' || this.responseType === 'text') rbody = { text: this.responseText };
              else if (this.responseType === 'json') rbody = { parsed: this.response };
              else if (this.response instanceof ArrayBuffer) rbody = { size: this.response.byteLength };
              else if (typeof Blob !== 'undefined' && this.response instanceof Blob) rbody = { size: this.response.size };
              else rbody = { skipped: 'unreadable' };
              const raw: RawExchange = { transport: 'xhr', method: m.method, url: this.responseURL || m.url, base: win.location.href, requestHeaders: m.headers, status: this.status, responseHeaders: names, responseType: type };
              if (reqBody) raw.requestBody = reqBody;
              if (rbody) raw.responseBody = rbody;
              return exchangeOf(raw, f);
            });
          });
        }
      } catch {
        // as above
      }
      return origSend.call(this, body);
    };
  }

  const lookAtStorage = () =>
    safely(() => {
      let cookie = '';
      try {
        cookie = win.document?.cookie ?? '';
      } catch {
        cookie = '';
      }
      let local: [string, string][] = [];
      let session: [string, string][] = [];
      try {
        local = entriesOf(win.localStorage);
      } catch {
        local = [];
      }
      try {
        session = entriesOf(win.sessionStorage);
      } catch {
        session = [];
      }
      return storageOf(win.location.host, local, session, cookie, f);
    });

  return {
    stop() {
      if (origFetch) win.fetch = origFetch;
      if (proto && origOpen && origHeader && origSend) {
        proto.open = origOpen;
        proto.setRequestHeader = origHeader;
        proto.send = origSend;
      }
    },
    lookAtStorage,
  };
}
