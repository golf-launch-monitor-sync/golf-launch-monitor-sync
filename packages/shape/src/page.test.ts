// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { watchShapes, type PageWindow, type SeenPost } from './page.ts';
import { newRecording, observe, toFile } from './recording.ts';
import { ACCESS, COOKIE, LOCAL_STORAGE, PERSON, SECRETS, SESSIONS_ANSWER, SIGN_IN_ANSWER } from './testing.ts';

const flush = () => new Promise((r) => setTimeout(r, 0));

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  constructor(entries: [string, string][] = []) {
    for (const [k, v] of entries) this.m.set(k, v);
  }
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

/** Just enough of XMLHttpRequest for a page that uses it: the answer comes when `send` is called. */
class FakeXhr {
  static answers = new Map<string, { status: number; body: string; type: string }>();
  status = 0;
  responseType = '';
  responseText = '';
  response: unknown = null;
  responseURL = '';
  private url = '';
  private listeners: (() => void)[] = [];
  sentHeaders: [string, string][] = [];
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.sentHeaders.push([name, value]);
  }
  addEventListener(type: string, f: () => void) {
    if (type === 'loadend') this.listeners.push(f);
  }
  getAllResponseHeaders() {
    return 'content-type: application/json\r\nx-request-id: 77\r\n';
  }
  getResponseHeader(name: string) {
    return name.toLowerCase() === 'content-type' ? (FakeXhr.answers.get(this.url)?.type ?? null) : null;
  }
  send(_body?: unknown) {
    const a = FakeXhr.answers.get(this.url);
    setTimeout(() => {
      this.status = a?.status ?? 0;
      this.responseText = a?.body ?? '';
      this.responseURL = this.url;
      for (const f of this.listeners) f();
    }, 0);
  }
}

function page(fetcher: typeof fetch): { win: PageWindow; posts: SeenPost[] } {
  const posts: SeenPost[] = [];
  const win: PageWindow = {
    fetch: fetcher,
    XMLHttpRequest: FakeXhr as unknown as typeof XMLHttpRequest,
    location: { href: 'https://portal.example.net/sessions', host: 'portal.example.net' },
    localStorage: new MemoryStorage(LOCAL_STORAGE),
    sessionStorage: new MemoryStorage(),
    document: { cookie: COOKIE },
  };
  return { win, posts };
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

describe('reading along in the page', () => {
  it("leaves the page's calls and answers as they are, and hands on only shapes", async () => {
    const asked: [string, RequestInit | undefined][] = [];
    const { win, posts } = page((async (input: RequestInfo | URL, init?: RequestInit) => {
      asked.push([String(input), init]);
      return json(SESSIONS_ANSWER);
    }) as typeof fetch);
    const w = watchShapes(win, (p) => posts.push(p));
    const init = { headers: { Authorization: `Bearer ${ACCESS}` } };
    const res = await win.fetch!(`https://api.example.net/v2/players/${PERSON.slug}/sessions`, init);
    // The page reads its body at once, as it always would: our copy doesn't stand in its way.
    expect(await res.json()).toEqual(SESSIONS_ANSWER);
    expect(asked).toEqual([[`https://api.example.net/v2/players/${PERSON.slug}/sessions`, init]]);
    await flush();
    await flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.seen).toMatchObject({ kind: 'exchange', transport: 'fetch', method: 'GET', host: 'api.example.net', status: 200, request: { auth: 'Bearer' } });
    const text = JSON.stringify(posts);
    for (const s of [ACCESS, PERSON.email, '201.37', 'a1b2c3d4e5f60718293a4b5c']) expect(text).not.toContain(s);
    // Hashes only, so the recording can mask the slug once it knows it is a name.
    expect(posts[0]!.personal.length).toBeGreaterThan(0);
    w.stop();
  });

  it("reads a Request's body without using it up for the page", async () => {
    let sentBody = '';
    const { win, posts } = page((async (input: RequestInfo | URL) => {
      sentBody = await (input as Request).text();
      return json(SIGN_IN_ANSWER);
    }) as typeof fetch);
    watchShapes(win, (p) => posts.push(p));
    const body = JSON.stringify({ username: PERSON.email, password: 'made-up-password-1' });
    await win.fetch!(new Request('https://auth.example.net/token', { method: 'POST', body, headers: { 'content-type': 'application/json' } }));
    expect(sentBody).toBe(body);
    await flush();
    await flush();
    const seen = posts[0]!.seen as any;
    expect(seen.method).toBe('POST');
    expect(seen.request.body.json.object.fields.password.string).toEqual({ n: 1, looks: ['text'], secret: true, open: true });
    expect(JSON.stringify(posts)).not.toContain('made-up-password-1');
  });

  it('passes a failure on to the page unchanged, and records it as status 0', async () => {
    const boom = new TypeError('Failed to fetch');
    const { win, posts } = page((async () => {
      throw boom;
    }) as typeof fetch);
    watchShapes(win, (p) => posts.push(p));
    await expect(win.fetch!('https://api.example.net/x')).rejects.toBe(boom);
    await flush();
    expect((posts[0]!.seen as any).status).toBe(0);
  });

  it('never lets a failure of its own reach the page', async () => {
    const { win } = page((async () => json({ ok: true })) as typeof fetch);
    watchShapes(win, () => {
      throw new Error('the extension is gone');
    });
    const res = await win.fetch!('https://api.example.net/x');
    expect(await res.json()).toEqual({ ok: true });
    // A body that isn't JSON, a status without one: still the page's answer as it was.
    const { win: w2 } = page((async () => new Response(null, { status: 204 })) as typeof fetch);
    watchShapes(w2, () => undefined);
    expect((await w2.fetch!('https://api.example.net/y')).status).toBe(204);
  });

  it('reads along with XMLHttpRequest too', async () => {
    FakeXhr.answers.set('/api/profile', { status: 200, body: JSON.stringify(SIGN_IN_ANSWER), type: 'application/json' });
    const { win, posts } = page((async () => json({})) as typeof fetch);
    const w = watchShapes(win, (p) => posts.push(p));
    const x = new (win.XMLHttpRequest as unknown as typeof FakeXhr)();
    x.open('GET', '/api/profile');
    x.setRequestHeader('Authorization', `Bearer ${ACCESS}`);
    x.send();
    await new Promise((r) => setTimeout(r, 5));
    // The page's own headers went out as it set them.
    expect(x.sentHeaders).toEqual([['Authorization', `Bearer ${ACCESS}`]]);
    expect(posts[0]!.seen).toMatchObject({ kind: 'exchange', transport: 'xhr', host: 'portal.example.net', path: '/api/profile', request: { auth: 'Bearer' }, response: { headers: ['content-type', 'x-request-id'] } });
    expect(JSON.stringify(posts)).not.toContain(PERSON.email);
    w.stop();
  });

  it('looks at storage and cookies: names and shapes, no value', () => {
    const { win, posts } = page((async () => json({})) as typeof fetch);
    const w = watchShapes(win, (p) => posts.push(p));
    w.lookAtStorage();
    expect(posts[0]!.seen.kind).toBe('storage');
    const r = newRecording('fsx-live', 0);
    for (const p of posts) observe(r, p.seen, p.personal, p.ids);
    const text = JSON.stringify(toFile(r, { portal: 'fsx-live', portalName: 'x', madeWith: 't' })).toLowerCase();
    for (const s of SECRETS) expect({ s, found: text.includes(s.toLowerCase()) }).toEqual({ s, found: false });
  });

  it("puts the page's own functions back when it stops", () => {
    const original = (async () => json({})) as typeof fetch;
    const { win } = page(original);
    const send = FakeXhr.prototype.send;
    const w = watchShapes(win, () => undefined);
    expect(win.fetch).not.toBe(original);
    expect(FakeXhr.prototype.send).not.toBe(send);
    w.stop();
    expect(win.fetch).toBe(original);
    expect(FakeXhr.prototype.send).toBe(send);
  });
});
