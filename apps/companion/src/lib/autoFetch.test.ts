// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { HcpView } from '@glmsync/browser/hcp';
import { describe, expect, it } from 'vitest';
import { AUTO_OWNER, AUTO_SPARE, AutoFetch, LOAD_WITHIN_MS } from './autoFetch.ts';

const running = { fetch_all: 'running', run: { phase: 'history', auto: true } } as unknown as HcpView;
const ready = { fetch_all: 'ready', run: null } as unknown as HcpView;

function world(opts: { due?: boolean; start?: HcpView; fail?: boolean } = {}) {
  const calls: string[] = [];
  const shown: boolean[] = [];
  const timers: { fn: () => void; ms: number; on: boolean }[] = [];
  let release: (() => void) | null = null;
  const gate = { hold: false };
  const hcp = {
    autoDue: async (o?: { spare?: number }) => {
      calls.push(`autoDue:${o?.spare}`);
      if (gate.hold) await new Promise<void>((r) => (release = r));
      if (opts.fail) throw new Error('down');
      return opts.due ?? true;
    },
    startFetchAll: async (owner: string, o?: { auto?: boolean }) => {
      calls.push(`start:${owner}:${o?.auto}`);
      return opts.start ?? running;
    },
    interruptFetchAll: async (owner?: string) => {
      calls.push(`interrupt:${owner}`);
      return ready;
    },
    leaveFetchAll: async (owner: string) => {
      calls.push(`leave:${owner}`);
      return ready;
    },
    cancelFetchAll: async () => {
      calls.push('cancel');
      return ready;
    },
  };
  const auto = new AutoFetch({
    hcp,
    open: () => shown.push(true),
    close: () => shown.push(false),
    timers: {
      set: (fn, ms) => {
        const t = { fn, ms, on: true };
        timers.push(t);
        return t;
      },
      clear: (h) => {
        (h as { on: boolean }).on = false;
      },
    },
  });
  return { auto, calls, shown, timers, gate, release: () => release?.() };
}

describe('a run by itself on the phone (spec 1.17.0)', () => {
  it('when due: starts the run for the unseen window, keeping a run for the tap, and shows the window', async () => {
    const w = world();
    expect(await w.auto.look(false)).toBe(true);
    expect(w.calls).toEqual([`autoDue:${AUTO_SPARE}`, `start:${AUTO_OWNER}:true`]);
    expect(w.auto.state).toBe('opening');
    expect(w.shown).toEqual([true]);
    expect(w.auto.loaded()).toBe(true);
    expect(w.auto.loaded()).toBe(false); // the next page loading starts nothing again
    expect(w.auto.state).toBe('running');
    expect(w.timers[0]?.on).toBe(false);
    w.auto.ended();
    expect(w.auto.state).toBe('idle');
    expect(w.shown).toEqual([true, false]);
  });

  it('not due, while the player’s own golf.de window is open, or a look already under way: nothing', async () => {
    expect(await world({ due: false }).auto.look(false)).toBe(false);
    const open = world();
    expect(await open.auto.look(true)).toBe(false);
    expect(open.calls).toEqual([]);
    const twice = world();
    expect(await twice.auto.look(false)).toBe(true);
    expect(await twice.auto.look(false)).toBe(false);
    expect(twice.calls.filter((c) => c.startsWith('autoDue'))).toHaveLength(1);
  });

  it('a run that doesn’t start (another one, the limit) shows nothing; a failure to ask is no crash', async () => {
    const w = world({ start: ready });
    expect(await w.auto.look(false)).toBe(false);
    expect(w.shown).toEqual([]);
    expect(w.auto.state).toBe('idle');
    const down = world({ fail: true });
    expect(await down.auto.look(false)).toBe(false);
    expect(down.auto.state).toBe('idle');
  });

  it('the app to the back: the run is interrupted (no hold) and the window goes', async () => {
    const w = world();
    await w.auto.look(false);
    w.auto.loaded();
    await w.auto.interrupt();
    expect(w.calls.at(-1)).toBe(`interrupt:${AUTO_OWNER}`);
    expect(w.shown).toEqual([true, false]);
    expect(await w.auto.interrupt()).toBeNull(); // nothing under way: nothing asked
    expect(w.calls.filter((c) => c.startsWith('interrupt'))).toHaveLength(1);
  });

  it('gone to the back while still asking: the look starts nothing, and a newer look isn’t taken for it', async () => {
    const w = world();
    w.gate.hold = true;
    const first = w.auto.look(false);
    await Promise.resolve();
    await w.auto.interrupt();
    expect(w.auto.state).toBe('idle');
    w.release();
    expect(await first).toBe(false);
    expect(w.calls).toEqual([`autoDue:${AUTO_SPARE}`]);
    expect(w.shown).toEqual([]);
  });

  it('a page that leads elsewhere (a sign-in) ends the run as an early stop; the player’s Stop the same', async () => {
    const w = world();
    await w.auto.look(false);
    await w.auto.refused();
    expect(w.calls.at(-1)).toBe(`leave:${AUTO_OWNER}`);
    expect(w.shown).toEqual([true, false]);
    const s = world();
    await s.auto.look(false);
    s.auto.loaded();
    await s.auto.stop();
    expect(s.calls.at(-1)).toBe('cancel');
    expect(s.auto.state).toBe('idle');
  });

  it('a window whose page doesn’t load within a minute: interrupted', async () => {
    const w = world();
    await w.auto.look(false);
    expect(w.timers[0]?.ms).toBe(LOAD_WITHIN_MS);
    w.timers[0]?.fn();
    await Promise.resolve();
    expect(w.calls.at(-1)).toBe(`interrupt:${AUTO_OWNER}`);
    expect(w.auto.state).toBe('idle');
  });

  it('tells its listeners each state, and a listener that throws breaks nothing', async () => {
    const w = world();
    const seen: string[] = [];
    w.auto.subscribe(() => {
      throw new Error('mine');
    });
    const off = w.auto.subscribe((s) => seen.push(s));
    await w.auto.look(false);
    w.auto.loaded();
    off();
    w.auto.ended();
    expect(seen).toEqual(['looking', 'opening', 'running']);
  });
});
