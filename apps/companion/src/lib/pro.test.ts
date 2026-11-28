// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { FakeProTarget, VirtualClock } from '@glmsync/core/testing';
import { readPage } from '@glmsync/provider-rankings';
import { owgrPage } from '@glmsync/provider-rankings/testing';
import { describe, expect, it } from 'vitest';
import { LastPage, makePro, proClientName } from './pro.ts';
import { readRankingMessage, readScript } from './rankingsPage.ts';
import { ChunkedSecrets, MemorySecrets } from '@glmsync/engine';

const TARGET = 'https://app.example.org/hcp/v1';
const OWGR = 'https://www.owgr.com/playerprofile/max-mustermann-90001';

function world(os = 'ios') {
  const target = new FakeProTarget({ base: TARGET });
  const clock = new VirtualClock(Date.parse('2026-11-25T18:00:00Z'));
  const secrets = new MemorySecrets();
  const storage = new MemoryStorage();
  const pro = makePro({ storage, secrets: new ChunkedSecrets(secrets), os, version: '0.3.0', fetch: target.fetch, now: clock.now });
  return { target, clock, secrets, storage, pro };
}

/** The page as the window's page script posts it, read back as the window reads it. */
function page(name = 'Max Mustermann') {
  const d = owgrPage({ name, rank: '412th', avg: '0.9871', divisor: '40', rows: [{ name: 'Musterstadt Open', id: 90012, tour: 'DPWT', week: 40, year: 2026, finish: 'T17', points: '2.16597' }] });
  const url = `https://www.owgr.com/playerprofile/${name.toLowerCase().replace(/ /g, '-')}-90001`;
  const r = readPage(d, url, '', '2026-11-25');
  if (!r.ok) throw new Error('read');
  const ask = '0a1b2c3d4e5f60718293';
  expect(readScript(ask, '2026-11-25')).not.toBeNull();
  const got = readRankingMessage(url, JSON.stringify({ glmsync: 'ranking-page', ask, page: r.page }), ask);
  if (!got?.ok) throw new Error('message');
  return got.page;
}

describe('a pro’s pages on the phone', () => {
  it('pairs as the phone with provider pro, keeps the import token only in the secure store, and sends the page on the tap', async () => {
    const w = world();
    expect(await w.pro.offerPairing({ target: TARGET, code: 'P7M2PQ9X', provider: 'pro' })).toMatchObject({ ok: true, name: 'Example App' });
    expect(JSON.parse(w.target.received[0]?.body ?? '{}')).toMatchObject({ provider: 'pro', client: { kind: 'companion', name: 'Golf Stats Sync for iPhone', version: '0.3.0' } });
    for (const k of w.secrets.data.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
    const vault = JSON.parse((w.secrets.data.get('glmsync.pro.pairings') ?? '').replace(/^v:/, '')) as { token: string }[];
    const token = vault[0]?.token ?? '';
    expect(token.length).toBeGreaterThan(8);
    expect(await w.storage.get('glmsync/pro/entries')).not.toContain(token);

    const v = await w.pro.send(page());
    expect(w.target.plans).toEqual(['manual']);
    expect(w.target.imports).toHaveLength(1);
    expect(JSON.stringify(w.target.imports[0])).not.toContain('90001'); // the site's id only as the account_ref
    expect(v.pairings[0]?.last).toMatchObject({ site: 'owgr', status: 'sent', tournaments: 1 });
  });

  it('asks whether a page under another name is the player’s, and sends it confirmed on the yes', async () => {
    const w = world('android');
    await w.pro.offerPairing({ target: TARGET, code: 'P7M2PQ9X' });
    expect(JSON.parse(w.target.received[0]?.body ?? '{}')).toMatchObject({ client: { name: 'Golf Stats Sync for Android' } });
    const asked = await w.pro.send(page('Moritz Muster'));
    expect(asked.question).toMatchObject({ site: 'owgr', name: 'Moritz Muster', targets: ['Example App'] });
    expect(w.target.imports).toHaveLength(0);
    const v = await w.pro.answer(true);
    expect(v.question).toBeNull();
    expect(w.target.imports).toHaveLength(1);
    expect(w.target.imports[0]).toMatchObject({ player: { name: 'Moritz Muster', confirmed: true } });
  });

  it('names itself by the phone', () => {
    expect(proClientName('ios')).toBe('Golf Stats Sync for iPhone');
    expect(proClientName('android')).toBe('Golf Stats Sync for Android');
    expect(proClientName(undefined)).toBe('Golf Stats Sync');
  });
});

describe('the page kept for the window', () => {
  it('keeps only a player’s page, and forgets it', async () => {
    const storage = new MemoryStorage();
    const last = new LastPage(storage);
    expect(await last.get()).toBeNull();
    await last.set('https://www.owgr.com/current-world-ranking');
    expect(await last.get()).toBeNull();
    await last.set(OWGR);
    expect(await last.get()).toBe(OWGR);
    // Something else in its place (an older version, a hand) isn't opened.
    await storage.set('glmsync/pro/lastPage', 'https://evil.test/players/1');
    expect(await last.get()).toBeNull();
    // His profile on a tour too, but no other page of the tour.
    await last.set('https://www.progolftour.de/tournament-details/sample-desert-open-2026');
    expect(await last.get()).toBeNull();
    await last.set('https://www.progolftour.de/player-profile/99001?year=2026');
    expect(await last.get()).toBe('https://www.progolftour.de/player-profile/99001?year=2026');
    // His page on europeantour.com (either tour, any part), but not the site's list of players.
    await last.set('https://www.europeantour.com/hotelplanner-tour/players/');
    expect(await last.get()).toBe('https://www.progolftour.de/player-profile/99001?year=2026');
    await last.set('https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour');
    expect(await last.get()).toBe('https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour');
    await last.set(OWGR);
    await last.clear();
    expect(await last.get()).toBeNull();
  });

  it('an unreadable store starts at the site’s search rather than failing', async () => {
    const last = new LastPage({
      get: () => Promise.reject(new Error('gone')),
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    });
    expect(await last.get()).toBeNull();
  });
});
