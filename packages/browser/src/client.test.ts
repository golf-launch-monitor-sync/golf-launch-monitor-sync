// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The browser clients' common part against a made-up Trackman and a made-up target: pairing, the
 * key from the portal, "Is this you?", syncs, a key that runs out, a target that ends the
 * connection, the older history, a file. Offline; all data synthetic.
 */

import { accountRefOf, MemoryStorage, type FetchLike } from '@glmsync/core';
import { FakeTarget, VirtualClock } from '@glmsync/core/testing';
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { describe, expect, it } from 'vitest';
import { BrowserClient, pairingId, type Entry } from './client.ts';
import { translator } from './i18n.ts';
import { lastText } from './view.ts';

const NOW = Date.parse('2026-11-16T09:00:00Z');
const SUB = 'player-0001';
const exp = (clock: VirtualClock, hours: number) => Math.round(clock.t / 1000 + hours * 3600);
const issued = { iss: 'https://login.trackmangolf.com' };

function world(opts: { target?: ConstructorParameters<typeof FakeTarget>[0] } = {}) {
  const clock = new VirtualClock(NOW);
  const tm = new FakeTrackman(clock.now);
  tm.profile = { fullName: 'Alex Example' };
  tm.activities = [
    { id: 'A2', time: '2026-11-15T17:00:00Z', kind: 'RANGE_PRACTICE', location: { name: 'Example Range' } },
    { id: 'A1', time: '2026-11-12T17:00:00Z', kind: 'SIMULATOR' },
  ];
  for (const a of tm.activities) tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', time: a.time, measurement: { carry: 140, ballSpeed: 50 } }] });
  const target = new FakeTarget(opts.target ?? {});
  const fetch: FetchLike = (url, init) => (url.startsWith(GRAPHQL_URL) ? tm.fetch(url, init) : target.fetch(url, init));
  const storage = new MemoryStorage();
  const vault = new MemoryStorage();
  const client = new BrowserClient({ storage, vault, kind: 'extension', name: 'GLMS test', version: '0.0.1', fetch, now: clock.now, sleep: clock.sleep, random: () => 0 });
  const token = (sub = SUB, hours = 24 * 7) => {
    const t = fakeToken(sub, { exp: exp(clock, hours), ...issued });
    tm.tokens.add(t);
    return t;
  };
  return { clock, tm, target, client, storage, vault, token };
}

async function paired(w: ReturnType<typeof world>) {
  const out = await w.client.offerPairing({ target: w.target.base, code: 'K7M2PQ9X' });
  expect(out).toMatchObject({ ok: true, name: 'Example App' });
  return out.ok ? out.id : '';
}

describe('pairing', () => {
  it('reads the pairing fragment strictly', () => {
    expect(BrowserClient.readFragment('#target=https%3A%2F%2Fapp.example.org%2Flm%2Fv1&code=K7M2PQ9X')).toEqual({
      target: 'https://app.example.org/lm/v1',
      code: 'K7M2PQ9X',
    });
    expect(BrowserClient.readFragment('#target=javascript%3Aalert(1)&code=K7M2PQ9X')).toBeNull();
    expect(BrowserClient.readFragment('#code=K7M2PQ9X&code=K7M2PQ9X&target=https%3A%2F%2Fa.example')).toBeNull();
  });

  it('pairs, and pairing the same target again replaces the pairing and ends the old token', async () => {
    const w = world();
    const id = await paired(w);
    expect(id).toBe(pairingId(w.target.base));
    const first = [...w.target.tokens][0];
    w.target.codes.add('SECOND01');
    expect(await w.client.offerPairing({ target: `${w.target.base}/`, code: 'SECOND01' })).toMatchObject({ ok: true, replaced: true });
    expect(w.target.tokens.has(first as string)).toBe(false);
    expect(w.target.tokens.size).toBe(1);
    expect((await w.client.status()).pairings).toHaveLength(1);
  });

  it('says why a pairing failed instead of throwing', async () => {
    const w = world();
    expect(await w.client.offerPairing({ target: w.target.base, code: 'WRONG001' })).toEqual({ ok: false, error: 'code' });
    expect(await w.client.offerPairing({ target: w.target.base, code: 'K7M2PQ9X', provider: 'other' })).toEqual({ ok: false, error: 'provider' });
    const down = world({ target: { fail: { '/pair': { status: 503 } } } });
    expect(await down.client.offerPairing({ target: down.target.base, code: 'K7M2PQ9X' })).toEqual({ ok: false, error: 'unreachable' });
    const broken: FetchLike = async () => {
      throw new TypeError('offline');
    };
    const offline = new BrowserClient({ storage: new MemoryStorage(), vault: new MemoryStorage(), kind: 'web', name: 'x', version: '1', fetch: broken });
    expect(await offline.offerPairing({ target: 'https://app.example.org/lm/v1', code: 'K7M2PQ9X' })).toEqual({ ok: false, error: 'unreachable' });
  });
});

describe('the key and "Is this you?"', () => {
  it('asks who it is once, through the guard, and the same key again asks nobody', async () => {
    const w = world();
    await paired(w);
    const t = w.token();
    expect(await w.client.setKey(t)).toEqual({ ok: true, changed: true, ready: false, asking: true });
    const s = await w.client.status();
    expect(s.key).toMatchObject({ state: 'confirm', who: { player: 'Alex Example', activities: { count: 2, place: 'Example Range' } } });
    expect(s.attention).toBe('confirm');
    expect(w.tm.count('Who')).toBe(1);
    expect(await w.client.setKey(t)).toEqual({ ok: true, changed: false, ready: false, asking: false });
    expect(w.tm.count()).toBe(1);
    expect(s.counts?.day).toBe(1);
  });

  it('syncs only after "Yes, that\'s me", and sends the key to Trackman only', async () => {
    const w = world();
    await paired(w);
    const t = w.token();
    await w.client.setKey(t);
    expect((await w.client.run('connect')).outcomes[0]?.outcome).toEqual({ status: 'skipped', why: 'confirm' });
    expect(w.target.imports).toHaveLength(0);
    expect((await w.client.confirm(true)).state).toBe('ready');
    const r = await w.client.run('connect');
    expect(r.outcomes[0]?.outcome).toMatchObject({ status: 'synced', result: { sessions: 2 } });
    expect(w.target.sessions.size).toBe(2);
    for (const req of w.target.received) expect(JSON.stringify(req)).not.toContain(t);
    for (const req of w.tm.requests) expect(req.headers.Authorization).toBe(`Bearer ${t}`);
    const s = await w.client.status();
    expect(s.pairings[0]).toMatchObject({ last: { status: 'synced', result: { sessions: 2 } }, account_ref: accountRefOf(w.target.salt, 'trackman', SUB) });
    expect(s.attention).toBeNull();
  });

  it('keeps the confirmed account’s name for the list of connections, only while its key is there', async () => {
    const w = world();
    await paired(w);
    await w.client.setKey(w.token());
    expect((await w.client.status()).player).toBeNull();
    await w.client.confirm(true);
    expect((await w.client.status()).player).toBe('Alex Example');
    // Another account's key (the target knows no account yet, so it asks again): not that name.
    await w.client.setKey(w.token('player-0002'));
    expect((await w.client.status()).player).toBeNull();
    await w.client.dropKey();
    expect((await w.client.status()).player).toBeNull();
  });

  it('"No" drops the key, and the same account is refused until the player says otherwise', async () => {
    const w = world();
    await paired(w);
    const t = w.token();
    await w.client.setKey(t);
    expect((await w.client.confirm(false)).state).toBe('none');
    expect(await w.client.setKey(t)).toEqual({ ok: false, error: 'rejected' });
    const other = w.token('player-0002');
    expect(await w.client.setKey(other)).toMatchObject({ ok: true });
    await w.client.forgetRejected();
    expect(await w.client.setKey(t)).toMatchObject({ ok: true, changed: true });
  });

  it('needs no question when the target has this account connected already', async () => {
    const w = world();
    w.target.accountRef = accountRefOf(w.target.salt, 'trackman', SUB);
    await paired(w);
    expect(await w.client.setKey(w.token())).toEqual({ ok: true, changed: true, ready: true, asking: false });
    expect(w.tm.count()).toBe(0);
  });

  it('asks nothing of Trackman for another account than the one the target has', async () => {
    const w = world();
    w.target.accountRef = accountRefOf(w.target.salt, 'trackman', 'somebody-else');
    await paired(w);
    expect(await w.client.setKey(w.token())).toEqual({ ok: true, changed: true, ready: false, asking: false });
    const s = await w.client.status();
    expect(s.key.state).toBe('other');
    expect(s.attention).toBe('other_account');
    await w.client.run('manual');
    expect(w.tm.count()).toBe(0);
  });

  it('asks again when another account signs in while the first one’s question is still open (18 Nov)', async () => {
    // The portal tab showed someone else's account; the player signed out and in with theirs in the same tab
    // before answering. The question is a new one: the extension must put it to the player again.
    const w = world();
    await paired(w);
    expect(await w.client.setKey(w.token('someone-else'))).toMatchObject({ ok: true, asking: true });
    expect(await w.client.setKey(w.token())).toEqual({ ok: true, changed: true, ready: false, asking: true });
    // A new key of the account already being asked about is no new question.
    w.clock.advance(60_000);
    expect(await w.client.setKey(w.token())).toEqual({ ok: true, changed: true, ready: false, asking: false });
  });

  it('says the player said no to an account here, for the way to another one', async () => {
    const w = world();
    await paired(w);
    expect((await w.client.status()).rejected).toBe(false);
    await w.client.setKey(w.token('someone-else'));
    await w.client.confirm(false);
    expect((await w.client.status()).rejected).toBe(true);
  });

  it('refuses what is no key, or one that ran out', async () => {
    const w = world();
    expect(await w.client.setKey('nonsense')).toEqual({ ok: false, error: 'invalid' });
    expect(await w.client.setKey(fakeToken(SUB, { exp: exp(w.clock, -1) }))).toEqual({ ok: false, error: 'expired' });
    expect(await w.client.setKey(fakeToken(SUB))).toEqual({ ok: false, error: 'expired' });
  });

  it('can ask again when Trackman could not say who it is', async () => {
    const w = world();
    await paired(w);
    w.tm.override = () => new TypeError('offline');
    await w.client.setKey(w.token());
    expect((await w.client.status()).key).toMatchObject({ state: 'confirm', who: null, error: 'unavailable' });
    delete w.tm.override;
    w.clock.advance(3_600_000); // past the guard's backoff after a request without an answer
    expect(await w.client.retryWho()).toMatchObject({ state: 'confirm', who: { player: 'Alex Example' } });
  });
});

describe('where the sign-in stands, for the target (spec 1.5.0)', () => {
  it('tells it with every plan while it can fetch, and by a status (no lease) while it can’t', async () => {
    const w = world();
    await paired(w);
    // Not signed in yet: no plan, a status.
    await w.client.run('timer');
    expect(w.target.asked).toHaveLength(0);
    expect(w.target.signins).toEqual([{ via: 'status', signin: 'none' }]);
    // Signed in, waiting for "Is this you?": the target hears it as soon as the extension reports.
    await w.client.setKey(w.token());
    await w.client.report();
    expect(w.target.signins.at(-1)).toEqual({ via: 'status', signin: 'confirm' });
    await w.client.confirm(true);
    // Ready: nothing to report by a status; the plan carries it.
    const told = w.target.signins.length;
    await w.client.report();
    expect(w.target.signins).toHaveLength(told);
    await w.client.run('connect');
    expect(w.target.asked.at(-1)).toMatchObject({ reason: 'connect', signin: 'ready' });
    expect((await w.client.status()).pairings[0]?.signin).toBe('ready');
  });

  it('says "other" when the target has another account connected', async () => {
    const w = world();
    w.target.accountRef = accountRefOf(w.target.salt, 'trackman', 'somebody-else');
    await paired(w);
    await w.client.setKey(w.token());
    await w.client.run('manual');
    expect(w.target.signins.at(-1)).toEqual({ via: 'status', signin: 'other' });
    expect((await w.client.status()).pairings[0]?.signin).toBe('other');
  });

  it('says "expired" with the plan that tells the target, and with the statuses after it', async () => {
    const w = world();
    await paired(w);
    await w.client.setKey(w.token(SUB, 1));
    await w.client.confirm(true);
    w.clock.advance(2 * 3_600_000);
    await w.client.run('timer');
    expect(w.target.asked.at(-1)?.signin).toBe('expired');
    await w.client.run('timer');
    expect(w.target.signins.at(-1)).toEqual({ via: 'status', signin: 'expired' });
  });

  it('learns from the status that the app ended the connection, also before a sign-in', async () => {
    const w = world();
    const id = await paired(w);
    w.target.disconnected = true;
    expect((await w.client.run('timer', id)).outcomes[0]?.outcome).toEqual({ status: 'disconnected' });
    expect((await w.client.status()).pairings).toHaveLength(0);
  });
});

describe('the status while a sync runs', () => {
  it('answers at once and says which pairing is fetching (a yes seemed to do nothing, 18 Nov)', async () => {
    const w = world();
    const id = await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    const tmFetch = w.tm.fetch;
    w.tm.fetch = async (url, init) => {
      await held;
      return tmFetch(url, init);
    };
    const running = w.client.run('connect');
    await new Promise((done) => setTimeout(done, 0));
    const s = await w.client.status();
    expect(s.running).toEqual([id]);
    release();
    await running;
    expect((await w.client.status()).running).toEqual([]);
  });
});

describe('a sign-in that runs out', () => {
  it('tells the target once, asking Trackman nothing', async () => {
    const w = world();
    await paired(w);
    const t = w.token(SUB, 1);
    await w.client.setKey(t);
    await w.client.confirm(true);
    w.clock.advance(2 * 3_600_000);
    const before = w.tm.count();
    expect((await w.client.run('timer')).outcomes[0]?.outcome).toEqual({ status: 'told_expired' });
    const told = w.target.imports.at(-1);
    expect(told).toMatchObject({ sessions: [], rounds: [], notice: { code: 'auth_expired' }, account_ref: accountRefOf(w.target.salt, 'trackman', SUB) });
    expect(told?.sync?.plan_id).toBeTruthy();
    const plans = w.target.asked.length;
    expect((await w.client.run('timer')).outcomes[0]?.outcome).toEqual({ status: 'skipped', why: 'expired' });
    expect(w.target.imports).toHaveLength(1);
    // Told once: from then on no plan (no lease taken from the player's other devices), only the status.
    expect(w.target.asked.length).toBe(plans);
    expect(w.tm.count()).toBe(before);
    const s = await w.client.status();
    expect(s.attention).toBe('sign_in');
    // Signed in again (the same account): no question, syncing goes on.
    expect(await w.client.setKey(w.token())).toEqual({ ok: true, changed: true, ready: true, asking: false });
  });

  it('learns from the status, not a plan, that the app ended the connection meanwhile', async () => {
    const w = world();
    await paired(w);
    await w.client.setKey(w.token(SUB, 1));
    await w.client.confirm(true);
    w.clock.advance(2 * 3_600_000);
    await w.client.run('timer');
    w.target.disconnected = true;
    const plans = w.target.asked.length;
    expect((await w.client.run('timer')).outcomes[0]?.outcome).toEqual({ status: 'disconnected' });
    expect(w.target.asked.length).toBe(plans);
    expect(await w.client.status()).toMatchObject({ pairings: [], ended: [{ why: 'disconnected' }], key: { state: 'none' } });
  });

  it('Trackman refusing the key: the batch says so, and the same key from the portal is not tried again', async () => {
    const w = world();
    await paired(w);
    const t = w.token();
    await w.client.setKey(t);
    await w.client.confirm(true);
    w.tm.tokens.delete(t);
    const r = await w.client.run('manual');
    expect(r.outcomes[0]?.outcome).toMatchObject({ status: 'synced', notice: { code: 'auth_expired' } });
    expect(w.target.imports.at(-1)?.notice?.code).toBe('auth_expired');
    expect((await w.client.status()).key.state).toBe('expired');
    const asked = w.tm.count();
    expect(await w.client.setKey(t)).toEqual({ ok: false, error: 'expired' });
    await w.client.run('timer');
    expect(w.tm.count()).toBe(asked);
    expect(w.target.imports).toHaveLength(1);
    expect(JSON.stringify([...w.vault.data.values()])).not.toContain(t);
  });
});

describe('the target ends it', () => {
  it('disconnected in the app: the pairing goes, and the sign-in with it', async () => {
    const w = world();
    await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    w.target.disconnected = true;
    expect((await w.client.run('timer')).outcomes[0]?.outcome).toEqual({ status: 'disconnected' });
    const s = await w.client.status();
    expect(s.pairings).toHaveLength(0);
    expect(s.key.state).toBe('none');
    expect(s.ended).toMatchObject([{ name: 'Example App', why: 'disconnected' }]);
    await w.client.clearEnded();
    expect((await w.client.status()).ended).toEqual([]);
  });

  it('a token removed in the app: the pairing goes, the sign-in stays for the others', async () => {
    const w = world();
    await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    w.target.tokens.clear();
    await w.client.run('timer');
    const s = await w.client.status();
    expect(s.pairings).toHaveLength(0);
    expect(s.key.state).toBe('ready');
    expect(s.ended).toMatchObject([{ why: 'revoked' }]);
  });

  it('the player disconnects here: the target is told', async () => {
    const w = world();
    const id = await paired(w);
    await w.client.removePairing(id);
    expect(w.target.tokens.size).toBe(0);
    expect((await w.client.status()).pairings).toEqual([]);
  });

  it('a target that is down is a line to show, not an error', async () => {
    const w = world({ target: { fail: { '/plan': { status: 503 } } } });
    await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    expect((await w.client.run('manual')).outcomes[0]?.outcome).toMatchObject({ status: 'failed' });
    expect((await w.client.status()).pairings[0]?.last).toMatchObject({ status: 'failed', error: 'unavailable' });
  });
});

describe('a lease another device holds (spec 1.13.0)', () => {
  it('keeps the last real result and puts who is fetching beside it; the next real one takes it away', async () => {
    let busy = false;
    const w = world({
      target: {
        plan: (_ask, t) =>
          busy
            ? { due: false, busy: true, holder: { kind: 'companion', since: '2026-11-16T09:01:00Z' } }
            : { due: true, plan_id: 'p1', known_ids: t.known(), rounds: false, round_shots: true, max_sessions: 40 },
      },
    });
    await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    await w.client.run('timer');
    busy = true;
    w.clock.advance(120_000);
    await w.client.run('timer');
    let p = (await w.client.status()).pairings[0];
    expect(p?.last).toMatchObject({ status: 'synced', result: { sessions: 2 } });
    expect(p?.aside).toEqual({ at: new Date(w.clock.t).toISOString(), holder: { kind: 'companion', since: '2026-11-16T09:01:00Z' } });
    expect(lastText(p as Entry, translator('de'), 'de', w.clock.t)).toMatch(/2 neue Sessions.* · .*Golf Stats Sync auf deinem Handy, seit \d\d:\d\d/);
    busy = false;
    w.clock.advance(3_600_000);
    await w.client.run('manual');
    p = (await w.client.status()).pairings[0];
    expect(p?.aside).toBeUndefined();
  });

  it('busy before anything came: says who, as the target named it', async () => {
    const w = world({ target: { plan: () => ({ due: false, busy: true, holder: { kind: 'web' } }) } });
    await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    await w.client.run('timer');
    const p = (await w.client.status()).pairings[0];
    expect(p?.last).toMatchObject({ status: 'busy', holder: { kind: 'web' } });
    expect(lastText(p as Entry, translator('en'), 'en', w.clock.t)).toMatch(/the web app is fetching right now\.$/);
  });
});

describe('the older history', () => {
  it('adds up what each target took, and keeps how much of the history is still to come (the wizard shows both)', async () => {
    const w = world({
      target: {
        plan: (ask, t) =>
          ask.reason === 'backfill'
            ? { due: true, plan_id: 'h1', known_ids: t.known(), rounds: false, round_shots: true, max_sessions: 1, history: { done: false } }
            : { due: true, plan_id: 'p1', known_ids: t.known(), rounds: false, round_shots: true, max_sessions: 1, history: { done: false } },
      },
    });
    const id = await paired(w);
    await w.client.setKey(w.token());
    // Nothing before the yes: no count to show.
    expect((await w.client.status()).pairings[0]?.brought).toBeUndefined();
    await w.client.confirm(true);
    await w.client.run('connect');
    let p = (await w.client.status()).pairings[0];
    expect(p?.brought).toEqual({ sessions: 1, rounds: 0, shots: 1 });
    expect(p?.left).toBeUndefined();
    w.clock.advance(120_000);
    await w.client.run('backfill', id);
    p = (await w.client.status()).pairings[0];
    expect(p?.brought).toEqual({ sessions: 2, rounds: 0, shots: 2 });
    expect(p?.left).toBe(0);
  });

  it('is asked for chunk by chunk, when the target says it may', async () => {
    let historyDone = false;
    const w = world({
      target: {
        plan: (ask, t) =>
          ask.reason === 'backfill'
            ? historyDone
              ? { due: false, history: { done: true } }
              : { due: true, plan_id: 'h1', known_ids: t.known(), rounds: false, round_shots: true, max_sessions: 10, history: { done: false } }
            : { due: false, history: { done: false } },
      },
    });
    const id = await paired(w);
    await w.client.setKey(w.token());
    await w.client.confirm(true);
    await w.client.run('timer');
    expect(await w.client.nextBackfill()).toBe(w.clock.t);
    const r = await w.client.run('backfill');
    expect(r.outcomes[0]?.outcome).toMatchObject({ status: 'synced' });
    const next = await w.client.nextBackfill();
    expect(next).toBeGreaterThan(w.clock.t);
    expect((await w.client.run('backfill')).outcomes[0]?.outcome).toEqual({ status: 'skipped', why: 'history' });
    w.clock.advance(120_000);
    historyDone = true;
    await w.client.run('backfill', id);
    expect(await w.client.nextBackfill()).toBeNull();
  });
});

describe('a file', () => {
  it('writes what is new as olmd/1, and only what is new the next time', async () => {
    const w = world();
    const t = w.token();
    await w.client.setKey(t);
    await w.client.confirm(true);
    const files: { name: string; text: string }[] = [];
    const out = await w.client.toFile('manual', async (f) => {
      files.push(f);
    });
    expect(out).toMatchObject({ status: 'synced', result: { sessions: 2 } });
    expect(files[0]?.name).toMatch(/^olmd-trackman-\d{8}-\d{6}\.json$/);
    expect(JSON.parse(files[0]?.text ?? '{}')).toMatchObject({ format: 'olmd/1', provider: 'trackman' });
    expect(files[0]?.text).not.toContain(t);
    w.clock.advance(60_000);
    expect(await w.client.toFile('manual', async (f) => void files.push(f))).toMatchObject({ result: { sessions: 0 } });
  });

  it('needs a confirmed key', async () => {
    const w = world();
    expect(await w.client.toFile('manual', async () => undefined)).toEqual({ status: 'skipped', why: 'none' });
  });
});

describe('the guard counts', () => {
  it('are shown for the account signed in, and exported without content', async () => {
    const w = world();
    await paired(w);
    const t = w.token();
    await w.client.setKey(t);
    await w.client.confirm(true);
    await w.client.run('connect');
    const s = await w.client.status();
    expect(s.counts).toMatchObject({ day: w.tm.count(), limits: { per_hour: 60, per_day: 300 } });
    const log = await w.client.exportLog();
    expect(log.accounts[0]?.requests).toHaveLength(w.tm.count());
    expect(JSON.stringify(log)).not.toContain(SUB);
    expect(JSON.stringify(log)).not.toContain('Example Range');
  });
});
