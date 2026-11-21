// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { accountRefOf, MemoryStorage, type HcpResult } from '@glmsync/core';
import { FakeHcpTarget, VirtualClock } from '@glmsync/core/testing';
import { reduce, type Seen } from '@glmsync/provider-golfde';
import { AUTH_FAILED, entry, historyAnswer, memberAnswer, PERSONAL, resultsAnswer, scoringAnswer } from '@glmsync/provider-golfde/testing';
import hcpSchema from '../../../spec/hcp/dgvhcp-1.schema.json' with { type: 'json' };
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
    await w.client.see('p1', history(Array.from({ length: 7 }, (_, i) => entry({ tournamentDate: `2026-0${(i % 9) + 1}-1${i}T10:00:00+02:00` }))));
    await w.client.send();
    expect(w.target.imports.map((b) => b.results.length)).toEqual([3, 3, 1]);
    expect(w.target.imports.map((b) => !!b.index)).toEqual([true, false, false]);
  });

  it('sends the index alone when only it is new', async () => {
    const w = await paired();
    await w.client.see('p1', member());
    await w.client.send();
    expect(w.target.imports).toHaveLength(1);
    expect(w.target.imports[0]).toMatchObject({ results: [], index: { value: 8.1 } });
  });
});

describe('whose record it is', () => {
  it('results of a page wait for that page to name the account', async () => {
    const w = await paired();
    await w.client.see('p1', history([entry()]));
    let v = await w.client.send();
    expect(v).toMatchObject({ waiting: true, seen: 0 });
    expect(w.target.imports).toHaveLength(0);
    v = await w.client.see('p1', member());
    expect(v).toMatchObject({ waiting: false, seen: 1, fresh: 1 });
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

  it('another account’s record drops what was kept of the one before, and goes to no target that has another', async () => {
    const w = await paired();
    await w.client.see('p1', member(1));
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
    await w.client.see('p1', history([entry()]));
    const v = await w.client.send();
    expect(v.pairings[0]?.last).toMatchObject({ status: 'failed', error: 'unavailable' });
    expect(v.fresh).toBe(1);
  });

  it('the player ended the connection in the app: forgotten here, and said so', async () => {
    const w = await paired();
    w.target.disconnected = true;
    await w.client.see('p1', member());
    const v = await w.client.send();
    expect(v.pairings).toEqual([]);
    expect(v.ended).toMatchObject([{ name: 'Example App', why: 'disconnected' }]);
    expect((await w.client.clearEnded()).ended).toEqual([]);
  });

  it('a token the app revoked: forgotten', async () => {
    const w = await paired();
    w.target.tokens.clear();
    await w.client.see('p1', member());
    expect((await w.client.send()).ended).toMatchObject([{ why: 'revoked' }]);
  });

  it('signed out on golf.de: the target hears it once', async () => {
    const w = await paired();
    await w.client.see('p1', member());
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
    await w.client.see('p1', history([entry()]));
    await w.client.offerPairing({ target: TARGET, code: 'H7M2PQ9X' });
    await w.client.send();
    expect(w.target.results.size).toBe(1);
  });
});
