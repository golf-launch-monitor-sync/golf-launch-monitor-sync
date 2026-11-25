// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { owgrPage, rolexPage } from '@glmsync/provider-rankings/testing';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain script of the build, without types
import { moduleText, OUT } from '../../scripts/rankings-page.mjs';
import { READ_FUNCTION, readRankingMessage, readScript, TABLE_WAIT_MS } from './rankingsPage.ts';
import { RANKINGS_PAGE_SCRIPT } from './rankingsPageScript.ts';

describe('the world ranking window’s page script', () => {
  it('is what scripts/rankings-page.mjs writes (run it after a change to the reading or the entry)', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await moduleText());
  });

  it('evaluates no code of its own and ends as a web view wants', () => {
    expect(RANKINGS_PAGE_SCRIPT).not.toMatch(/\bnew Function\s*\(|\beval\s*\(/);
    expect(RANKINGS_PAGE_SCRIPT.trimEnd().endsWith('true;')).toBe(true);
  });
});

const OWGR = 'https://www.owgr.com/playerprofile/matt-example-17646';
const ROLEX = 'https://www.rolexrankings.com/players/4711';
const ASK = '0a1b2c3d4e5f60718293';
const DAY = '2026-11-25';
const rows = [
  { name: 'Example Open', id: 9001, tour: 'DPWT', week: 47, year: 2026, finish: 'T17', points: '4.10' },
  { name: 'Multi Win Bonus', tour: 'BP', week: 46, year: 2026, finish: 'BP', points: '1.00' },
  { name: 'Made Up Championship', id: 9002, tour: 'PGAT', week: 45, year: 2026, finish: 'MC', points: '0.00' },
];

/** The site's page, made up: the script runs in it as the web view runs it; a clock the test moves. */
function site(href: string, document: { querySelectorAll(s: string): ArrayLike<unknown> } & { title?: string }) {
  const posted: string[] = [];
  const asked: string[] = [];
  const timers: (() => void)[] = [];
  let clock = 1_000_000;
  const win: Record<string, unknown> = {
    location: { href },
    document,
    fetch: (url: unknown) => {
      asked.push(String(url));
      return Promise.reject(new Error('no'));
    },
    XMLHttpRequest: class {
      open(_m: string, url: string) {
        asked.push(url);
      }
    },
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
    Date: class extends Date {
      static override now() {
        return clock;
      }
    },
    JSON,
    Object,
    URL,
  };
  win.window = win;
  runInNewContext(RANKINGS_PAGE_SCRIPT, win);
  const tick = (ms: number) => {
    clock += ms;
    const due = timers.splice(0);
    for (const fn of due) fn();
  };
  /** The app's tap on *Send*: the script it injects. */
  const send = (ask = ASK, day = DAY) => runInNewContext(readScript(ask, day) as string, win);
  return { win, posted, asked, tick, send };
}

describe('the page script in the site’s page', () => {
  it('reads nothing until the app asks; then the player’s page as it shows, to the app', () => {
    const doc = Object.assign(owgrPage({ name: 'Matt Example', rank: '3rd', avg: '7.12', divisor: '47', rows }), { title: 'Matt Example | OWGR' });
    const p = site(OWGR, doc);
    expect(p.posted).toEqual([]); // the page alone: nothing read, nothing posted
    p.send();
    expect(p.posted).toHaveLength(1);
    const got = readRankingMessage(OWGR, p.posted[0], ASK);
    expect(got).toEqual({
      ok: true,
      page: {
        site: 'owgr',
        id: '17646',
        name: 'Matt Example',
        ranking: { source: 'owgr', as_of: DAY, rank: 3, points: 7.12, events: 47 },
        tournaments: [
          { ref: 'owgr-9001', week: '2026-W47', tour: 'dp_world', name: 'Example Open', place: 17, tied: true, points: 4.1 },
          { ref: 'owgr-9002', week: '2026-W45', tour: 'pga_tour', name: 'Made Up Championship', result: 'MC', points: 0 },
        ],
      },
    });
    // It asked the site nothing of its own.
    expect(p.asked).toEqual([]);
  });

  it('reads Rolex’s page the same way', () => {
    const doc = Object.assign(rolexPage({ name: 'Erika Example', rank: '26', avg: '2.31', events: '52', rows: [{ name: 'Example Classic', id: 777, tour: 'LET', week: 47, year: 2026, position: '36T', points: '0.52', after: '26' }] }), {
      title: 'Erika Example - Players - Rolex Rankings',
    });
    const p = site(ROLEX, doc);
    p.send();
    const got = readRankingMessage(ROLEX, p.posted[0], ASK);
    expect(got?.ok && got.page).toMatchObject({ site: 'rolex', id: '4711', name: 'Erika Example', ranking: { rank: 26, points: 2.31, events: 52 } });
    expect(got?.ok && got.page.tournaments).toEqual([{ ref: 'rolex-777', week: '2026-W47', tour: 'let', name: 'Example Classic', place: 36, tied: true, points: 0.52 }]);
  });

  it('waits a little for OWGR’s table, then sends the ranking alone', () => {
    const doc = Object.assign(owgrPage({ name: 'Matt Example', rank: '3rd', avg: '7.12', divisor: '47', table: false }), { title: '' });
    const p = site(OWGR, doc);
    p.send();
    expect(p.posted).toEqual([]); // waiting for the table
    p.send(); // a second tap while reading does nothing more
    for (let waited = 0; waited <= TABLE_WAIT_MS; waited += 500) p.tick(500);
    expect(p.posted).toHaveLength(1);
    const got = readRankingMessage(OWGR, p.posted[0], ASK);
    expect(got).toMatchObject({ ok: true, page: { tournaments: null, ranking: { rank: 3 } } });
  });

  it('on any other page of the site it says so, and reads nothing', () => {
    const p = site('https://www.owgr.com/current-world-ranking', owgrPage({ name: 'Matt Example', rank: '3rd', avg: '7.12', rows }));
    p.send();
    expect(p.posted.map((d) => JSON.parse(d))).toEqual([{ glmsync: 'ranking-page', ask: ASK, why: 'not_player_page' }]);
  });

  it('a page that doesn’t say what the reading knows is read as nothing', () => {
    const p = site(OWGR, Object.assign(owgrPage({ name: 'Matt Example' }), { title: '' }));
    p.send();
    expect(readRankingMessage(OWGR, p.posted[0], ASK)).toEqual({ ok: false, why: 'changed_page' });
  });

  it('takes no call the app couldn’t have made, and stays out of other sites', () => {
    const doc = owgrPage({ name: 'Matt Example', rank: '3rd', avg: '7.12', rows });
    const p = site(OWGR, doc);
    const fn = p.win[READ_FUNCTION] as (a: unknown, d: unknown) => void;
    fn('x', DAY);
    fn(ASK, 'today');
    fn({ toString: () => ASK }, DAY);
    expect(p.posted).toEqual([]);
    // The function can't be swapped by the page for one of its own.
    expect(() => {
      'use strict';
      (p.win as Record<string, unknown>)[READ_FUNCTION] = () => undefined;
    }).toThrow();
    const elsewhere = site('https://evil.test/playerprofile/matt-example-17646', doc);
    expect(elsewhere.win[READ_FUNCTION]).toBeUndefined();
  });

  it('never stands in the page’s way: without the app’s bridge the page goes on', () => {
    const p = site(OWGR, Object.assign(owgrPage({ name: 'Matt Example', rank: '3rd', avg: '7.12', rows }), { title: '' }));
    delete p.win.ReactNativeWebView;
    expect(() => p.send()).not.toThrow();
    // A document that throws doesn't either.
    const broken = site(OWGR, {
      querySelectorAll: () => {
        throw new Error('boom');
      },
    });
    expect(() => broken.send()).not.toThrow();
    for (let i = 0; i < 40; i++) broken.tick(500);
    expect(broken.posted.map((d) => JSON.parse(d).why)).toEqual(['changed_page']);
  });
});
