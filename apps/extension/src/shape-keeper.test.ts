// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { translator } from '@glmsync/browser';
import { exchangeOf, found, toFile } from '@glmsync/shape';
import { ACCESS, PERSON, SECRETS, SESSIONS_ANSWER } from '@glmsync/shape/testing';
import { accept, sourceOf } from './senders.ts';
import { MAX_RECORDING_BYTES, SCRIPT_IDS, ShapeKeeper, type Area, type Deps, type Script } from './shape-keeper.ts';
import { errorText } from './shape-view.ts';

const PORTAL_PAGE = 'https://performance.foresightsports.com/sessions';

class MemArea implements Area {
  data: Record<string, unknown> = {};
  failSet = false;
  async get(key: string) {
    return key in this.data ? { [key]: structuredClone(this.data[key]) } : {};
  }
  async set(items: Record<string, unknown>) {
    if (this.failSet) throw new Error('QUOTA_BYTES quota exceeded');
    for (const [k, v] of Object.entries(items)) this.data[k] = structuredClone(v);
  }
  async remove(key: string) {
    delete this.data[key];
  }
}

function world(over: Partial<Deps> = {}, limit?: number) {
  const scripts = new Map<string, Script>();
  const tabs: string[] = [];
  const session = new MemArea();
  const local = new MemArea();
  let granted = true;
  const d: Deps = {
    session,
    local,
    hasPermission: async () => granted,
    registered: async (ids) => ids.filter((id) => scripts.has(id)),
    register: async (list) => {
      for (const s of list) {
        if (scripts.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        scripts.set(s.id, s);
      }
    },
    unregister: async (ids) => {
      for (const id of ids) scripts.delete(id);
    },
    openTab: async (url) => {
      tabs.push(url);
    },
    now: () => Date.parse('2026-11-27T08:00:00Z'),
    ...over,
  };
  return { keeper: new ShapeKeeper(d, limit), scripts, tabs, session, local, deny: () => (granted = false) };
}

const exchange = (body: unknown) =>
  exchangeOf(
    { transport: 'fetch', method: 'GET', url: `https://api.foresightsports.com/v1/players/${PERSON.slug}/sessions`, base: PORTAL_PAGE, requestHeaders: [['authorization', `Bearer ${ACCESS}`]], status: 200, responseHeaders: ['content-type'], responseType: 'application/json', responseBody: { text: JSON.stringify(body) } },
    found(),
  )!;

describe('the shape recorder in the background', () => {
  it('starts only on a portal of the list, with its permission; its scripts are on that portal only while it records', async () => {
    const w = world();
    expect(await w.keeper.state()).toEqual({ state: 'idle' });
    const out = await w.keeper.start('fsx-live');
    expect(out).toMatchObject({ ok: true, shape: { state: 'recording', portal: 'fsx-live', calls: 0 } });
    expect([...w.scripts.values()].map((s) => [s.id, s.world, s.matches, s.persistAcrossSessions])).toEqual([
      ['glmsync-shape-main', 'MAIN', ['https://performance.foresightsports.com/*'], false],
      ['glmsync-shape-relay', 'ISOLATED', ['https://performance.foresightsports.com/*'], false],
    ]);
    // A tab of its own, so that the script is there before the portal's first call.
    expect(w.tabs).toEqual(['https://performance.foresightsports.com/']);
    expect(await w.keeper.start('fsx-live')).toMatchObject({ ok: false, error: 'already_recording' });
    const stopped = await w.keeper.stop();
    expect(stopped).toMatchObject({ ok: true, shape: { state: 'stopped', portal: 'fsx-live', calls: 0 } });
    expect(w.scripts.size).toBe(0);
  });

  it('refuses another portal and one without its permission, and starts nothing then', async () => {
    const w = world();
    expect(await w.keeper.start('somewhere-else')).toMatchObject({ ok: false, error: 'unknown_portal', shape: { state: 'idle' } });
    w.deny();
    expect(await w.keeper.start('fsx-live')).toMatchObject({ ok: false, error: 'no_permission', shape: { state: 'idle' } });
    expect(w.scripts.size).toBe(0);
    expect(w.tabs).toEqual([]);
  });

  it('cleans up when the browser refuses the scripts or the storage, and says which', async () => {
    const a = world({
      register: async () => {
        throw new Error('Invalid host');
      },
    });
    expect(await a.keeper.start('myflightscope')).toMatchObject({ ok: false, error: 'register_failed', shape: { state: 'idle' } });
    const b = world();
    b.session.failSet = true;
    expect(await b.keeper.start('fsx-live')).toMatchObject({ ok: false, error: 'storage_failed', shape: { state: 'idle' } });
    expect(b.scripts.size).toBe(0);
    expect(b.local.data).toEqual({});
  });

  it('starts again after a recording, also over scripts a cut-off one left behind', async () => {
    const w = world();
    await w.keeper.start('fsx-live');
    await w.keeper.discard();
    expect((await w.keeper.start('fsx-live')).ok).toBe(true);
    await w.keeper.stop();
    // Left behind (the browser kept them where it shouldn't): taken off before registering again.
    w.scripts.set(SCRIPT_IDS[0]!, { id: SCRIPT_IDS[0]!, matches: [], js: [], runAt: 'document_start', allFrames: false, world: 'MAIN', persistAcrossSessions: false });
    expect((await w.keeper.start('myflightscope')).ok).toBe(true);
    expect([...w.scripts.values()][0]!.matches).toEqual(['https://myflightscope.com/*', 'https://www.myflightscope.com/*']);
  });

  it('takes shapes only from the recorded portal, only while it records', async () => {
    const w = world();
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], PORTAL_PAGE)).toBe(false);
    await w.keeper.start('fsx-live');
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], 'https://myflightscope.com/')).toBe(false);
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], 'http://performance.foresightsports.com/')).toBe(false);
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], PORTAL_PAGE)).toBe(true);
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], PORTAL_PAGE)).toBe(true);
    expect(await w.keeper.state()).toMatchObject({ state: 'recording', calls: 2, addresses: 1 });
    const stopped = await w.keeper.stop();
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], PORTAL_PAGE)).toBe(false);
    // The file of what came: none of the made-up person's values.
    const text = JSON.stringify(toFile(stopped.shape.recording!, { portal: 'fsx-live', portalName: 'x', madeWith: 't' })).toLowerCase();
    for (const s of SECRETS) expect({ s, found: text.includes(s.toLowerCase()) }).toEqual({ s, found: false });
  });

  it('keeps one change at a time when a page answers fast', async () => {
    const w = world();
    await w.keeper.start('fsx-live');
    await Promise.all(Array.from({ length: 25 }, () => w.keeper.seen(exchange({ a: 1 }), [], [], PORTAL_PAGE)));
    expect(await w.keeper.state()).toMatchObject({ calls: 25 });
  });

  it('says a recording that the browser’s end cut off, instead of nothing', async () => {
    const w = world();
    await w.keeper.start('fsx-live');
    // The browser closed: the session storage and the scripts registered for its session are gone, the mark is not.
    w.session.data = {};
    w.scripts.clear();
    expect(await w.keeper.state()).toEqual({ state: 'interrupted', portal: 'fsx-live', started: Date.parse('2026-11-27T08:00:00Z') });
    expect(await w.keeper.discard()).toMatchObject({ ok: true, shape: { state: 'idle' } });
    expect(await w.keeper.state()).toEqual({ state: 'idle' });
    // The extension reloaded: the recording is there, its scripts are not.
    await w.keeper.start('fsx-live');
    w.scripts.clear();
    expect((await w.keeper.state()).state).toBe('interrupted');
  });

  it('stops taking more once the recording is full, and says so', async () => {
    const limit = 20_000;
    const w = world({}, limit);
    await w.keeper.start('fsx-live');
    const letters = (n: number) => String.fromCharCode(97 + (n % 26)) + String.fromCharCode(97 + (Math.floor(n / 26) % 26));
    let n = 0;
    while (!(await w.keeper.state()).full && n < 500) {
      await w.keeper.seen({ ...exchange(SESSIONS_ANSWER), path: `/p${letters(n)}` }, [], [], PORTAL_PAGE);
      n++;
    }
    const s = await w.keeper.state();
    expect(s.full).toBe(true);
    expect(n).toBeLessThan(500);
    expect(JSON.stringify(w.session.data).length).toBeLessThanOrEqual(limit + 100);
    const before = s.calls;
    expect(await w.keeper.seen(exchange(SESSIONS_ANSWER), [], [], PORTAL_PAGE)).toBe(true);
    expect((await w.keeper.state()).calls).toBe(before);
    expect(MAX_RECORDING_BYTES).toBeGreaterThan(1_000_000);
  });

  it('never fails to answer where it stands', async () => {
    const w = world({
      registered: async () => {
        throw new Error('gone');
      },
    });
    expect(await w.keeper.state()).toEqual({ state: 'idle' });
    expect(await w.keeper.stop()).toMatchObject({ ok: false, error: 'not_recording' });
    expect(SCRIPT_IDS).toHaveLength(2);
  });
});

describe('who may tell the recorder what', () => {
  const ID = 'abcdefghijklmnopabcdefghijklmnop';
  const ORIGIN = `chrome-extension://${ID}/`;
  const from = (url: string, frameId = 0) => sourceOf({ id: ID, url, tab: { id: 3 }, frameId }, ID, ORIGIN);

  it('knows a portal of the list in its top frame, before the bridge’s catch-all', () => {
    expect(from(PORTAL_PAGE)).toBe('shape-portal');
    expect(from('https://www.myflightscope.com/sessions')).toBe('shape-portal');
    expect(from(PORTAL_PAGE, 2)).toBe('other');
    expect(from('https://elsewhere.example.org/')).toBe('target-page');
  });

  it('takes shapes only from there, read again strictly', () => {
    const seen = exchange(SESSIONS_ANSWER);
    expect(accept({ type: 'shape-seen', seen, personal: ['abc'], ids: [] }, 'shape-portal')).toMatchObject({ type: 'shape-seen', seen: { kind: 'exchange' } });
    expect(accept({ type: 'shape-seen', seen, personal: [], ids: [] }, 'target-page')).toBeNull();
    expect(accept({ type: 'shape-seen', seen, personal: [], ids: [] }, 'extension')).toBeNull();
    // Whatever else a page's script could post there.
    expect(accept({ type: 'shape-seen', seen: { ...seen, status: 'x' }, personal: [], ids: [] }, 'shape-portal')).toBeNull();
    expect(accept({ type: 'shape-seen', seen: { kind: 'exchange' }, personal: [], ids: [] }, 'shape-portal')).toBeNull();
    expect(accept({ type: 'shape-seen', seen, personal: ['NOT A HASH'], ids: [] }, 'shape-portal')).toBeNull();
    expect(accept({ type: 'shape-seen', seen: { ...seen, response: { headers: [], body: { json: { n: 1, string: { n: 1, looks: ['text'], value: ACCESS } } } } }, personal: [], ids: [] }, 'shape-portal')).toBeNull();
    expect(accept({ type: 'shape-seen', seen: { ...seen, response: { headers: [], body: { json: { n: 1, number: { n: 1, integer: false, hidden: 'place', min: 53.55, max: 53.55 } } } } }, personal: [], ids: [] }, 'shape-portal')).toBeNull();
  });

  it('starts, stops and throws away only from the extension’s own pages, a portal only of the list', () => {
    expect(accept({ type: 'shape-start', portal: 'fsx-live' }, 'extension')).toEqual({ type: 'shape-start', portal: 'fsx-live' });
    expect(accept({ type: 'shape-start', portal: 'evil' }, 'extension')).toBeNull();
    expect(accept({ type: 'shape-start', portal: 'fsx-live' }, 'shape-portal')).toBeNull();
    expect(accept({ type: 'shape-stop' }, 'extension')).toEqual({ type: 'shape-stop' });
    expect(accept({ type: 'shape-stop' }, 'shape-portal')).toBeNull();
    expect(accept({ type: 'shape-discard' }, 'target-page')).toBeNull();
    expect(accept({ type: 'shape-state' }, 'extension')).toEqual({ type: 'shape-state' });
  });
});

describe('what the developer page says when something fails', () => {
  const en = translator('en');
  const de = translator('de');
  it('one sentence a failure, with the portal’s name, never a key or a blank', () => {
    for (const e of ['no_permission', 'unknown_portal', 'register_failed', 'already_recording', 'not_recording', 'storage_failed', 'full', 'no answer', '']) {
      for (const t of [en, de]) {
        const s = errorText(e, 'fsx-live', t);
        expect(s).not.toMatch(/shape\.|\{/);
        expect(s.length).toBeGreaterThan(20);
      }
    }
    expect(errorText('no_permission', 'fsx-live', en)).toContain('Foresight FSX Live');
    expect(errorText('Could not establish connection', undefined, de)).toContain('Could not establish connection');
  });
});
