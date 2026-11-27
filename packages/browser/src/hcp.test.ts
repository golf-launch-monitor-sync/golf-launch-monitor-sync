// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { accountRefOf, MemoryStorage, type HcpResult } from '@glmsync/core';
import { FakeHcpTarget, VirtualClock } from '@glmsync/core/testing';
import { readEventPage, reduce, type Seen } from '@glmsync/provider-golfde';
import { AUTH_FAILED, entry, historyAnswer, memberAnswer, PERSONAL, resultsAnswer, scoringAnswer, TOURNAMENT_LINES, TOURNAMENT_NAME } from '@glmsync/provider-golfde/testing';
import hcpSchema from '../../../spec/hcp/dgvhcp-1.schema.json' with { type: 'json' };
import eventSchema from '../../../spec/hcp/dgvevent-1.schema.json' with { type: 'json' };
import { makeAjv } from '../../spec/src/check.ts';
import { HcpClient, hcpPairingId } from './hcp.ts';

const check = makeAjv().compile(hcpSchema);
const TARGET = 'https://app.example.org/hcp/v1';

function world(opts: ConstructorParameters<typeof FakeHcpTarget>[0] = {}) {
  const target = new FakeHcpTarget({ base: TARGET, ...opts });
  const clock = new VirtualClock(Date.parse('2026-11-21T19:30:00Z'));
  const storage = new MemoryStorage();
  const vault = new MemoryStorage();
  const session = new MemoryStorage();
  const make = () => new HcpClient({ storage, vault, session, kind: 'extension', name: 'Golf Stats Sync for Chrome and Edge', version: '0.9.0', fetch: target.fetch, now: clock.now });
  return { target, clock, storage, vault, session, client: make(), make };
}

const member = (n = 123456) => reduce({ kind: 'graphql', op: 'GetMemberDetails' }, 200, memberAnswer(n)) as Seen;
const history = (nodes: Record<string, unknown>[], total = nodes.length) => reduce({ kind: 'graphql', op: 'GetHandicapHistorySheet' }, 200, historyAnswer(nodes, total)) as Seen;
const scoring = (nodes: Record<string, unknown>[]) => reduce({ kind: 'graphql', op: 'GetScoringRecords' }, 200, scoringAnswer(nodes)) as Seen;
const places = (own: string) => reduce({ kind: 'results', tournament: '5001' }, 200, resultsAnswer(own)) as Seen;

async function paired(w = world()) {
  const out = await w.client.offerPairing({ target: TARGET, code: 'H7M2PQ9X' });
  expect(out).toMatchObject({ ok: true, name: 'Example App' });
  return w;
}

describe('pairing with a handicap target', () => {
  it('pairs for golf.de, and the target hears nothing else', async () => {
    const w = await paired();
    const pair = w.target.received[0];
    expect(pair?.url).toBe(`${TARGET}/pair`);
    expect(JSON.parse(pair?.body ?? '{}')).toMatchObject({ code: 'H7M2PQ9X', provider: 'golfde', client: { kind: 'extension', name: 'Golf Stats Sync for Chrome and Edge' } });
    expect((await w.client.view()).pairings).toMatchObject([{ id: hcpPairingId(TARGET), name: 'Example App', host: 'app.example.org' }]);
  });

  it('hands on where a pair link may jump back to, as the target named it (spec 1.18.0)', async () => {
    const w = world({ returnPrefixes: ['exampleapp://', 'https://app.example.org/', 'https://bad.example', 'javascript://x/'] });
    const out = await w.client.offerPairing({ target: TARGET, code: 'H7M2PQ9X' });
    // Only prefixes that can't be stretched to another host, of a scheme that may open a page or an app.
    expect(out).toEqual({ ok: true, id: hcpPairingId(TARGET), name: 'Example App', replaced: false, return_prefixes: ['exampleapp://', 'https://app.example.org/'] });
    // A target that names none (as before 1.18.0): nothing to jump back to.
    expect(await world().client.offerPairing({ target: TARGET, code: 'H7M2PQ9X' })).not.toHaveProperty('return_prefixes');
  });

  it('says what went wrong', async () => {
    const w = world();
    expect(await w.client.offerPairing({ target: TARGET, code: 'WRONG123' })).toEqual({ ok: false, error: 'code' });
    expect(await w.client.offerPairing({ target: TARGET, code: 'H7M2PQ9X', provider: 'trackman' })).toEqual({ ok: false, error: 'provider' });
    expect(await w.client.offerPairing({ target: 'https://down.example.org/hcp/v1', code: 'H7M2PQ9X' })).toMatchObject({ ok: false });
  });
});

describe('what golf.de’s pages showed, sent', () => {
  it('pages one by one end as one result with its Score Differential and the player’s own place', async () => {
    const w = await paired();
    const own = entry();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.see('p1', history([own, entry({ tournamentDate: '2026-09-12T10:00:00+02:00', ratedGrossResult: 88 })], 2));
    let v = await w.client.send();
    expect(v).toMatchObject({ seen: 2, fresh: 0 });
    await w.client.see('p2', scoring([own]));
    await w.client.see('p3', places(own.resultGuid as string));
    v = await w.client.send();
    expect(v.fresh).toBe(0);
    expect(w.target.results.size).toBe(2);
    const kept = [...w.target.results.values()].find((r) => r.ref === own.resultGuid) as HcpResult;
    expect(kept).toMatchObject({ played_on: '2026-10-03', gbe: 85, sd: 11.2, place: 7, field: 42 });
    expect(w.target.index).toEqual({ value: 8.1, low: 7.4, as_of: expect.stringMatching(/^2026-11-2[12]$/) });
    // Every batch valid, every one after a plan of its own, with the reason `manual`.
    for (const b of w.target.imports) expect(check(b), JSON.stringify(check.errors)).toBe(true);
    expect(w.target.plans.every((p) => p.reason === 'manual' && p.client === 'extension')).toBe(true);
    expect(w.target.imports.map((b) => b.sheet)).toEqual(['history', 'mixed']);
  });

  it('sends nothing, and asks nothing, when the target has it all', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.see('p1', history([entry()]));
    await w.client.send();
    const asked = w.target.received.length;
    await w.client.see('p2', history([]));
    await w.client.send();
    expect(w.target.received.length).toBe(asked);
  });

  it('never lets a name or a number of a person reach the target', async () => {
    const w = await paired();
    const own = entry();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.see('p1', history([own, entry({ tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}` })]));
    await w.client.see('p2', places(own.resultGuid as string));
    await w.client.send();
    const text = JSON.stringify(w.target.received);
    for (const v of Object.values(PERSONAL)) expect(text).not.toContain(v);
    expect(text).not.toContain('member:123456'); // the account only as its hash
    expect(w.target.accountRef).toBe(accountRefOf(w.target.salt, 'golfde', 'member:123456'));
  });

  it('keeps to the target’s limits, with the index in the first batch', async () => {
    const w = await paired(world({ limits: { max_bytes: 2_097_152, max_results: 3 } }));
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.see('p1', history(Array.from({ length: 7 }, (_, i) => entry({ tournamentDate: `2026-0${(i % 9) + 1}-1${i}T10:00:00+02:00` }))));
    await w.client.send();
    expect(w.target.imports.map((b) => b.results.length)).toEqual([3, 3, 1]);
    expect(w.target.imports.map((b) => !!b.index)).toEqual([true, false, false]);
  });

  it('sends the index alone when only it is new', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.send();
    expect(w.target.imports).toHaveLength(1);
    expect(w.target.imports[0]).toMatchObject({ results: [], index: { value: 8.1 } });
  });
});

describe('whose record it is', () => {
  it('sends nothing, and asks the target nothing, before the player says the account is theirs', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.see('p1', history([entry()]));
    const v = await w.client.send();
    expect(v).toMatchObject({ account: 'asking', fresh: 0 });
    expect(w.target.received.filter((r) => !r.url.endsWith('/pair'))).toHaveLength(0);
    await w.client.confirm(true);
    await w.client.send();
    expect(w.target.results.size).toBe(1);
    expect((await w.client.view()).pairings[0]?.total).toBe(1);
    // A new client on the same storage still knows the yes.
    expect((await w.make().view()).account).toBe('confirmed');
  });

  it('“No”: what was kept of the account goes, and nothing of it is kept or sent again', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.see('p1', history([entry()]));
    let v = await w.client.confirm(false);
    expect(v).toMatchObject({ account: 'rejected', seen: 0, fresh: 0, index: null });
    v = await w.client.see('p2', history([entry({ tournamentDate: '2026-08-01T10:00:00+02:00' })]));
    expect(v).toMatchObject({ account: 'rejected', seen: 0 });
    await w.client.send();
    expect(w.target.imports).toHaveLength(0);
    // Their own account signs in: asked about afresh.
    expect((await w.client.see('p3', member(654321))).account).toBe('asking');
  });

  it('no question when the app already has this very account (a yes given on another device)', async () => {
    const w = world();
    w.target.accountRef = accountRefOf(w.target.salt, 'golfde', 'member:123456');
    await paired(w);
    expect((await w.client.see('p1', member())).account).toBe('confirmed');
    // Another account than the app's is asked about all the same: someone else may be signed in here.
    expect((await w.client.see('p2', member(2))).account).toBe('asking');
  });

  it('“Is this you?” without an account named does nothing', async () => {
    const w = await paired();
    expect(await w.client.confirm(true)).toMatchObject({ account: 'none' });
  });

  it('results of a page wait for that page to name the account', async () => {
    const w = await paired();
    await w.client.see('p1', history([entry()]));
    let v = await w.client.send();
    expect(v).toMatchObject({ waiting: true, seen: 0 });
    expect(w.target.imports).toHaveLength(0);
    v = await w.client.see('p1', member());
    // Whose it is now known, but nothing counts as on its way before the player's yes.
    expect(v).toMatchObject({ waiting: false, seen: 1, fresh: 0, account: 'asking', index: { value: 8.1 } });
    v = await w.client.confirm(true);
    expect(v).toMatchObject({ account: 'confirmed', fresh: 1, index: null });
  });

  it('a page that names none takes the account the session’s pages named, unless golf.de said since nobody is signed in', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.see('p2', history([entry()]));
    expect((await w.client.view()).seen).toBe(1);
    await w.client.see('p3', reduce({ kind: 'graphql', op: 'GetMemberDetails' }, 200, AUTH_FAILED) as Seen);
    await w.client.see('p4', history([entry({ tournamentDate: '2026-08-01T10:00:00+02:00' })]));
    expect(await w.client.view()).toMatchObject({ seen: 1, waiting: true, signed_out: true });
  });

  it('golf.de saying signed in again ends signed_out; whose record it is still waits for a page that names it', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.see('p2', reduce({ kind: 'session' }, 401, null) as Seen);
    expect(await w.client.view()).toMatchObject({ signed_out: true });
    // The player signs in again; golf.de's login page asks its session (sessions/me: authenticated).
    const signedIn = reduce({ kind: 'session' }, 200, { authenticated: true });
    expect(signedIn).not.toBeNull();
    let v = await w.client.see('p3', signedIn as Seen);
    expect(v.signed_out).toBe(false);
    // A page that names nobody: its results don't go to the account named before the sign-out.
    v = await w.client.see('p4', history([entry()]));
    expect(v).toMatchObject({ seen: 0, waiting: true, signed_out: false });
    v = await w.client.see('p4', member());
    expect(v).toMatchObject({ seen: 1, waiting: false, signed_out: false });
  });

  it('another account’s record drops what was kept of the one before, and goes to no target that has another', async () => {
    const w = await paired();
    await w.client.see('p1', member(1));
    await w.client.confirm(true);
    await w.client.see('p1', history([entry()]));
    await w.client.send();
    expect(w.target.results.size).toBe(1);
    await w.client.see('p2', member(2));
    await w.client.see('p2', history([entry({ tournamentDate: '2026-08-01T10:00:00+02:00' })]));
    const asked = w.target.received.length;
    const v = await w.client.send();
    expect(v.seen).toBe(1);
    expect(v.pairings[0]?.other_account).toBe(true);
    expect(w.target.received.length).toBe(asked);
    expect(w.target.results.size).toBe(1);
  });
});

describe('when things go wrong', () => {
  it('a target having a moment: tried again with the next send, nothing marked as sent', async () => {
    const w = await paired(world({ fail: { '/import': { status: 503 } } }));
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.see('p1', history([entry()]));
    const v = await w.client.send();
    expect(v.pairings[0]?.last).toMatchObject({ status: 'failed', error: 'unavailable' });
    expect(v.fresh).toBe(1);
  });

  it('the player ended the connection in the app: forgotten here, and said so', async () => {
    const w = await paired();
    w.target.disconnected = true;
    await w.client.see('p1', member());
    await w.client.confirm(true);
    const v = await w.client.send();
    expect(v.pairings).toEqual([]);
    expect(v.ended).toMatchObject([{ name: 'Example App', why: 'disconnected' }]);
    expect((await w.client.clearEnded()).ended).toEqual([]);
  });

  it('a token the app revoked: forgotten', async () => {
    const w = await paired();
    w.target.tokens.clear();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    expect((await w.client.send()).ended).toMatchObject([{ why: 'revoked' }]);
  });

  it('signed out on golf.de: the target hears it once', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.send();
    await w.client.see('p2', reduce({ kind: 'session' }, 200, { authenticated: false }) as Seen);
    await w.client.send();
    await w.client.see('p3', reduce({ kind: 'session' }, 200, { authenticated: false }) as Seen);
    await w.client.send();
    const notices = w.target.imports.filter((b) => b.notice);
    expect(notices).toMatchObject([{ notice: { code: 'signed_out' }, results: [] }]);
  });

  it('a page that changed: the target hears it once a day', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.send();
    await w.client.see('p1', { kind: 'changed_page', what: 'GetHandicapHistorySheet' });
    await w.client.send();
    await w.client.see('p1', { kind: 'changed_page', what: 'GetHandicapHistorySheet' });
    await w.client.send();
    expect(w.target.imports.filter((b) => b.notice?.code === 'changed_page')).toHaveLength(1);
  });

  it('unreadable storage starts afresh rather than stopping', async () => {
    const w = await paired();
    await w.storage.set('glmsync/hcp/seen', '{not json');
    await w.session.set('glmsync/hcp/session', 'null');
    expect((await w.client.see('p1', member())).seen).toBe(0);
  });
});

describe('settings and pairings', () => {
  it('sends by itself unless the player says otherwise', async () => {
    const w = await paired();
    expect((await w.client.view()).auto).toBe(true);
    expect((await w.client.setAuto(false)).auto).toBe(false);
    expect((await w.make().view()).auto).toBe(false);
  });

  it('disconnecting tells the target and forgets the token', async () => {
    const w = await paired();
    const v = await w.client.removePairing(hcpPairingId(TARGET));
    expect(v.pairings).toEqual([]);
    expect(w.target.tokens.size).toBe(0);
    expect(await w.vault.get('glmsync/hcp/pairings')).toBe('[]');
  });

  it('a new pairing gets what was seen before', async () => {
    const w = world();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.see('p1', history([entry()]));
    await w.client.offerPairing({ target: TARGET, code: 'H7M2PQ9X' });
    await w.client.send();
    expect(w.target.results.size).toBe(1);
  });
});

describe('Fetch all: the clicks the player would make, on their tap', () => {
  const page = (nodes: Record<string, unknown>[], total: number, n: number, of: number) =>
    reduce({ kind: 'graphql', op: 'GetHandicapHistorySheet' }, 200, historyAnswer(nodes, total, n, of)) as Seen;
  const PAUSE = 6001; // the most a pause can be

  async function ready() {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    return w;
  }

  it('only signed in, with the account confirmed and an app connected', async () => {
    const w = await paired();
    expect((await w.client.view()).fetch_all).toBe('no'); // no account named yet
    await w.client.see('p1', member());
    expect((await w.client.view()).fetch_all).toBe('no'); // not confirmed yet
    expect((await w.client.startFetchAll('tab1')).run).toBeNull();
    await w.client.confirm(true);
    expect((await w.client.view()).fetch_all).toBe('ready');
    await w.client.see('p1', { kind: 'signed_out' });
    expect((await w.client.view()).fetch_all).toBe('no');
    await w.client.see('p1', member());
    expect((await w.client.view()).fetch_all).toBe('ready');
    const none = world();
    await none.client.see('p1', member());
    expect((await none.client.view()).fetch_all).toBe('no'); // no app
  });

  it('a whole run: steps only for the page that started it, nothing sent until the end, then one send', async () => {
    const w = await ready();
    const nodes = Array.from({ length: 12 }, (_, i) => entry({ scorecardTournamentNumber: 6000 + i, tournamentDate: `2026-${String(10 - Math.floor(i / 2)).padStart(2, '0')}-0${(i % 2) + 1}T10:00:00+02:00` }));
    let v = await w.client.startFetchAll('tab1');
    expect(v).toMatchObject({ fetch_all: 'running', run: { phase: 'history' } });
    expect((await w.client.runStep('tab2')).step).toEqual({ do: 'end' }); // another tab drives nothing
    expect((await w.client.runStep('tab1')).step).toEqual({ do: 'open', url: 'https://www.golf.de/mein-bereich/handicap-history-sheet.html' });
    await w.client.see('p2', member());
    await w.client.see('p2', page(nodes.slice(0, 10), 12, 1, 2));
    w.clock.advance(PAUSE);
    expect((await w.client.runStep('tab1')).step).toMatchObject({ do: 'page' });
    await w.client.see('p2', page(nodes.slice(10), 12, 2, 2));
    w.clock.advance(PAUSE);
    expect((await w.client.runStep('tab1')).step).toEqual({ do: 'click', what: 'scoring' });
    await w.client.see('p2', scoring(nodes.slice(0, 5)));
    expect(w.target.imports).toHaveLength(0); // nothing goes while it runs
    const lists: string[] = [];
    for (;;) {
      w.clock.advance(PAUSE);
      const turn = await w.client.runStep('tab1');
      if (turn.step.do === 'end') {
        v = turn.view;
        break;
      }
      expect(turn.step.do).toBe('open');
      const t = /#\/(\d+)\/ergebnisse$/.exec((turn.step as { url: string }).url)?.[1] as string;
      lists.push(t);
      const own = nodes.find((n) => String(n.scorecardTournamentNumber) === t);
      await w.client.see('p3', reduce({ kind: 'results', tournament: t }, 200, resultsAnswer(own?.resultGuid as string)) as Seen);
    }
    expect(lists).toHaveLength(12);
    expect(lists[0]).toBe('6001'); // newest first (2 October)
    expect(v).toMatchObject({ fetch_all: 'ready', run: { phase: 'done', entries: 12, lists_done: 12, lists_total: 12 } });
    // One send at the end, with every place.
    expect(w.target.imports).toHaveLength(1);
    expect(w.target.results.size).toBe(12);
    expect([...w.target.results.values()].every((r) => r.place === 7 && r.field === 42)).toBe(true);
    const text = JSON.stringify(w.target.received);
    for (const p of Object.values(PERSONAL)) expect(text).not.toContain(p);

    // The next run opens no list again: each has its place now.
    w.clock.advance(60_000);
    await w.client.startFetchAll('tab1');
    await w.client.runStep('tab1');
    await w.client.see('p4', page(nodes.slice(0, 10), 12, 1, 1));
    w.clock.advance(PAUSE);
    await w.client.runStep('tab1');
    await w.client.see('p4', scoring([]));
    w.clock.advance(PAUSE);
    expect((await w.client.runStep('tab1')).step).toEqual({ do: 'end' });
  });

  it('stops when golf.de says signed out, and sends what it read so far', async () => {
    const w = await ready();
    await w.client.startFetchAll('tab1');
    await w.client.runStep('tab1');
    await w.client.see('p2', page([entry()], 30, 1, 3));
    const v = await w.client.see('p2', { kind: 'signed_out' });
    expect(v).toMatchObject({ fetch_all: 'no', run: { phase: 'stopped', why: 'signed_out' } });
    expect(w.target.imports).toHaveLength(1);
    expect((await w.client.runStep('tab1')).step).toEqual({ do: 'end' });
  });

  it('the player stops it: what was read goes out', async () => {
    const w = await ready();
    await w.client.startFetchAll('tab1');
    await w.client.runStep('tab1');
    await w.client.see('p2', page([entry()], 30, 1, 3));
    const v = await w.client.cancelFetchAll();
    expect(v).toMatchObject({ fetch_all: 'ready', run: { phase: 'stopped', why: 'cancelled' } });
    expect(w.target.results.size).toBe(1);
  });

  it('a run its page left (the tab closed) ends by itself, and a new one may start', async () => {
    const w = await ready();
    await w.client.startFetchAll('tab1');
    await w.client.runStep('tab1');
    w.clock.advance(121_000);
    const v = await w.client.view();
    expect(v.fetch_all).toBe('ready');
    expect((await w.client.startFetchAll('tab2')).run).toMatchObject({ phase: 'history', entries: 0 });
    expect((await w.client.runStep('tab2')).step).toMatchObject({ do: 'open' });
  });

  it('a few runs a day, no more', async () => {
    const w = await ready();
    for (let i = 0; i < 3; i++) {
      await w.client.startFetchAll('tab1');
      await w.client.cancelFetchAll();
    }
    expect((await w.client.view()).fetch_all).toBe('limit');
    expect((await w.client.startFetchAll('tab1')).run).toMatchObject({ why: 'cancelled' });
    w.clock.advance(24 * 3600_000 + 1);
    expect((await w.client.view()).fetch_all).toBe('ready');
  });

  it('the same golf.de tournament list isn’t opened again for a week', async () => {
    const w = await ready();
    const own = entry({ scorecardTournamentNumber: 5001 });
    await w.client.startFetchAll('tab1');
    await w.client.runStep('tab1');
    await w.client.see('p2', page([own], 1, 1, 1));
    w.clock.advance(PAUSE);
    await w.client.runStep('tab1');
    await w.client.see('p2', scoring([]));
    w.clock.advance(PAUSE);
    expect((await w.client.runStep('tab1')).step).toMatchObject({ do: 'open', url: expect.stringContaining('#/5001/') });
    // No list came (none published yet): the run goes on and ends; the list waits a week.
    w.clock.advance(30_000);
    await w.client.runStep('tab1');
    w.clock.advance(PAUSE);
    expect((await w.client.runStep('tab1')).step).toEqual({ do: 'end' });
    await w.client.startFetchAll('tab1');
    await w.client.runStep('tab1');
    await w.client.see('p3', page([own], 1, 1, 1));
    w.clock.advance(PAUSE);
    await w.client.runStep('tab1');
    await w.client.see('p3', scoring([]));
    w.clock.advance(PAUSE);
    expect((await w.client.runStep('tab1')).step).toEqual({ do: 'end' });
  });
});

describe('Fetch all: its page goes away', () => {
  it('a closed tab ends its run (and only its own), and what was read goes out', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.startFetchAll('tab:1');
    await w.client.runStep('tab:1');
    await w.client.see('p2', history([entry()], 30));
    expect((await w.client.leaveFetchAll('tab:2')).fetch_all).toBe('running');
    expect(w.target.imports).toHaveLength(0);
    const v = await w.client.leaveFetchAll('tab:1');
    expect(v).toMatchObject({ fetch_all: 'ready', run: { phase: 'stopped', why: 'cancelled' } });
    expect(w.target.results.size).toBe(1);
  });
});

describe('Fetch all by itself, when the record is due (spec 1.16.0; the companion app 1.17.0)', () => {
  const page = (nodes: Record<string, unknown>[], total: number, n: number, of: number) =>
    reduce({ kind: 'graphql', op: 'GetHandicapHistorySheet' }, 200, historyAnswer(nodes, total, n, of)) as Seen;
  const PAUSE = 6001;
  const LOOK = 30 * 60_000;
  const own = entry(); // one result, the same on every page

  async function ready() {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.confirm(true);
    await w.client.see('p1', history([own]));
    await w.client.send(); // the target has what was seen: nothing new for it
    w.target.plans.length = 0;
    return w;
  }

  /** A run by itself from its first step to its end, the page showing one History Sheet page and the Scoring Record. */
  async function wholeRun(w: Awaited<ReturnType<typeof ready>>, owner = 'tab:9') {
    expect((await w.client.startFetchAll(owner, { auto: true })).run).toMatchObject({ phase: 'history', auto: true });
    expect(await w.client.drives(owner)).toBe(true);
    expect(await w.client.drives('tab:1')).toBe(false);
    await w.client.runStep(owner);
    await w.client.see('p9', member());
    await w.client.see('p9', page([own], 1, 1, 1));
    w.clock.advance(PAUSE);
    await w.client.runStep(owner);
    await w.client.see('p9', scoring([]));
    for (let i = 0; i < 5; i++) {
      w.clock.advance(PAUSE);
      const turn = await w.client.runStep(owner);
      if (turn.step.do === 'end') return turn.view;
      const t = turn.step.do === 'open' ? /#\/(\d+)\/ergebnisse$/.exec(turn.step.url)?.[1] : undefined;
      if (t) await w.client.see('p9', reduce({ kind: 'results', tournament: t }, 200, resultsAnswer('none-of-ours')) as Seen);
    }
    throw new Error('the run didn’t end');
  }

  it('asks only the target’s plan, with timer, and only when it says due', async () => {
    const w = await ready();
    expect(await w.client.autoDue()).toBe(false);
    expect(w.target.plans).toEqual([{ reason: 'timer', client: 'extension' }]);
    // Not asked again before the next look.
    w.target.due = true;
    w.clock.advance(LOOK - 120_000);
    expect(await w.client.autoDue()).toBe(false);
    expect(w.target.plans).toHaveLength(1);
    w.clock.advance(120_000);
    expect(await w.client.autoDue()).toBe(true);
    expect(w.target.plans.map((p) => p.reason)).toEqual(['timer', 'timer']);
    expect(w.target.imports).toHaveLength(1); // nothing sent by looking
  });

  it('never while golf.de last said signed out, before the yes, without an app, or switched off - and then asks no target', async () => {
    const w = await paired();
    w.target.due = true;
    expect(await w.client.autoDue()).toBe(false); // no account named yet
    await w.client.see('p1', member());
    expect(await w.client.autoDue()).toBe(false); // not confirmed
    await w.client.confirm(true);
    await w.client.see('p1', { kind: 'signed_out' });
    expect(await w.client.autoDue()).toBe(false);
    await w.client.see('p1', member());
    let v = await w.client.setAutoFetch(false);
    expect(v.auto_fetch).toBe(false);
    expect(await w.client.autoDue()).toBe(false);
    expect((await w.client.startFetchAll('tab:9', { auto: true })).fetch_all).toBe('ready');
    expect(w.target.plans).toHaveLength(0);
    // The player's own tap still runs.
    expect((await w.client.startFetchAll('tab:1')).fetch_all).toBe('running');
    await w.client.cancelFetchAll();
    v = await w.client.setAutoFetch(true);
    expect(v.auto_fetch).toBe(true);
    w.target.due = true; // the tapped run's send (the index, new to it) moved the target's plan on
    expect(await w.client.autoDue()).toBe(true);
    const none = world();
    none.target.due = true;
    await none.client.see('p1', member());
    expect(await none.client.autoDue()).toBe(false); // no app
  });

  it('counts with the player’s runs: three a day together', async () => {
    const w = await ready();
    w.target.due = true;
    for (let i = 0; i < 3; i++) {
      await w.client.startFetchAll('tab:1');
      await w.client.cancelFetchAll();
    }
    expect(await w.client.autoDue()).toBe(false);
    expect(w.target.plans).toHaveLength(0);
  });

  it('a run by itself that finished tells the target even with nothing new, so its plan moves on', async () => {
    const w = await ready();
    w.target.due = true;
    expect(await w.client.autoDue()).toBe(true);
    const v = await wholeRun(w);
    expect(v.run).toMatchObject({ phase: 'done', auto: true });
    expect(w.target.imports).toHaveLength(2);
    const last = w.target.imports[1];
    expect(last?.results).toEqual([]);
    expect(check(last), JSON.stringify(check.errors)).toBe(true);
    expect(w.target.plans.at(-1)).toEqual({ reason: 'manual', client: 'extension' });
    expect(w.target.due).toBe(false);
    w.clock.advance(LOOK);
    expect(await w.client.autoDue()).toBe(false); // the target says not due now
  });

  it('a tapped run with nothing new still sends nothing', async () => {
    const w = await ready();
    await w.client.startFetchAll('tab:1');
    await w.client.cancelFetchAll();
    expect(w.target.imports).toHaveLength(1);
  });

  it('one that stopped early holds the next until golf.de showed the player signed in outside a run', async () => {
    const w = await ready();
    w.target.due = true;
    expect(await w.client.autoDue()).toBe(true);
    await w.client.startFetchAll('tab:9', { auto: true });
    await w.client.runStep('tab:9');
    // golf.de's page in the background tab says nobody is signed in: it stops, reads nothing, never signs in.
    const v = await w.client.see('p9', { kind: 'signed_out' });
    expect(v.run).toMatchObject({ phase: 'stopped', why: 'signed_out', auto: true });
    expect(w.target.notice).toEqual({ code: 'signed_out' });
    w.target.plans.length = 0;
    w.clock.advance(LOOK);
    expect(await w.client.autoDue()).toBe(false);
    expect(w.target.plans).toHaveLength(0);
    // The player opens golf.de themselves, signed in: it may come again.
    await w.client.see('p1', member());
    expect(await w.client.autoDue()).toBe(true);
  });

  it('a background tab closed (or left) is a run that stopped early too; the switch on again lifts the hold', async () => {
    const w = await ready();
    w.target.due = true;
    await w.client.startFetchAll('tab:9', { auto: true });
    await w.client.runStep('tab:9');
    await w.client.see('p9', member()); // seen in the run by itself: no lifting of a hold by it
    await w.client.leaveFetchAll('tab:9');
    w.clock.advance(LOOK);
    expect(await w.client.autoDue()).toBe(false);
    await w.client.setAutoFetch(true);
    expect(await w.client.autoDue()).toBe(true);
  });

  it('a target that can’t answer, or ended the connection, starts nothing', async () => {
    const down = await ready();
    down.target.due = true;
    (down.target.opts as { fail?: Record<string, { status: number }> }).fail = { '/plan': { status: 503 } };
    expect(await down.client.autoDue()).toBe(false);
    const ended = await ready();
    ended.target.due = true;
    ended.target.disconnected = true;
    expect(await ended.client.autoDue()).toBe(false);
    expect((await ended.client.view()).pairings).toHaveLength(0);
  });

  it('the companion app keeps a run of the day for the tap (spare), and asks no target when none is left', async () => {
    const w = await ready();
    w.target.due = true;
    await w.client.startFetchAll('window');
    await w.client.cancelFetchAll();
    expect(await w.client.autoDue({ spare: 1 })).toBe(true); // one run used, two left: one may go by itself
    await w.client.startFetchAll('hidden', { auto: true });
    await w.client.interruptFetchAll('hidden');
    w.clock.advance(LOOK);
    w.target.plans.length = 0;
    expect(await w.client.autoDue({ spare: 1 })).toBe(false); // two used: the last is the player's
    expect(w.target.plans).toHaveLength(0);
    expect(await w.client.autoDue()).toBe(true); // the extension (no spare) would still look
    expect((await w.client.startFetchAll('window')).fetch_all).toBe('running'); // and the tap still runs
  });

  it('the app sent to the back interrupts its run: what was read goes out, and no hold', async () => {
    const w = await ready();
    w.target.due = true;
    expect(await w.client.autoDue({ spare: 1 })).toBe(true);
    await w.client.startFetchAll('hidden', { auto: true });
    await w.client.runStep('hidden');
    await w.client.see('p9', member());
    await w.client.see('p9', page([own, entry({ tournamentDate: '2026-11-20T10:00:00+01:00', ratedGrossResult: 91 })], 2, 1, 1));
    // Another page's run isn't touched.
    let v = await w.client.interruptFetchAll('window');
    expect(v.fetch_all).toBe('running');
    v = await w.client.interruptFetchAll('hidden');
    expect(v.run).toMatchObject({ phase: 'stopped', why: 'cancelled', auto: true });
    expect(w.target.imports).toHaveLength(2); // the new result went out at once
    expect(w.target.notice ?? null).toBeNull(); // no notice: nothing went wrong
    w.target.due = true;
    w.clock.advance(LOOK);
    expect(await w.client.autoDue({ spare: 1 })).toBe(true); // not held
    // A tapped run interrupted the same way just ends, as on Stop.
    await w.client.startFetchAll('window');
    expect((await w.client.interruptFetchAll()).run).toMatchObject({ phase: 'stopped', why: 'cancelled' });
  });

  it('a run under way starts no other', async () => {
    const w = await ready();
    w.target.due = true;
    await w.client.startFetchAll('tab:1');
    await w.client.runStep('tab:1');
    expect(await w.client.autoDue()).toBe(false);
    expect((await w.client.startFetchAll('tab:9', { auto: true })).run).not.toHaveProperty('auto');
  });
});

describe('one tournament from golf.de’s page (spec 1.19.0)', () => {
  const page = readEventPage({
    address: 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/490000000001?radius=50',
    heading: TOURNAMENT_NAME,
    lines: TOURNAMENT_LINES,
  }) as unknown as { event: Record<string, unknown> };
  const event = page.event;
  const checkEvent = makeAjv().compile(eventSchema);

  it('goes to the target picked, as dgvevent/1, with no golf.de account and no yes needed', async () => {
    const w = await paired();
    const id = hcpPairingId(TARGET);
    expect(await w.client.takeEvent(id, event)).toEqual({ ok: true, name: 'Example App', result: 'new', kept: [] });
    expect(await w.client.takeEvent(id, event)).toEqual({ ok: true, name: 'Example App', result: 'known', kept: [] });
    expect(await w.client.takeEvent(id, { ...event, time: '10:00' })).toMatchObject({ ok: true, result: 'updated' });
    const sent = w.target.tournamentBodies[0];
    expect(checkEvent(sent), JSON.stringify(checkEvent.errors)).toBe(true);
    expect(sent).toMatchObject({ format: 'dgvevent/1', provider: 'golfde', generator: { name: 'Golf Stats Sync for Chrome and Edge', version: '0.9.0' } });
    // Nothing else went there: no plan, no import - and the search the player came from stays out.
    expect(w.target.received.map((r) => r.url.replace(TARGET, ''))).toEqual(['/pair', '/tournament', '/tournament', '/tournament']);
    expect(JSON.stringify(sent)).not.toContain('radius');
  });

  it('sends nothing that isn’t a tournament as the schema has it', async () => {
    const w = await paired();
    const id = hcpPairingId(TARGET);
    expect(await w.client.takeEvent(id, { ...event, start_list: [PERSONAL.other] })).toEqual({ ok: false, name: 'Example App', error: 'changed_page' });
    expect(await w.client.takeEvent(id, null)).toMatchObject({ ok: false, error: 'changed_page' });
    expect(await w.client.takeEvent('nobody', event)).toEqual({ ok: false, error: 'no_pairing' });
    expect(w.target.tournamentBodies).toEqual([]);
  });

  it('says each refusal in its own words, and ends the pairing only as the record would', async () => {
    const cases: [number, string, string][] = [
      [403, 'account_inactive', 'account_inactive'],
      [409, 'calendar_full', 'calendar_full'],
      [422, 'too_old', 'too_old'],
      [422, 'too_far_ahead', 'too_far_ahead'],
      [422, 'invalid_event', 'refused'],
      [403, 'wrong_token', 'refused'],
      [503, 'unavailable', 'unreachable'],
    ];
    for (const [status, code, error] of cases) {
      const w = await paired(world({ fail: { '/tournament': { status, body: { error: { code, message: 'no' } } } } }));
      expect([code, await w.client.takeEvent(hcpPairingId(TARGET), event)]).toEqual([code, { ok: false, name: 'Example App', error }]);
      expect((await w.client.view()).pairings).toHaveLength(1);
    }
    const slow = await paired(world({ fail: { '/tournament': { status: 429, body: { error: { code: 'rate_limited' } } } } }));
    expect(await slow.client.takeEvent(hcpPairingId(TARGET), event)).toMatchObject({ ok: false, error: 'rate_limited' });
    const none = await paired(world({ noTournaments: true }));
    expect(await none.client.takeEvent(hcpPairingId(TARGET), event)).toEqual({ ok: false, name: 'Example App', error: 'not_offered' });
    // A connection the player ended there, or a token it no longer knows: the pairing ends, as for the record.
    const ended = await paired();
    ended.target.disconnected = true;
    expect(await ended.client.takeEvent(hcpPairingId(TARGET), event)).toEqual({ ok: false, name: 'Example App', error: 'ended' });
    expect((await ended.client.view()).pairings).toEqual([]);
    const revoked = await paired();
    revoked.target.tokens.clear();
    expect(await revoked.client.takeEvent(hcpPairingId(TARGET), event)).toMatchObject({ ok: false, error: 'ended' });
    expect((await revoked.client.view()).ended).toMatchObject([{ name: 'Example App', why: 'revoked' }]);
  });
});
