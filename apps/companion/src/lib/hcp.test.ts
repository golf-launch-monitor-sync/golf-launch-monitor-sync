// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { HcpView } from '@glmsync/browser/hcp';
import { MemoryStorage } from '@glmsync/core';
import { FakeHcpTarget, VirtualClock } from '@glmsync/core/testing';
import { reduce, type Seen } from '@glmsync/provider-golfde';
import { entry, historyAnswer, memberAnswer } from '@glmsync/provider-golfde/testing';
import { describe, expect, it, vi } from 'vitest';
import { HcpSender, hcpClientName, makeHcp, sendDue, SlotSecrets } from './hcp.ts';
import { ChunkedSecrets, MemorySecrets } from '@glmsync/engine';

const TARGET = 'https://app.example.org/hcp/v1';
const member = () => reduce({ kind: 'graphql', op: 'GetMemberDetails' }, 200, memberAnswer()) as Seen;
const history = (n = 1) =>
  reduce(
    { kind: 'graphql', op: 'GetHandicapHistorySheet' },
    200,
    historyAnswer(Array.from({ length: n }, (_, i) => entry({ resultGuid: `c0ffee00-0000-4000-8000-00000000000${i}`, tournamentDate: `2026-10-0${i + 1}T10:00:00+02:00` })), n),
  ) as Seen;

function world(os = 'ios') {
  const target = new FakeHcpTarget({ base: TARGET });
  const clock = new VirtualClock(Date.parse('2026-11-22T12:00:00Z'));
  const secrets = new MemorySecrets();
  const storage = new MemoryStorage();
  const hcp = makeHcp({ storage, secrets: new ChunkedSecrets(secrets), os, version: '0.3.0', fetch: target.fetch, now: clock.now });
  return { target, clock, secrets, storage, hcp };
}

describe('the handicap record on the phone', () => {
  it('pairs as the phone, keeps the import token only in the secure store, and sends what golf.de’s pages showed', async () => {
    const w = world();
    expect(await w.hcp.offerPairing({ target: TARGET, code: 'H7M2PQ9X', provider: 'golfde' })).toMatchObject({ ok: true, name: 'Example App' });
    expect(JSON.parse(w.target.received[0]?.body ?? '{}')).toMatchObject({ provider: 'golfde', client: { kind: 'companion', name: 'Golf Stats Sync for iPhone', version: '0.3.0' } });
    // The token: in the secure store (under a key it takes), never in ordinary storage.
    for (const k of w.secrets.data.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
    const vault = JSON.parse((w.secrets.data.get('glmsync.hcp.pairings') ?? '').replace(/^v:/, '')) as { token: string }[];
    const token = vault[0]?.token ?? '';
    expect(token.length).toBeGreaterThan(8);
    expect(await w.storage.get('glmsync/hcp/entries')).not.toContain(token);

    await w.hcp.see('p1', member());
    await w.hcp.see('p1', history(2));
    // Nothing before the player's yes to the account golf.de's page named.
    expect(await w.hcp.send()).toMatchObject({ account: 'asking', fresh: 0 });
    expect(w.target.imports).toHaveLength(0);
    await w.hcp.confirm(true);
    const v = await w.hcp.send();
    expect(v).toMatchObject({ seen: 2, fresh: 0 });
    expect(w.target.results.size).toBe(2);
    expect(w.target.plans.every((p) => p.reason === 'manual' && p.client === 'companion')).toBe(true);
  });

  it('forgets whose record the pages showed when the app ends (a new app run starts without it)', async () => {
    const w = world('android');
    await w.hcp.offerPairing({ target: TARGET, code: 'H7M2PQ9X' });
    await w.hcp.see('p1', member());
    // The next run of the app: same storage and secure store, a new client.
    const again = makeHcp({ storage: w.storage, secrets: new ChunkedSecrets(w.secrets), os: 'android', fetch: w.target.fetch, now: w.clock.now });
    const v = await again.see('p2', history());
    expect(v.waiting).toBe(true); // golf.de has to name the account again before anything is kept for it
    expect((await again.view()).pairings).toHaveLength(1); // the pairing itself stays
  });

  it('names the phone to the target', () => {
    expect(hcpClientName('ios')).toBe('Golf Stats Sync for iPhone');
    expect(hcpClientName('android')).toBe('Golf Stats Sync for Android');
    expect(hcpClientName(undefined)).toBe('Golf Stats Sync');
  });
});

describe('the secure store’s slots', () => {
  it('keep each slot’s name, with / as .', async () => {
    const inner = new MemorySecrets();
    const slots = new SlotSecrets(inner);
    await slots.set('glmsync/hcp/pairings', 'x');
    expect([...inner.data.keys()]).toEqual(['glmsync.hcp.pairings']);
    expect(await slots.get('glmsync/hcp/pairings')).toBe('x');
    await slots.remove('glmsync/hcp/pairings');
    expect(inner.data.size).toBe(0);
  });

  it('refuse a name the store wouldn’t take rather than guess', async () => {
    const slots = new SlotSecrets(new MemorySecrets());
    expect(() => slots.get('glmsync/hcp/what?')).toThrow(/secure store/);
  });
});

const view = (over: Partial<HcpView> = {}): HcpView => ({
  pairings: [{ id: 'a', base: TARGET, name: 'Example App', paired_at: '2026-11-22T12:00:00Z', host: 'app.example.org' }],
  auto: true,
  seen: 3,
  fresh: 2,
  waiting: false,
  signed_out: false,
  changed_page: false,
  sending: false,
  ended: [],
  account: 'confirmed',
  index: null,
  fetch_all: 'no',
  run: null,
  auto_fetch: true,
  ...over,
});

function timers() {
  const pending = new Map<number, () => void>();
  let n = 0;
  return {
    pending,
    t: { set: (fn: () => void) => (pending.set(++n, fn), n), clear: (h: unknown) => void pending.delete(h as number) },
    fire: () => {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
  };
}

describe('sending a little after the last new page', () => {
  it('waits for the pages to settle: each new one moves the moment on, and one send follows', async () => {
    const tm = timers();
    const send = vi.fn(async () => view({ fresh: 0 }));
    const sender = new HcpSender({ send }, tm.t, 30_000);
    sender.seen(view());
    sender.seen(view());
    expect(tm.pending.size).toBe(1);
    expect(sender.waiting).toBe(true);
    tm.fire();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(sender.waiting).toBe(false);
  });

  it('waits for nothing that isn’t due: nothing new, sending by itself off, or only another account’s target', () => {
    expect(sendDue(view())).toBe(true);
    expect(sendDue(view({ fresh: 0 }))).toBe(false);
    expect(sendDue(view({ auto: false }))).toBe(false);
    expect(sendDue(view({ pairings: [{ ...view().pairings[0]!, other_account: true }] }))).toBe(false);
    const tm = timers();
    const sender = new HcpSender({ send: vi.fn() }, tm.t);
    sender.seen(view({ auto: false }));
    expect(tm.pending.size).toBe(0);
  });

  it('sends at once on leaving golf.de, and only if something waited', async () => {
    const tm = timers();
    const send = vi.fn(async () => view({ fresh: 0 }));
    const sender = new HcpSender({ send }, tm.t);
    expect(await sender.flush()).toBeNull();
    expect(send).not.toHaveBeenCalled();
    sender.seen(view());
    expect(await sender.flush()).toMatchObject({ fresh: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(tm.pending.size).toBe(0);
  });

  it('tells who listens, and never lets a failure escape a timer', async () => {
    const tm = timers();
    const sender = new HcpSender({ send: vi.fn(async () => Promise.reject(new Error('storage gone'))) }, tm.t);
    const heard: HcpView[] = [];
    sender.subscribe((v) => heard.push(v));
    sender.seen(view());
    tm.fire();
    expect(await sender.now()).toBeNull();
    expect(heard).toEqual([]);
    const ok = new HcpSender({ send: async () => view({ fresh: 0 }) }, tm.t);
    const off = ok.subscribe((v) => heard.push(v));
    ok.subscribe(() => {
      throw new Error('a listener’s own trouble');
    });
    await ok.now();
    off();
    await ok.now();
    expect(heard).toHaveLength(1);
  });
});
