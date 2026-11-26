// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { HcpView, RunTurn } from '@glmsync/browser/hcp';
import type { Step } from '@glmsync/provider-golfde/operate';
import { describe, expect, it } from 'vitest';
import { AUTO_OWNER } from './autoFetch.ts';
import { Driver, STEP_FUNCTION, stepScript, WINDOW_OWNER } from './fetchAll.ts';
import { HISTORY_SHEET_URL } from './golfdePage.ts';
import { sendDue } from './hcp.ts';

const view = { fetch_all: 'running' } as HcpView;

function driver(steps: (Step | Error)[], owner?: string) {
  const injected: string[] = [];
  const slept: number[] = [];
  const owners: string[] = [];
  const shown: HcpView[] = [];
  const d = new Driver({
    hcp: {
      runStep: async (owner: string): Promise<RunTurn> => {
        owners.push(owner);
        const s = steps.shift() ?? { do: 'end' };
        if (s instanceof Error) throw s;
        return { step: s, view };
      },
    },
    inject: (script) => injected.push(script),
    sleep: async (ms) => {
      slept.push(ms);
    },
    show: (v) => shown.push(v),
    ...(owner ? { owner } : {}),
  });
  return { d, injected, slept, owners, shown };
}

describe('the script for a step', () => {
  it('opens only an address a run may open', () => {
    expect(stepScript({ do: 'open', url: HISTORY_SHEET_URL })).toBe(`window.location.assign(${JSON.stringify(HISTORY_SHEET_URL)}); true;`);
    expect(stepScript({ do: 'open', url: 'https://evil.test/"); alert(1); ("' })).toBeNull();
  });

  it('hands a click or a page to the page script’s step function, quoted twice (no code from a cursor)', () => {
    const s = stepScript({ do: 'page', cursor: "a');alert(1);('" }) as string;
    expect(s).toContain(STEP_FUNCTION);
    expect(s).toContain(JSON.stringify(JSON.stringify({ do: 'page', cursor: "a');alert(1);('" })));
    expect(s.trimEnd().endsWith('true;')).toBe(true);
    expect(stepScript({ do: 'wait', ms: 5 })).toBeNull();
    expect(stepScript({ do: 'end' })).toBeNull();
  });
});

describe('the window drives a run', () => {
  it('the unseen window asks as itself (spec 1.17.0), never as the player’s window', async () => {
    const t = driver([{ do: 'open', url: HISTORY_SHEET_URL }, { do: 'end' }], AUTO_OWNER);
    await t.d.drive();
    expect(t.owners).toEqual([AUTO_OWNER, AUTO_OWNER]);
    expect(AUTO_OWNER).not.toBe(WINDOW_OWNER);
  });

  it('step after step, waiting where the run says, as the window', async () => {
    const t = driver([{ do: 'open', url: HISTORY_SHEET_URL }, { do: 'wait', ms: 4000 }, { do: 'click', what: 'scoring' }, { do: 'wait', ms: 50_000 }, { do: 'end' }]);
    await t.d.drive();
    expect(t.owners.every((o) => o === WINDOW_OWNER)).toBe(true);
    expect(t.injected).toHaveLength(2);
    expect(t.slept).toEqual([500, 4000, 500, 10_000]);
    expect(t.shown).toHaveLength(5);
    expect(t.d.driving).toBe(false);
  });

  it('one loop at a time; stop ends it; a failure to ask ends it without a crash', async () => {
    const t = driver([{ do: 'wait', ms: 300 }, { do: 'wait', ms: 300 }, { do: 'end' }]);
    const first = t.d.drive();
    void t.d.drive(); // a second tap: nothing more
    t.d.stop();
    await first;
    expect(t.owners.length).toBeLessThanOrEqual(1);
    const f = driver([new Error('storage')]);
    await expect(f.d.drive()).resolves.toBeUndefined();
    expect(f.d.driving).toBe(false);
  });
});

describe('sending by itself', () => {
  it('waits for the end of a run', () => {
    const v = { auto: true, fresh: 3, pairings: [{ other_account: false }] } as unknown as HcpView;
    expect(sendDue({ ...v, fetch_all: 'ready' })).toBe(true);
    expect(sendDue({ ...v, fetch_all: 'running' })).toBe(false);
  });
});
