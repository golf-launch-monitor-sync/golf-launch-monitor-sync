// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The engine's runs against a made-up target and a made-up Trackman, offline: the plan first,
 * the sign-in only to the provider, what happens when the sign-in, the pairing or the target goes.
 */
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { FakeTarget, VirtualClock, type FakeTargetOptions } from '@glmsync/core/testing';
import { MemoryStorage, type FetchLike, type FileOut } from '@glmsync/core';
import { validateBatch } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { MemorySecrets } from './secrets.ts';
import { makeEngine } from './engine.ts';
import { DEMO_CREDENTIAL } from './providers.ts';

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
  const services = makeEngine({
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
    const again = makeEngine({ secrets: s.secrets, storage: s.storage });
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

  it('the target ended the pairing (token_invalid): it stays listed as ended until paired again (Reginald’s test of 27 Nov)', async () => {
    const s = setup();
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const key = s.services.pairings.list()[0]!.key;
    s.target.tokens.clear();
    const [report] = await s.services.runner.syncAll('timer');
    expect(report?.run.status).toBe('disconnected');
    expect(s.services.pairings.list()).toHaveLength(0);
    expect(s.services.pairings.ended()).toEqual([{ key, provider: 'trackman', target: { name: s.target.name }, at: s.clock.t }]);
    // Kept across a start of the app.
    const again = makeEngine({ secrets: s.secrets, storage: s.storage, now: s.clock.now, version: '0.1.0-test' });
    await again.load();
    expect(again.pairings.ended().map((e) => e.key)).toEqual([key]);
    // Paired again from the app: the ended row goes.
    s.target.codes.add('NEWCODE77');
    await s.services.runner.pair({ target: s.target.base, code: 'NEWCODE77' });
    expect(s.services.pairings.ended()).toEqual([]);
  });

  it('ended by the player here, or taken off the list: no ended row', async () => {
    const s = setup();
    await paired(s);
    await s.services.runner.unpair(s.services.pairings.list()[0]!.key);
    expect(s.services.pairings.ended()).toEqual([]);
    s.target.codes.add('NEWCODE77');
    await s.services.runner.pair({ target: s.target.base, code: 'NEWCODE77' });
    s.target.disconnected = true;
    await s.services.runner.syncAll('timer');
    const [e] = s.services.pairings.ended();
    expect(e).toBeDefined();
    await s.services.pairings.forgetEnded(e!.key);
    expect(s.services.pairings.ended()).toEqual([]);
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
    const [a, b] = await Promise.all([s.services.runner.syncAll('timer'), s.services.runner.syncAll('open')]);
    expect(a[0]?.run.result?.sessions).toBe(2);
    // The second ran after the first had imported: everything it found was known already.
    expect(b[0]?.run.result?.sessions ?? 0).toBe(0);
    const plans = s.target.received.filter((r) => r.url.includes('/plan')).length;
    expect(plans).toBe(2);
  });

  // Reginald, 25 Nov (11:16/11:18): the phone fetched 8 sessions, its batch took its time, and "Fetch now" meanwhile
  // fetched the same 8 again (17 requests to Trackman instead of 9). A tap while a sync is under way joins it (SY-5).
  it('a tap on "fetch now" while a sync is under way joins it: one plan, Trackman asked once', async () => {
    let let_go: () => void = () => undefined;
    const slow = new Promise<void>((r) => (let_go = r));
    const s = setup();
    s.target.opts.hold = { '/import': slow };
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const opened = s.services.runner.syncAll('open'); // the target app nudged it
    await s.clock.sleep(0);
    expect(s.services.runner.syncing()).toEqual({ reason: 'open' });
    const tapped = s.services.runner.syncAll('manual');
    const again = s.services.runner.syncAll('manual'); // and once more, impatiently
    let_go();
    const [o, t1, t2] = await Promise.all([opened, tapped, again]);
    expect(o[0]?.run.result?.sessions).toBe(2);
    expect(t1).toEqual(o);
    expect(t2).toEqual(o);
    expect(s.target.asked.map((a) => a.reason)).toEqual(['open']);
    expect(s.tm.requests.filter((r) => JSON.stringify(r).includes('A1')).length).toBe(1);
    expect(s.services.runner.syncing()).toBeNull();
  });

  it('a tap joins a sync that turns out not due, and then fetches itself', async () => {
    const s = setup({ plan: (ask) => (ask.reason === 'manual' ? { due: true, plan_id: 'pl_m', known_ids: [], rounds: true, round_shots: true, max_sessions: 40 } : { due: false }) });
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const [o, t1] = await Promise.all([s.services.runner.syncAll('timer'), s.services.runner.syncAll('manual')]);
    expect(o[0]?.run.status).toBe('not_due');
    expect(t1[0]?.run.status).toBe('synced');
    expect(s.target.asked.map((a) => a.reason)).toEqual(['timer', 'manual']);
  });

  // Reginald, 25 Nov: after "8 new sessions" the phone said only "another device of yours is fetching" - the result
  // was gone, and the device was the phone itself. The last real result stays; a busy plan goes beside it, with who.
  it('keeps the last real result when a later plan is busy or not due, and says who holds the lease', async () => {
    let busy = false;
    const s = setup({
      plan: () =>
        busy
          ? { due: false, busy: true, holder: { kind: 'extension', since: '2026-11-16T10:17:00Z' } }
          : { due: true, plan_id: 'pl_1', known_ids: [], rounds: true, round_shots: true, max_sessions: 40 },
    });
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    // 11:16 and 11:18 in Berlin, on a day its made-up sign-in still holds.
    s.clock.t = Date.parse('2026-11-16T10:16:00Z');
    await s.services.runner.syncAll('open');
    busy = true;
    s.clock.t = Date.parse('2026-11-16T10:18:00Z');
    const [r] = await s.services.runner.syncAll('timer');
    expect(r?.run.status).toBe('busy');
    expect(r?.run.holder).toEqual({ kind: 'extension', since: '2026-11-16T10:17:00Z' });
    const last = s.services.runner.lastRun(p.key);
    expect(last?.status).toBe('synced');
    expect(last?.result?.sessions).toBe(2);
    expect(last?.at).toBeLessThan(Date.parse('2026-11-16T10:17:00Z')); // the 11:16 run, not the 11:18 one
    expect(last?.aside).toEqual({ at: Date.parse('2026-11-16T10:18:00Z'), status: 'busy', holder: { kind: 'extension', since: '2026-11-16T10:17:00Z' } });
    // The next real run takes the aside away.
    busy = false;
    await s.services.runner.syncAll('manual');
    expect(s.services.runner.lastRun(p.key)?.aside).toBeUndefined();
  });

  it('remembers how the last run ended across a restart', async () => {
    const s = setup();
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('timer');
    const again = makeEngine({ secrets: s.secrets, storage: s.storage });
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

  it('keeps that the history only fills gaps while the target says so (spec 1.21.0), and no count of what is to come', async () => {
    let older: boolean | undefined;
    const history = () => ({ done: false, ...(older === undefined ? {} : { older }) });
    const s = setup({
      plan: (ask, t) => ({ due: true, plan_id: `p-${ask.reason}`, known_ids: t.known(), rounds: false, round_shots: true, max_sessions: 1, history: history() }),
    });
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    s.tm.activities.push({ id: 'A3', time: new Date(s.clock.t - 3 * DAY).toISOString(), kind: 'RANGE_PRACTICE' });
    s.tm.nodes.set('A3', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
    await s.services.runner.backfill();
    expect(s.services.runner.lastRun(p.key)?.older).toBeUndefined();
    expect(s.services.runner.lastRun(p.key)?.left).toBeGreaterThan(0);
    older = false;
    await s.services.runner.backfill();
    expect(s.services.runner.lastRun(p.key)).toMatchObject({ reason: 'backfill', older: false });
    expect(s.services.runner.lastRun(p.key)?.left).toBeUndefined();
    await s.services.runner.syncAll('timer');
    expect(s.services.runner.lastRun(p.key)?.older).toBe(false);
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

describe('a connection that only signs in (spec 1.27.0)', () => {
  const plans = (s: ReturnType<typeof setup>) => s.target.received.filter((r) => r.method === 'GET' && r.url.includes('/plan')).length;

  it('is kept as such from a pair link that says so, and fetches nothing after pairing, in the background or for the history', async () => {
    const s = setup();
    await s.services.load();
    const p = await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X', mode: 'signin_only' });
    expect(p.mode).toBe('signin_only');
    await s.services.signIns.set('trackman', s.token);
    for (const reason of ['connect', 'timer'] as const) expect(await s.services.runner.syncAll(reason)).toEqual([]);
    expect(await s.services.runner.backfill()).toBeNull();
    expect(plans(s)).toBe(0);
    expect(s.tm.requests).toHaveLength(0);
    // A fresh start knows it still.
    const again = makeEngine({ secrets: s.secrets, storage: s.storage });
    await again.load();
    expect(again.pairings.list()[0]?.mode).toBe('signin_only');
  });

  it('asks the plan when the app is opened, and goes back to fetching only when the target says so', async () => {
    let mode = 'signin_only';
    const s = setup({ plan: () => ({ due: true, mode, known_ids: [], rounds: false }) });
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const [first] = await s.services.runner.syncAll('timer');
    // Fetching until the target said otherwise: its plan says signin_only, so nothing is fetched although `due`.
    expect(first?.run.status).toBe('not_due');
    expect(s.tm.requests).toHaveLength(0);
    expect(s.services.pairings.list()[0]?.mode).toBe('signin_only');
    expect(await s.services.runner.syncAll('timer')).toEqual([]);
    mode = 'fetch';
    const [open] = await s.services.runner.syncAll('open');
    expect(open?.run.status).toBe('synced');
    // Fetching is what a pairing without a mode does (as before 1.27.0).
    expect(s.services.pairings.list()[0]?.mode).toBeUndefined();
  });

  it('remembers the provider account the target named, though it never hands a batch over', async () => {
    const s = setup({ plan: () => ({ due: false, mode: 'signin_only', account_ref: 'c3ludGhldGljLWFjY291bnQtcmVm' }) });
    await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('open');
    expect(s.services.pairings.list()[0]?.account_ref).toBe('c3ludGhldGljLWFjY291bnQtcmVm');
  });
});

// SR-8b: a target that needs a newer client (spec 1.22.0, the plan's `outdated`) used to look like "not due" - the
// player never heard that an update was all it took.
describe('a target that needs a newer version', () => {
  it('is a state of its own, with the version it was said to, and nothing asked of Trackman', async () => {
    const s = setup({ plan: (ask) => (ask.version === '0.1.0-test' ? { due: true, outdated: true } : { due: true, known_ids: [] }) });
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    const [r] = await s.services.runner.syncAll('timer');
    expect(r?.run.status).toBe('outdated');
    expect(r?.run.version).toBe('0.1.0-test');
    expect(s.tm.requests).toHaveLength(0);
    expect(s.services.runner.lastRun(p.key)?.status).toBe('outdated');
  });

  it('goes over the last real result rather than beside it, and the next plan takes it away again', async () => {
    let now: 'fetch' | 'old' | 'idle' = 'fetch';
    const s = setup({
      plan: () => (now === 'old' ? { due: false, outdated: true } : now === 'idle' ? { due: false } : { due: true, plan_id: 'pl_1', known_ids: [], rounds: false, max_sessions: 40 }),
    });
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.runner.syncAll('open');
    now = 'old';
    await s.services.runner.syncAll('timer');
    const told = s.services.runner.lastRun(p.key);
    expect(told?.status).toBe('outdated');
    expect(told?.aside).toBeUndefined();
    // What came before still counts (the wizard's totals).
    expect(told?.total?.sessions).toBe(2);
    // Updated: a plan that isn't due is the last word now, not a line beside "too old".
    now = 'idle';
    await s.services.runner.syncAll('timer');
    expect(s.services.runner.lastRun(p.key)?.status).toBe('not_due');
  });

  it('wins over a sign-in that ran out: signing in again would not help until the update', async () => {
    const s = setup({ plan: () => ({ due: false, outdated: true }) });
    const p = await paired(s);
    await s.services.signIns.set('trackman', s.token);
    await s.services.signIns.expire('trackman');
    const [r] = await s.services.runner.syncAll('timer');
    expect(r?.run.status).toBe('outdated');
    expect(s.target.imports).toHaveLength(0);
    expect(s.services.runner.lastRun(p.key)?.status).toBe('outdated');
  });
});
