// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { europeantour, progolftour } from '@glmsync/provider-tours';
import { docOf, ET_TITLE, etOverview, etResults, etStats, h, pgtLine, pgtProfile, pgtResult } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - a plain script of the build, without types
import { moduleText, OUT } from '../../scripts/tours-page.mjs';
import { READ_FUNCTION, readPickMessage, readScript, readTourMessage, TABLE_WAIT_MS } from './toursPage.ts';
import { TOURS_PAGE_SCRIPT } from './toursPageScript.ts';

describe('the tour window’s page script', () => {
  it('is what scripts/tours-page.mjs writes (run it after a change to the reading or the entry)', async () => {
    expect(readFileSync(OUT, 'utf8')).toBe(await moduleText());
  });

  it('evaluates no code of its own and ends as a web view wants', () => {
    expect(TOURS_PAGE_SCRIPT).not.toMatch(/\bnew Function\s*\(|\beval\s*\(/);
    expect(TOURS_PAGE_SCRIPT.trimEnd().endsWith('true;')).toBe(true);
  });
});

const PROFILE = 'https://www.progolftour.de/player-profile/99001?year=2026';
const RESULT = 'https://www.progolftour.de/tournament-details/sample-desert-open-2026';
const ASK = '0a1b2c3d4e5f60718293';

/** The site's page, made up: the script runs in it as the web view runs it; a clock the test moves. */
function site(href: string, document: unknown) {
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
  runInNewContext(TOURS_PAGE_SCRIPT, win);
  const tick = (ms: number) => {
    clock += ms;
    const due = timers.splice(0);
    for (const fn of due) fn();
  };
  /** The app's ask: the script it injects. */
  const read = (who: string | null = null, ask = ASK, today: string | null = null) => runInNewContext(readScript(ask, who, today) as string, win);
  return { win, posted, asked, tick, read };
}

/** A made-up document that can be listened on, as the site's (`change` of its own select) and with its title. */
function listened(doc: object, title: string) {
  const heard: { type: string; fn: (e: { target?: unknown }) => void }[] = [];
  const d = Object.assign(doc, { title, addEventListener: (type: string, fn: (e: { target?: unknown }) => void) => heard.push({ type, fn }) });
  const fire = (target: unknown) => heard.filter((x) => x.type === 'change').forEach((x) => x.fn({ target }));
  return { doc: d, fire };
}

describe('the page script in the tour’s page', () => {
  it('reads nothing until the app asks; then his profile as it shows', () => {
    const p = site(PROFILE, docOf(pgtProfile()));
    expect(p.posted).toEqual([]);
    p.read();
    expect(p.posted).toHaveLength(1);
    expect(readTourMessage(PROFILE, p.posted[0], ASK)).toEqual({ ok: true, profile: progolftour.readProfile(pgtProfile()) });
    expect(p.asked).toEqual([]); // it asked the site nothing of its own
  });

  it('on a tournament’s page only his line goes, nobody else’s name', () => {
    const p = site(RESULT, docOf(pgtResult()));
    p.read('Lena Beispiel');
    const got = readTourMessage(RESULT, p.posted[0], ASK);
    expect(got).toMatchObject({ ok: true, key: 'sample-desert-open-2026', line: { place: 6, tied: true, field: 4, rounds: [{ gross: 69 }, { gross: 70 }, { gross: 70 }] } });
    for (const other of ['Otto Erfunden', 'Max Ausgedacht', 'Paul Platzhalter']) expect(p.posted[0]).not.toContain(other);
  });

  it('a page without his line says why, and a tournament page without his name is no page to read', () => {
    const p = site(RESULT, docOf(pgtResult('sample-desert-open-2026', [pgtLine('1', 'Otto Erfunden', 66, 67, 68)])));
    p.read('Lena Beispiel');
    expect(readTourMessage(RESULT, p.posted[0], ASK)).toEqual({ ok: true, key: 'sample-desert-open-2026', unread: 'not_him' });
    const q = site(RESULT, docOf(pgtResult()));
    q.read(null);
    expect(q.posted.map((d) => JSON.parse(d))).toEqual([{ glmsync: 'tour-page', ask: ASK, why: 'not_player_page' }]);
    const r = site('https://www.progolftour.de/order-of-merit-en', docOf(pgtProfile()));
    r.read('Lena Beispiel');
    expect(r.posted.map((d) => JSON.parse(d).why)).toEqual(['not_player_page']);
  });

  it('waits a little for the table, then says the page changed', () => {
    const p = site(PROFILE, docOf(pgtProfile({ tables: [] })));
    p.read();
    expect(p.posted).toEqual([]); // waiting for the table
    p.read(); // a second ask while reading does nothing more
    for (let waited = 0; waited <= TABLE_WAIT_MS; waited += 500) p.tick(500);
    expect(p.posted.map((d) => JSON.parse(d).why)).toEqual(['changed_page']);
  });

  it('takes no call the app couldn’t have made, and stays out of other sites', () => {
    const p = site(PROFILE, docOf(pgtProfile()));
    const fn = p.win[READ_FUNCTION] as (a: unknown, w: unknown) => void;
    fn('x', null);
    fn(ASK, 7);
    fn({ toString: () => ASK }, null);
    expect(p.posted).toEqual([]);
    expect(() => {
      'use strict';
      (p.win as Record<string, unknown>)[READ_FUNCTION] = () => undefined;
    }).toThrow();
    expect(site('https://evil.test/player-profile/99001', docOf(pgtProfile())).win[READ_FUNCTION]).toBeUndefined();
  });

  it('never stands in the page’s way', () => {
    const p = site(PROFILE, docOf(pgtProfile()));
    delete p.win.ReactNativeWebView;
    expect(() => p.read()).not.toThrow();
    const broken = site(PROFILE, {
      querySelectorAll: () => {
        throw new Error('boom');
      },
    });
    expect(() => broken.read()).not.toThrow();
    expect(broken.posted.map((d) => JSON.parse(d).why)).toEqual(['changed_page']);
    // A page of a shape the module doesn't know: read as nothing.
    const odd = site(PROFILE, h('html', [h('h1', ['Lena Beispiel']), h('table', [h('tr', [h('th', ['A']), h('th', ['B']), h('th', ['C'])])])]));
    odd.read();
    expect(odd.posted.map((d) => JSON.parse(d).why)).toEqual(['changed_page']);
  });
});

const ET_RESULTS = 'https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour';
const TODAY = '2026-11-25';

describe('the page script on europeantour.com', () => {
  it('reads nothing until the app asks; then his page as it shows, with the day the app hands in', () => {
    const { doc } = listened(docOf(etResults()), ET_TITLE);
    const p = site(ET_RESULTS, doc);
    expect(p.posted).toEqual([]);
    p.read(null, ASK, TODAY);
    expect(p.posted).toHaveLength(1);
    const got = readTourMessage(ET_RESULTS, p.posted[0], ASK);
    expect(got).toEqual({ ok: true, et: europeantour.checkRead(europeantour.readPage(etResults(), ET_TITLE, TODAY)) });
    expect(got && 'et' in got ? got.et.tournaments.map((t) => [t.tour, t.rounds?.length]) : null).toEqual([
      ['hotelplanner', 4], ['hotelplanner', 2], ['dp_world', 4], ['hotelplanner', 4],
    ]);
    expect(p.asked).toEqual([]); // it asked the site nothing of its own
  });

  it('only tournaments that ended before the day the app names', () => {
    const { doc } = listened(docOf(etResults()), ET_TITLE);
    const p = site(ET_RESULTS, doc);
    p.read(null, ASK, '2026-10-01');
    const got = readTourMessage(ET_RESULTS, p.posted[0], ASK);
    expect(got && 'et' in got ? got.et.tournaments.map((t) => t.end) : null).toEqual(['2026-07-05', '2015-08-16']);
  });

  it('his overview and his statistics too, each a page of his', () => {
    const o = site('https://www.europeantour.com/players/jonas-beispiel-99002/?tour=hotelplanner-tour', listened(docOf(etOverview()), 'Jonas BEISPIEL - Players - European Tour').doc);
    o.read(null, ASK, TODAY);
    expect(JSON.parse(o.posted[0] as string).read.rankings).toEqual({ hotelplanner: { source: 'tour:hotelplanner', as_of: TODAY, rank: 12, points: 1044.11, events: 18 } });
    const st = site('https://www.europeantour.com/players/jonas-beispiel-99002/stats?tour=hotelplanner-tour', listened(docOf(etStats()), 'Stats - Jonas BEISPIEL - Players - European Tour').doc);
    st.read(null, ASK, TODAY);
    expect(JSON.parse(st.posted[0] as string).read.stats.map((x: { season: number }) => x.season)).toEqual([2026, 2025]);
  });

  it('waits a little for the table, then says the page changed; a page of the site that isn’t his is none to read', () => {
    const p = site(ET_RESULTS, listened(docOf(etResults({ tables: [] })), ET_TITLE).doc);
    p.read(null, ASK, TODAY);
    expect(p.posted).toEqual([]); // waiting for the table
    for (let waited = 0; waited <= TABLE_WAIT_MS; waited += 500) p.tick(500);
    expect(p.posted.map((d) => JSON.parse(d).why)).toEqual(['changed_page']);
    // A title that doesn't name him: the module doesn't know the page.
    const q = site(ET_RESULTS, listened(docOf(etResults()), 'Something else').doc);
    q.read(null, ASK, TODAY);
    expect(q.posted.map((d) => JSON.parse(d).why)).toEqual(['changed_page']);
    const r = site('https://www.europeantour.com/dpworld-tour/players/', listened(docOf(etResults()), ET_TITLE).doc);
    r.read(null, ASK, TODAY);
    expect(r.posted.map((d) => JSON.parse(d).why)).toEqual(['not_player_page']);
  });

  it('a pick in the page’s own select only says that he picked - nothing read, nothing of his', () => {
    const { doc, fire } = listened(docOf(etResults()), ET_TITLE);
    const p = site(ET_RESULTS, doc);
    fire({ tagName: 'SELECT' });
    expect(p.posted).toEqual([JSON.stringify({ glmsync: 'tour-page', picked: true })]);
    expect(readPickMessage(ET_RESULTS, p.posted[0])).toBe(true);
    // Any other change (a search box, a checkbox), or a pick on a page of the site that isn't his: nothing.
    fire({ tagName: 'INPUT' });
    fire(null);
    fire({ tagName: { toLowerCase: () => 'select' } });
    expect(p.posted).toHaveLength(1);
    const listing = listened(docOf(etResults()), ET_TITLE);
    const q = site('https://www.europeantour.com/dpworld-tour/players/', listing.doc);
    listing.fire({ tagName: 'SELECT' });
    expect(q.posted).toEqual([]);
    // Without the app's bridge it stays out of the page's way.
    delete p.win.ReactNativeWebView;
    expect(() => fire({ tagName: 'SELECT' })).not.toThrow();
  });

  it('a document that can’t be listened on is read all the same', () => {
    const p = site(ET_RESULTS, Object.assign(docOf(etResults()), { title: ET_TITLE }));
    p.read(null, ASK, TODAY);
    expect(readTourMessage(ET_RESULTS, p.posted[0], ASK)).toMatchObject({ ok: true });
  });
});
