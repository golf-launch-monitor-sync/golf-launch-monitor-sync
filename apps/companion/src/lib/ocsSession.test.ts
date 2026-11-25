// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { OcsKeeper } from '@glmsync/browser/ocs';
import type { ProView } from '@glmsync/browser/pro';
import { MemoryStorage } from '@glmsync/core';
import { checkTourPage, ocs, type TourPage } from '@glmsync/provider-tours';
import { ocsOom, ocsProfile } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { OcsSession, type OcsState } from './ocsSession.ts';
import type { TourAnswer } from './toursPage.ts';

const PROFILE = 'https://letaccess.com/player-profiles/990001/';
const OOM = 'https://letaccess.com/letas-order-of-merits?id=2026&oom=LO';
const LIST = 'https://letaccess.com/players';
const TODAY = '2026-11-25';
const view: ProView = {
  pairings: [{ id: 'p1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-25T09:00:00Z', host: 'app.example.org' }],
  ended: [],
  question: null,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

/** What the page script answers on the made-up pages (`who`: the id the app hands in on the Order of Merit). */
function readOf(url: string, who: string | null): TourAnswer | null {
  if (url === PROFILE) {
    const p = ocs.readProfile(ocsProfile());
    return p?.kind === 'profile' ? { ok: true, ocs: p } : { ok: false, why: 'changed_page' };
  }
  if (url === OOM) {
    if (!who) return { ok: false, why: 'not_player_page' };
    const l = ocs.readOom(ocsOom(), who);
    return l?.kind === 'oom' ? { ok: true, ocs: l } : l?.kind === 'unread' ? { ok: true, ocsUnread: l.why } : null;
  }
  return { ok: false, why: 'not_player_page' };
}

/** A tour window on the LET Access Series' made-up pages: what it shows, what was asked, kept and sent. */
function world(o: { pro?: Partial<ProView>; read?: (url: string, who: string | null) => TourAnswer | null | Promise<TourAnswer | null>; send?: () => Promise<ProView>; storage?: MemoryStorage } = {}) {
  const storage = o.storage ?? new MemoryStorage();
  const keeper = new OcsKeeper(storage);
  const sent: TourPage[] = [];
  const kept: string[] = [];
  const reads: [string, string | null][] = [];
  const states: OcsState[] = [];
  let at = PROFILE;
  const s = new OcsSession({
    site: 'tour:let_access',
    keeper,
    pro: {
      view: async () => ({ ...view, ...o.pro }),
      send: async (page) => {
        sent.push(page as TourPage);
        return o.send ? o.send() : { ...view, ...o.pro };
      },
      answer: async () => view,
    },
    lastPage: { set: async (url) => void kept.push(url) },
    read: async (who) => {
      reads.push([at, who]);
      return (o.read ?? readOf)(at, who);
    },
    today: () => TODAY,
    onChange: (st) => states.push(st),
  });
  /** The window shows `url` (a page load, or the site's move without one) and it has loaded. */
  const show = async (url: string) => {
    at = url;
    s.moved(url);
    await s.loaded(url);
  };
  return { s, keeper, storage, sent, kept, reads, states, show };
}

describe('the tour window on the LET and the LET Access Series', () => {
  it('reads her profile once it has loaded and keeps it; Send sends it with every finished tournament', async () => {
    const w = world();
    await w.s.start();
    await w.show(PROFILE);
    expect(w.reads).toEqual([[PROFILE, null]]);
    expect(w.s.now.ocs).toEqual({ who: { id: '990001', name: 'Erika Erfunden', season: 2026 }, rank: null, read: 3 });
    expect(w.sent).toEqual([]); // nothing goes before her tap
    await w.s.send(PROFILE);
    expect(w.reads).toHaveLength(2); // read once more on her tap
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0]).toMatchObject({ site: 'tour:let_access', id: '990001', name: 'Erika Erfunden', ranking: { source: 'tour:let_access', as_of: TODAY, events: 3 } });
    expect(w.sent[0]?.tournaments.map((t) => t.rounds?.length)).toEqual([3, 3, 2]);
    expect(checkTourPage(JSON.parse(JSON.stringify(w.sent[0])))).toEqual(w.sent[0]);
    expect(w.s.now.phase).toBe('done');
    expect(w.kept).toEqual([PROFILE]);
  });

  it('on the Order of Merit only her line, by her profile’s id, and her rank goes with the next Send', async () => {
    const w = world();
    await w.s.start();
    await w.show(PROFILE);
    // The site moves to its Order of Merit without loading a page: the window tells it all the same.
    await w.show(OOM);
    expect(w.reads.at(-1)).toEqual([OOM, '990001']);
    expect(w.s.now.ocs?.rank).toBe(3);
    expect(w.s.now.note).toEqual({ kind: 'oomRead', rank: 3 });
    await w.s.send(OOM);
    expect(w.sent[0]?.ranking).toEqual({ source: 'tour:let_access', as_of: TODAY, rank: 3, points: 1807.42, events: 18 });
    // The window opens on her profile next time, not on the Order of Merit.
    expect(w.kept).toEqual([PROFILE]);
  });

  it('reads the Order of Merit only once a profile of this tour was read; not her table says so and her profile still goes', async () => {
    const w = world();
    await w.s.start();
    await w.show(OOM);
    expect(w.reads).toEqual([]); // whose line? no profile yet
    await w.s.send(OOM);
    expect(w.sent).toEqual([]);
    await w.show(PROFILE);
    const other = world({ storage: w.storage, read: (url, who) => (url === OOM ? { ok: true, ocsUnread: 'not_him' } : readOf(url, who)) });
    await other.s.start();
    await other.show(OOM);
    expect(other.s.now.note).toEqual({ kind: 'oomMissing' });
    await other.s.send(OOM);
    expect(other.sent).toHaveLength(1);
    expect(other.sent[0]?.ranking.rank).toBeUndefined();
  });

  it('reads nothing without a connection for a pro’s pages, nothing on the players’ list, nothing once the window closed', async () => {
    const w = world({ pro: { pairings: [] } });
    await w.s.start();
    await w.show(PROFILE);
    expect(w.reads).toEqual([]);
    const v = world();
    await v.s.start();
    await v.show(LIST);
    expect(v.reads).toEqual([]);
    v.s.close();
    await v.show(PROFILE);
    expect(v.reads).toEqual([]);
    await v.s.send(LIST);
    expect(v.sent).toEqual([]);
  });

  it('a page that loaded while the connections were read is read once they are', async () => {
    const w = world();
    w.s.moved(PROFILE);
    void w.s.loaded(PROFILE); // before start: no connection known yet
    expect(w.reads).toEqual([]);
    await w.s.start();
    await flush();
    expect(w.reads).toEqual([[PROFILE, null]]);
  });

  it('a season without results says so and sends nothing; a page the module doesn’t know says the page changed', async () => {
    const w = world({ read: () => ({ ok: true, ocsUnread: 'no_result' }) });
    await w.s.start();
    await w.s.send(PROFILE);
    expect(w.sent).toEqual([]);
    expect(w.s.now).toMatchObject({ phase: 'ready', note: { kind: 'noResults' } });
    const v = world({ read: () => ({ ok: false, why: 'changed_page' }) });
    await v.s.start();
    await v.show(PROFILE);
    expect(v.s.now.phase).toBe('changed_page');
    // Another page: what the bar said of the last one is over.
    v.s.moved(LIST);
    expect(v.s.now).toMatchObject({ phase: 'ready', note: null });
  });

  it('no failure goes uncaught: no answer on her tap, a send that fails, a keeper that can’t be read', async () => {
    const quiet = world({ read: () => null });
    await quiet.s.start();
    await quiet.show(PROFILE);
    expect(quiet.s.now.phase).toBe('ready'); // a read of its own says nothing
    await quiet.s.send(PROFILE);
    expect(quiet.s.now.phase).toBe('error');
    const failing = world({ send: () => Promise.reject(new Error('offline')) });
    await failing.s.start();
    await failing.s.send(PROFILE);
    expect(failing.s.now.phase).toBe('error');
    const broken = world({ read: () => Promise.reject(new Error('boom')) });
    await broken.s.start();
    await expect(broken.show(PROFILE)).resolves.toBeUndefined();
    await broken.s.send(PROFILE);
    expect(broken.s.now.phase).toBe('error');
    const storage = new MemoryStorage();
    await storage.set('tours:let_access', '{not json');
    const odd = world({ storage });
    await odd.s.start();
    expect(odd.s.now.ocs).toEqual({ who: null, rank: null, read: 0 });
    const unread = world();
    (unread.s as unknown as { d: { pro: { view(): Promise<ProView> } } }).d.pro.view = () => Promise.reject(new Error('locked'));
    await unread.s.start();
    expect(unread.s.now.unread).toBe(true);
  });
});
