// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The companion app's runs against a made-up target and a made-up Trackman, offline: the plan first,
 * the sign-in only to the provider, what happens when the sign-in, the pairing or the target goes.
 */
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { FakeTarget, VirtualClock, type FakeTargetOptions } from '@glmsync/core/testing';
import { MemoryStorage, type FetchLike, type FileOut } from '@glmsync/core';
import { validateBatch } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { MemorySecrets } from './secrets.ts';
import { DEMO_CREDENTIAL, makeServices } from './services.ts';

const SUB = '7c1d2e3f-0000-4000-8000-0000000000c1';
const DAY = 86_400_000;

function setup(opts: { plan?: FakeTargetOptions['plan'] } = {}) {
  const clock = new VirtualClock(Date.parse('2026-11-16T08:00:00Z'));
  const target = new FakeTarget(opts.plan ? { plan: opts.plan } : {});
  const tm = new FakeTrackman(clock.now);
  const token = fakeToken(SUB, { exp: Math.floor((clock.t + 7 * DAY) / 1000) });
  tm.tokens.add(token);
  tm.activities = [
    { id: 'A1', time: new Date(clock.t - DAY).toISOString(), kind: 'RANGE_PRACTICE' },
    { id: 'A2', time: new Date(clock.t - 2 * DAY).toISOString(), kind: 'RANGE_PRACTICE' },
  ];
  for (const a of tm.activities) tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const fetch: FetchLike = (url, init) => (url === GRAPHQL_URL ? tm.fetch(url, init) : target.fetch(url, init));
  const files: FileOut[] = [];
  const secrets = new MemorySecrets();
  const storage = new MemoryStorage();
  const services = makeServices({
    secrets,
    storage,
    fetch,
    now: clock.now,
    sleep: clock.sleep,
    writeFile: async (f) => {
      files.push(f);
    },
    version: '0.1.0-test',
  });
  return { clock, target, tm, token, services, files, secrets, storage };
}

async function paired(s: ReturnType<typeof setup>) {
  await s.services.load();
  return s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
}

describe('pairing', () => {
  it('keeps the import token in the secure store only, and the rest in storage', async () => {
    const s = setup();
    const p = await paired(s);
    expect(p.provider).toBe('trackman');
    const token = [...s.target.tokens][0] as string;
    expect([...s.secrets.data.values()].some((v) => v.includes(token))).toBe(true);
    expect([...s.storage.data.values()].some((v) => v.includes(token))).toBe(false);
    // A fresh start finds it again.
    const again = makeServices({ secrets: s.secrets, storage: s.storage });
    await again.load();
    expect(again.pairings.list().map((x) => x.token)).toEqual([token]);
  });

  it('pairing the same target again revokes the token it replaces', async () => {
    const s = setup();
    await paired(s);
    const first = [...s.target.tokens][0] as string;
    s.target.codes.add('NEWCODE77');
    await s.services.runner.pair({ target: s.target.base, code: 'NEWCODE77' });
    expect(s.services.pairings.list()).toHaveLength(1);
    expect(s.target.tokens.has(first)).toBe(false);
    expect(s.target.received.some((r) => r.method === 'DELETE' && r.headers.Authorization === `Bearer ${first}`)).toBe(true);
  });

  it('refuses a provider the app does not have, without asking the target', async () => {
    const s = setup();
    await s.services.load();
    await expect(s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X', provider: 'other' })).rejects.toThrow();
    expect(s.target.received).toHaveLength(0);
  });
});

describe('a sync', () => {
  it('asks the plan first and sends the sign-in to Trackman only', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token, 'Test Player');
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('synced');
    expect(report?.run.result?.sessions).toBe(2);
    expect(s.target.sessions.size).toBe(2);
    // The target hears no Trackman key; Trackman hears no import token.
    const importToken = [...s.target.tokens][0] as string;
    for (const r of s.target.received) expect(JSON.stringify(r)).not.toContain(s.token);
    for (const r of s.tm.requests) expect(JSON.stringify(r)).not.toContain(importToken);
    // The batches are olmd/1, with this app as their generator.
    for (const b of s.target.imports) {
      expect(validateBatch(b).ok).toBe(true);
      expect(b.generator?.name).toMatch(/companion/);
    }
  });

  it('asks Trackman nothing when the plan says not due', async () => {
    const s = setup({ plan: () => ({ due: false }) });
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('not_due');
    expect(s.tm.requests).toHaveLength(0);
  });

  it('without a sign-in asks Trackman nothing and tells the target why, when a sync is due', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.signIns.expire('trackman');
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('signed_out');
    expect(s.tm.requests).toHaveLength(0);
    const last = s.target.imports.at(-1);
    expect(last?.notice?.code).toBe('auth_expired');
    expect(last?.sessions).toEqual([]);
    expect(validateBatch(last).ok).toBe(true);
  });

  it('never signed in here: no batch (nothing to name the account with), no Trackman', async () => {
    const s = setup();
    await paired(s);
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('signed_out');
    expect(s.target.imports).toHaveLength(0);
    expect(s.tm.requests).toHaveLength(0);
  });

  it('tells the target where its sign-in stands with every plan (spec 1.5.0)', async () => {
    const s = setup({ plan: () => ({ due: false }) });
    await paired(s);
    await s.services.runner.syncAll('timer');
    expect(s.target.asked.at(-1)).toMatchObject({ client: 'companion', signin: 'none' });
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('open');
    expect(s.target.asked.at(-1)).toMatchObject({ reason: 'open', signin: 'ready' });
    await s.services.signIns.expire('trackman');
    await s.services.runner.syncAll('timer');
    expect(s.target.asked.at(-1)).toMatchObject({ signin: 'expired' });
  });

  it('says "other" when the target has another account connected', async () => {
    const s = setup();
    await paired(s);
    s.target.accountRef = 'c29tZWJvZHktZWxzZS1zb21lYm9keS1lbHNl';
    await s.services.signIns.set('trackman', s.token);
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('other_account');
    expect(s.target.signins.at(-1)).toEqual({ via: 'status', signin: 'other' });
    expect(s.tm.requests).toHaveLength(0);
  });

  it('a sign-in Trackman rejects goes, and may be renewed quietly afterwards', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    s.tm.tokens.clear();
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.notice).toBe('auth_expired');
    expect(s.services.signIns.credential('trackman')).toBeNull();
    expect(s.services.signIns.canRenew('trackman')).toBe(true);
    expect(s.services.signIns.renewalFits('trackman', fakeToken(SUB))).toBe(true);
    expect(s.services.signIns.renewalFits('trackman', fakeToken('someone-else-0000'))).toBe(false);
  });

  it('the target disconnected: the pairing goes, and with the last one the sign-in', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    s.target.disconnected = true;
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('disconnected');
    expect(s.services.pairings.list()).toHaveLength(0);
    expect(s.services.signIns.get('trackman')).toBeNull();
    expect(s.services.signIns.had('trackman')).toBeNull();
    expect([...s.secrets.data.keys()].filter((k) => k.startsWith('glmsync.signin') || k.startsWith('glmsync.had'))).toEqual([]);
  });

  it('the import token revoked in the target app: the pairing goes', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    s.target.tokens.clear();
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('disconnected');
    expect(s.services.pairings.list()).toHaveLength(0);
  });

  it('only the pairings of the target a link names', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const out = await s.services.runner.syncAll('manual', { target: 'https://other.example.org/lm/v1' });
    expect(out).toEqual([]);
    expect(s.target.asked).toHaveLength(0);
  });

  it('runs one at a time: two asked together never fetch side by side', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const [a, b] = await Promise.all([s.services.runner.syncAll('timer'), s.services.runner.syncAll('manual')]);
    expect(a[0]?.run.result?.sessions).toBe(2);
    // The second ran after the first had imported: everything it found was known already.
    expect(b[0]?.run.result?.sessions ?? 0).toBe(0);
    const plans = s.target.received.filter((r) => r.url.includes('/plan')).length;
    expect(plans).toBe(2);
  });

  it('remembers how the last run ended across a restart', async () => {
    const s = setup();
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('timer');
    const again = makeServices({ secrets: s.secrets, storage: s.storage });
    await again.load();
    expect(again.runner.lastRun(p.key)?.status).toBe('synced');
  });
});

describe('the older history', () => {
  it('adds up what the target took across runs, and keeps how much of the history is still to come (the wizard)', async () => {
    const s = setup({
      plan: (ask, t) => ({ due: true, plan_id: `p-${ask.reason}`, known_ids: t.known(), rounds: false, round_shots: true, max_sessions: 1, history: { done: false } }),
    });
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('connect');
    expect(s.services.runner.lastRun(p.key)).toMatchObject({ status: 'synced', total: { sessions: 1, rounds: 0 } });
    expect(s.services.runner.lastRun(p.key)?.left).toBeUndefined();
    await s.services.runner.backfill();
    expect(s.services.runner.lastRun(p.key)).toMatchObject({ reason: 'backfill', total: { sessions: 2, rounds: 0 }, left: 0 });
    // A run that brings nothing keeps both.
    await s.services.runner.syncAll('timer');
    expect(s.services.runner.lastRun(p.key)).toMatchObject({ total: { sessions: 2, rounds: 0 }, left: 0 });
  });

  it('waits as long as the target says between chunks', async () => {
    const s = setup({ plan: (ask) => (ask.reason === 'backfill' ? { due: false, wait_s: 75, history: { done: false } } : { due: false }) });
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    expect(await s.services.runner.backfill()).toBe(75);
    expect(s.tm.requests).toHaveLength(0);
  });

  it('nothing left once the target says the history is done', async () => {
    const s = setup({ plan: () => ({ due: false, history: { done: true } }) });
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    expect(await s.services.runner.backfill()).toBeNull();
  });
});

describe('the demo and the file', () => {
  it('the demo player into a file: an olmd file to share, and the guard counted it', async () => {
    const s = setup();
    await s.services.load();
    await s.services.signIns.set('demo', DEMO_CREDENTIAL, 'Demo');
    const run = await s.services.runner.toFile('demo');
    expect(run.status).toBe('synced');
    expect(s.files).toHaveLength(1);
    const file = JSON.parse((s.files[0] as FileOut).text) as unknown;
    expect(validateBatch(file).ok).toBe(true);
    const counts = await s.services.runner.counts('demo');
    expect(counts?.day).toBeGreaterThan(0);
    expect(counts?.limits.per_day).toBe(300);
  });

  it('the log to export names no content', async () => {
    const s = setup();
    await s.services.load();
    await s.services.signIns.set('demo', DEMO_CREDENTIAL);
    await s.services.runner.toFile('demo');
    const log = await s.services.runner.logFile();
    expect(log.name).toMatch(/^glmsync-requests-\d{4}-\d{2}-\d{2}\.json$/);
    const parsed = JSON.parse(log.text) as { format: string; accounts: { requests: unknown[] }[] };
    expect(parsed.format).toBe('glmsync-guard-log/1');
    expect(parsed.accounts[0]?.requests.length).toBeGreaterThan(0);
    expect(log.text).not.toContain('Demo');
  });
});

describe('Is this you?', () => {
  it('asks Trackman through the guard', async () => {
    const s = setup();
    await s.services.load();
    const who = await s.services.runner.who('trackman', s.token);
    expect(who.player).toBe('Test Player');
    expect(who.activities?.count).toBe(2);
    expect((await s.services.runner.counts('trackman'))).toBeNull(); // not signed in yet: nothing to show
    await s.services.signIns.set('trackman', s.token);
    expect((await s.services.runner.counts('trackman'))?.day).toBe(1);
  });

  it('names the targets bound to another account', async () => {
    const s = setup();
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('timer');
    expect(s.services.pairings.get(p.key)?.account_ref).toBeTruthy();
    expect(s.services.runner.otherAccountAt('trackman', s.token)).toEqual([]);
    expect(s.services.runner.otherAccountAt('trackman', fakeToken('someone-else-0000'))).toEqual(['Example App']);
  });
});
