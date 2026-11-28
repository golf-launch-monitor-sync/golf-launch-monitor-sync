// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A target app binding to the sync service on Android, offline: what the service passed on is read
 * strictly, only a paired target is synced, the plan first, and a binding in a loop costs little.
 */
import { GRAPHQL_URL } from '@glmsync/provider-trackman';
import { FakeTrackman, fakeToken } from '@glmsync/provider-trackman/testing';
import { FakeTarget, VirtualClock, type FakeTargetOptions } from '@glmsync/core/testing';
import { MemoryStorage, type FetchLike } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import { NUDGE_MIN_GAP_MS, NudgeGate, readNudge, runNudge } from './nudge.ts';
import { type KeyedPairing, MemorySecrets } from '@glmsync/engine';
import { makeServices } from './services.ts';

const SUB = '7c1d2e3f-0000-4000-8000-0000000000c1';
const DAY = 86_400_000;
const link = (target: string, extra = '') => `glmsync://sync?target=${encodeURIComponent(target)}${extra}`;

function setup(opts: { plan?: FakeTargetOptions['plan'] } = {}) {
  const clock = new VirtualClock(Date.parse('2026-11-16T08:00:00Z'));
  const target = new FakeTarget(opts.plan ? { plan: opts.plan } : {});
  const tm = new FakeTrackman(clock.now);
  const token = fakeToken(SUB, { exp: Math.floor((clock.t + 7 * DAY) / 1000) });
  tm.tokens.add(token);
  tm.activities = [{ id: 'A1', time: new Date(clock.t - DAY).toISOString(), kind: 'RANGE_PRACTICE' }];
  tm.nodes.set('A1', { strokes: [{ club: 'Iron7', measurement: { carry: 140, ballSpeed: 50 } }] });
  const fetch: FetchLike = (url, init) => (url === GRAPHQL_URL ? tm.fetch(url, init) : target.fetch(url, init));
  const services = makeServices({ secrets: new MemorySecrets(), storage: new MemoryStorage(), fetch, now: clock.now, sleep: clock.sleep });
  const deps = { services: async () => services, gate: new NudgeGate(), now: clock.now };
  return { clock, target, tm, token, services, deps };
}

async function paired(s: ReturnType<typeof setup>) {
  await s.services.load();
  await s.services.runner.pair({ target: s.target.base, code: 'K7M2PQ9X' });
  await s.services.signIns.set('trackman', s.token);
}

const pairing = (base: string) => ({ base }) as KeyedPairing;

describe('what the service passed on', () => {
  const pairings = [pairing('https://app.example.org/lm/v1/')];

  it('a paired target, with the reason it gave', () => {
    expect(readNudge({ link: link('https://app.example.org/lm/v1'), reason: 'open' }, pairings)).toEqual({
      ok: true,
      nudge: { target: 'https://app.example.org/lm/v1', reason: 'open' },
    });
  });

  it('no reason, or one of the client\'s own, reads as manual', () => {
    for (const reason of [undefined, null, '', 'timer', 'backfill', 'connect', 7]) {
      const read = readNudge({ link: link('https://app.example.org/lm/v1'), reason }, pairings);
      expect(read.ok && read.nudge.reason).toBe('manual');
    }
  });

  it('a target this phone is not paired with is left alone', () => {
    expect(readNudge({ link: link('https://other.example.org/lm/v1'), reason: 'open' }, pairings)).toEqual({ ok: false, error: 'unpaired' });
    expect(readNudge({ link: link('https://app.example.org/lm/v1'), reason: 'open' }, [])).toEqual({ ok: false, error: 'unpaired' });
  });

  it('anything but a sync link that names its target is refused', () => {
    const cases: [unknown, string][] = [
      [null, 'invalid:data'],
      ['glmsync://sync', 'invalid:data'],
      [[link('https://app.example.org/lm/v1')], 'invalid:data'],
      [{}, 'invalid:link'],
      [{ link: 42 }, 'invalid:link'],
      [{ link: 'glmsync://sync' }, 'missing:target'],
      [{ link: link('https://app.example.org/lm/v1', '&return=exampleapp%3A%2F%2Fback') }, 'unexpected:return'],
      [{ link: `glmsync://pair?target=${encodeURIComponent('https://app.example.org/lm/v1')}&code=K7M2PQ9X` }, 'invalid:action'],
      [{ link: 'glmsync://sync?target=javascript%3Aalert(1)' }, 'invalid:target'],
    ];
    for (const [data, error] of cases) expect([data, readNudge(data, pairings)]).toEqual([data, { ok: false, error }]);
  });
});

describe('the gate', () => {
  it('one at a time per target, then not again within the gap', () => {
    const gate = new NudgeGate();
    expect(gate.admit('a', 0)).toBe(true);
    expect(gate.admit('a', 1)).toBe(false);
    expect(gate.admit('b', 1)).toBe(true);
    gate.done('a');
    expect(gate.admit('a', NUDGE_MIN_GAP_MS - 1)).toBe(false);
    expect(gate.admit('a', NUDGE_MIN_GAP_MS)).toBe(true);
  });

  it('a clock that went back does not lock a target out', () => {
    const gate = new NudgeGate();
    expect(gate.admit('a', 50_000)).toBe(true);
    gate.done('a');
    expect(gate.admit('a', 1_000)).toBe(true);
  });
});

describe('a nudge', () => {
  it('syncs the paired target: the plan first, with the reason the target gave', async () => {
    const s = setup();
    await paired(s);
    const out = await runNudge({ link: link(s.target.base), reason: 'open' }, s.deps);
    expect(out.status).toBe('ran');
    expect(out.status === 'ran' && out.runs.map((r) => r.run.status)).toEqual(['synced']);
    expect(s.target.asked.map((a) => a.reason)).toEqual(['open']);
    expect(s.target.sessions.size).toBe(1);
    expect(s.services.runner.lastRun(s.services.pairings.list()[0]!.key)?.reason).toBe('open');
  });

  it('asks the provider nothing when the plan says not due', async () => {
    const s = setup({ plan: () => ({ due: false }) });
    await paired(s);
    const out = await runNudge({ link: link(s.target.base), reason: 'manual' }, s.deps);
    expect(out.status === 'ran' && out.runs.map((r) => r.run.status)).toEqual(['not_due']);
    expect(s.tm.requests).toHaveLength(0);
  });

  it('an unpaired target hears nothing from this phone', async () => {
    const s = setup();
    await paired(s);
    const out = await runNudge({ link: link('https://other.example.org/lm/v1'), reason: 'manual' }, s.deps);
    expect(out).toEqual({ status: 'ignored', why: 'unpaired' });
    expect(s.target.received.filter((r) => r.url.includes('/plan'))).toHaveLength(0);
    expect(s.tm.requests).toHaveLength(0);
  });

  it('binding in a loop: one plan request, not one per binding', async () => {
    const s = setup();
    await paired(s);
    const data = { link: link(s.target.base), reason: 'manual' };
    const outs = await Promise.all(Array.from({ length: 20 }, () => runNudge(data, s.deps)));
    expect(outs.filter((o) => o.status === 'ran')).toHaveLength(1);
    expect(outs.filter((o) => o.status === 'ignored' && o.why === 'busy')).toHaveLength(19);
    expect(await runNudge(data, s.deps)).toEqual({ status: 'ignored', why: 'busy' });
    expect(s.target.asked).toHaveLength(1);
    // After the gap the next binding is a sync again.
    s.clock.t += NUDGE_MIN_GAP_MS;
    expect((await runNudge(data, s.deps)).status).toBe('ran');
    expect(s.target.asked).toHaveLength(2);
  });

  it('queues behind a run of the same app instead of fetching beside it', async () => {
    const s = setup();
    await paired(s);
    const [timer, nudge] = await Promise.all([
      s.services.runner.syncAll('timer'),
      runNudge({ link: link(s.target.base), reason: 'open' }, s.deps),
    ]);
    expect(timer[0]?.run.result?.sessions).toBe(1);
    // The nudge ran after the timer had imported: what it found was known already.
    expect(nudge.status === 'ran' && (nudge.runs[0]?.run.result?.sessions ?? 0)).toBe(0);
    expect(s.target.asked.map((a) => a.reason)).toEqual(['timer', 'open']);
  });

  it('never throws: a start that fails, or a run that breaks, is answered with why', async () => {
    const s = setup();
    await paired(s);
    const broken = {
      ...s.deps,
      services: async () => {
        throw new TypeError('storage gone');
      },
    };
    expect(await runNudge({ link: link(s.target.base) }, broken)).toEqual({ status: 'failed', why: 'TypeError' });
    const gate = new NudgeGate();
    const throwing = {
      gate,
      now: s.clock.now,
      services: async () => ({
        pairings: s.services.pairings,
        runner: {
          syncAll: async () => {
            throw new RangeError('x');
          },
        },
      }),
    };
    expect(await runNudge({ link: link(s.target.base) }, throwing)).toEqual({ status: 'failed', why: 'RangeError' });
    // The gate let go: after the gap the target may be nudged again.
    expect(gate.admit(s.target.base.replace(/\/+$/, ''), s.clock.now() + NUDGE_MIN_GAP_MS)).toBe(true);
  });
});
