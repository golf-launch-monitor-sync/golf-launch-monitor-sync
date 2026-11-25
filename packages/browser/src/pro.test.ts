// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { accountRefOf, MemoryStorage } from '@glmsync/core';
import { FakeProTarget, VirtualClock } from '@glmsync/core/testing';
import { readPage, type ProPage } from '@glmsync/provider-rankings';
import { owgrPage } from '@glmsync/provider-rankings/testing';
import proSchema from '../../../spec/prores/prores-1.schema.json' with { type: 'json' };
import { makeAjv } from '../../spec/src/check.ts';
import { ProClient, proPairingId } from './pro.ts';

const check = makeAjv().compile(proSchema);
const TARGET = 'https://app.example.org/hcp/v1';
const SALT = 'fake-pro-salt-0000001';

function world() {
  const target = new FakeProTarget({ base: TARGET });
  const clock = new VirtualClock(Date.parse('2026-11-25T18:00:00Z'));
  const storage = new MemoryStorage();
  const vault = new MemoryStorage();
  const client = new ProClient({ storage, vault, kind: 'extension', name: 'Golf Stats Sync for Chrome and Edge', version: '0.13.0', fetch: target.fetch, now: clock.now });
  return { target, clock, storage, vault, client };
}

function page(name = 'Max Mustermann', id = '90001'): ProPage {
  const d = owgrPage({ name, rank: '412th', avg: '0.9871', divisor: '40',
    rows: [{ name: 'Musterstadt Open', id: 90012, tour: 'DPWT', week: 40, year: 2026, finish: 'T17', points: '2.16597' }] });
  const r = readPage(d, `https://www.owgr.com/playerprofile/${name.toLowerCase().replace(/ /g, '-')}-${id}`, '', '2026-11-25');
  if (!r.ok) throw new Error('read');
  return r.page;
}

async function paired(w = world()) {
  expect(await w.client.offerPairing({ target: TARGET, code: 'P7M2PQ9X' })).toMatchObject({ ok: true, name: 'Example App' });
  return w;
}

describe('pairing for a pro’s pages', () => {
  it('pairs with provider pro, and says what went wrong', async () => {
    const w = await paired();
    expect((await w.client.view()).pairings).toMatchObject([{ id: proPairingId(TARGET), name: 'Example App', host: 'app.example.org' }]);
    expect(await world().client.offerPairing({ target: TARGET, code: 'WRONG123' })).toEqual({ ok: false, error: 'code' });
    expect(await world().client.offerPairing({ target: TARGET, code: 'P7M2PQ9X', provider: 'golfde' })).toEqual({ ok: false, error: 'provider' });
  });
});

describe('a page, sent on the player’s tap', () => {
  it('goes as one prores/1 batch after the plan, the page’s id only as its account_ref', async () => {
    const w = await paired();
    const v = await w.client.send(page());
    expect(w.target.plans).toEqual(['manual']);
    const b = w.target.imports[0];
    expect([check(b), check.errors ?? []]).toEqual([true, []]);
    expect(b).toMatchObject({ site: 'owgr', account_ref: accountRefOf(SALT, 'pro', 'owgr:90001'), player: { name: 'Max Mustermann' }, sync: { plan_id: 'pp_1', reason: 'manual' } });
    expect(JSON.stringify(b)).not.toContain('90001');
    expect(v.pairings[0]?.last).toEqual({ at: '2026-11-25T18:00:00.000Z', site: 'owgr', status: 'sent', tournaments: 1 });
    expect(v.question).toBeNull();
  });

  it('sends nothing of what isn’t a page, nor when the app wants nothing now', async () => {
    const w = await paired();
    await w.client.send({ site: 'owgr', name: 'X' });
    expect(w.target.plans).toEqual([]);
    w.target.due = false;
    const v = await w.client.send(page());
    expect(w.target.imports).toEqual([]);
    expect(v.pairings[0]?.last?.status).toBe('not_due');
  });

  it('asks the player when the app finds another name, and a yes sends it again, confirmed - from then on too', async () => {
    const w = await paired();
    w.target.player = 'Maximilian Mustermann-Beispiel';
    let v = await w.client.send(page());
    expect(w.target.imports).toEqual([]);
    expect(v.question).toMatchObject({ site: 'owgr', siteName: 'Official World Golf Ranking', name: 'Max Mustermann', targets: ['Example App'] });
    expect(v.pairings[0]?.last?.status).toBe('other_player');
    v = await w.client.answer(true);
    expect(v.question).toBeNull();
    expect(w.target.imports.map((b) => b.player)).toEqual([{ name: 'Max Mustermann', confirmed: true }]);
    await w.client.send(page());
    expect(w.target.imports[1]?.player).toEqual({ name: 'Max Mustermann', confirmed: true });
  });

  it('sends nothing after a no, and asks again on the next tap', async () => {
    const w = await paired();
    w.target.player = 'Someone Else';
    await w.client.send(page());
    let v = await w.client.answer(false);
    expect(w.target.imports).toEqual([]);
    expect(v.question).toBeNull();
    expect(v.pairings[0]?.last?.status).toBe('rejected');
    v = await w.client.send(page());
    expect(v.question?.name).toBe('Max Mustermann');
  });

  it('forgets an unanswered question after a day', async () => {
    const w = await paired();
    w.target.player = 'Someone Else';
    await w.client.send(page());
    w.clock.advance(25 * 3600_000);
    expect((await w.client.view()).question).toBeNull();
    expect((await w.client.answer(true)).question).toBeNull();
    expect(w.target.imports).toEqual([]);
  });

  it('says so when another page of the ranking is connected', async () => {
    const w = await paired();
    await w.client.send(page());
    const v = await w.client.send(page('Max Mustermann', '90002'));
    expect(v.pairings[0]?.last?.status).toBe('other_account');
    expect(w.target.imports).toHaveLength(1);
  });

  it('a target down is a state, an ended pairing a farewell', async () => {
    const w = await paired();
    w.target.fail = 503;
    let v = await w.client.send(page());
    expect(v.pairings[0]?.last).toMatchObject({ status: 'failed', error: 'unavailable' });
    w.target.fail = null;
    w.target.disconnected = true;
    v = await w.client.send(page());
    expect(v.pairings).toEqual([]);
    expect(v.ended).toMatchObject([{ name: 'Example App', why: 'disconnected' }]);
    expect((await w.client.clearEnded()).ended).toEqual([]);
  });

  it('a token the app revoked ends the pairing here', async () => {
    const w = await paired();
    w.target.tokens.clear();
    const v = await w.client.send(page());
    expect(v.pairings).toEqual([]);
    expect(v.ended).toMatchObject([{ why: 'revoked' }]);
  });

  it('disconnecting tells the app', async () => {
    const w = await paired();
    const v = await w.client.removePairing(proPairingId(TARGET));
    expect(v.pairings).toEqual([]);
    expect(await w.vault.get('glmsync/pro/pairings')).toBe('[]');
  });
});
