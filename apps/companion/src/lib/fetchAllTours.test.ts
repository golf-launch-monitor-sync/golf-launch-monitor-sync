// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { AlpsKeeper } from '@glmsync/browser/alps';
import { EtKeeper } from '@glmsync/browser/europeantour';
import { OcsKeeper } from '@glmsync/browser/ocs';
import type { ProView } from '@glmsync/browser/pro';
import { RunKeeper } from '@glmsync/browser/runs';
import { SeasonKeeper } from '@glmsync/browser/season';
import { MemoryStorage } from '@glmsync/core';
import { alps, checkTourPage, europeantour, ocs, pgatour, type operate, type run, type Snapshot, type TourPage } from '@glmsync/provider-tours';
import { alpsOom, alpsRecord, alpsResults, alpsStatistics, ET_TITLE, etLine, etOverview, etResults, etStats, ocsOom, ocsProfile, pgaFigures, pgaResults } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { AlpsSession } from './alpsSession.ts';
import { EtSession } from './etSession.ts';
import { OcsSession } from './ocsSession.ts';
import type { FetchAllDeps } from './pickRun.ts';
import { SeasonSession } from './seasonSession.ts';
import type { TourAnswer } from './toursPage.ts';

const TODAY = '2026-11-26';
const view: ProView = {
  pairings: [{ id: 'p1', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-25T09:00:00Z', host: 'app.example.org' }],
  ended: [],
  question: null,
};
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

type Session = { moved(url: string): void; loaded(url: string): Promise<void> };
type PickStep = Extract<run.PickStep, { do: 'pick' }>;

/**
 * The tour window on the phone with the extension's keepers on one storage, a clock and timers the test runs: the
 * page script picks as the test's page says (`pickAs`), an opened page loads in the window and the window tells the
 * session, as ToursView does. What went to the connected app is kept read again strictly.
 */
function phone(pickAs: (step: PickStep) => operate.PickResult) {
  let now = Date.UTC(2026, 10, 26, 12);
  const storage = new MemoryStorage();
  const timers: { fn: () => void; ms: number }[] = [];
  const sent: TourPage[] = [];
  const kept: string[] = [];
  const picks: string[] = [];
  const opened: string[] = [];
  const win = { url: '', session: null as Session | null };
  const fetchAll: FetchAllDeps = {
    runs: new RunKeeper(storage, () => now),
    pick: async (step) => {
      picks.push(step.value);
      return pickAs(step);
    },
    open: (to) => {
      opened.push(to);
      void Promise.resolve().then(() => {
        win.url = to;
        win.session?.moved(to);
        return win.session?.loaded(to);
      });
    },
  };
  const common = {
    pro: {
      view: async () => view,
      send: async (raw: unknown) => {
        const page = checkTourPage(raw);
        if (page) sent.push(page);
        return view;
      },
      answer: async () => view,
    },
    lastPage: { set: async (url: string) => void kept.push(url) },
    today: () => TODAY,
    onChange: () => undefined,
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    cancel: (h: unknown) => {
      const i = timers.indexOf(h as { fn: () => void; ms: number });
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const drain = async (most = 400) => {
    for (let i = 0; i < most; i++) {
      const t = timers.shift();
      if (!t) return;
      now += t.ms;
      t.fn();
      await flush();
    }
  };
  /** Opens the window on `url` with `session`, as ToursView does: the page loads, the session hears of it. */
  const show = async (session: Session & { start(): Promise<void> }, url: string) => {
    win.session = session;
    win.url = url;
    await session.start();
    session.moved(url);
    await session.loaded(url);
  };
  return { storage, fetchAll, common, win, sent, kept, picks, opened, timers, drain, show };
}

describe('Fetch all in the tour window, tour by tour (decision 57)', () => {
  it('the Alps Tour: the three reports picked under Select Report, merged, and his season goes out once with rounds and rank', async () => {
    const REPORTS: Record<string, () => Snapshot> = { Statistics: alpsStatistics, Results: alpsResults, 'Order of Merit': alpsOom, 'This Season record': alpsRecord };
    let report = 'Statistics';
    const p = phone((step) => {
      if (step.value === report) return 'already';
      report = step.value;
      return 'picked';
    });
    const PROFILE = 'https://www.alpstourgolf.com/playerprofile/TST001';
    const s = new AlpsSession({
      ...p.common,
      keeper: new AlpsKeeper(p.storage),
      read: async () => {
        const r = alps.readPage((REPORTS[report] ?? alpsStatistics)());
        return r?.kind === 'alps' ? { ok: true, alps: r } : { ok: false, why: 'changed_page' };
      },
      fetchAll: p.fetchAll,
    });
    await p.show(s, PROFILE);
    await s.fetchAll(PROFILE);
    expect(s.now.run?.view?.running).toMatchObject({ family: 'alps', total: 3 });
    // While it runs: no Send, and the page's `change` of the run's own pick is no pick of his.
    await s.send(PROFILE);
    s.picked(PROFILE);
    expect(p.sent).toEqual([]);
    await p.drain();
    expect(p.picks).toEqual(['This Season record', 'Results', 'Order of Merit']);
    expect(p.sent).toHaveLength(1);
    const page = p.sent[0] as TourPage;
    expect(page.site).toBe('tour:alps');
    expect(page.tournaments.length).toBeGreaterThan(0);
    expect(page.tournaments.every((t) => (t.rounds?.length ?? 0) > 0)).toBe(true);
    expect(page.ranking.rank).toBe(4);
    expect(s.now.phase).toBe('done');
    expect(s.now.run?.view?.ended).toEqual({ family: 'alps', how: 'done' });
    expect(p.kept).toEqual([PROFILE]);
  });

  it('europeantour.com: his pages opened and the seasons picked; a page per tour within the reach', async () => {
    const BASE = 'https://www.europeantour.com/players/jonas-beispiel-99002';
    let season = '2026';
    const p = phone((step) => {
      if (/^20[0-9]{2}$/.test(step.value)) {
        if (step.value !== '2026' && step.value !== '2025') return 'absent'; // seasons he didn't play
        if (step.value === season) return 'already';
        season = step.value;
        return 'picked';
      }
      return 'picked';
    });
    const answer = (snap: Snapshot, title: string): TourAnswer => {
      const r = europeantour.readPage(snap, title, TODAY);
      return r?.kind === 'page' ? { ok: true, et: r } : { ok: false, why: 'changed_page' };
    };
    const s = new EtSession({
      ...p.common,
      keeper: new EtKeeper(p.storage),
      read: async () => {
        const url = p.win.url;
        if (url.startsWith(`${BASE}/results`)) {
          return season === '2026'
            ? answer(etResults(), ET_TITLE)
            : answer(etResults({ selected: ['2025'] }, [etLine('02/11/2025', 'hotelplanner-tour/made-up-final-2025', 'Made-up Final 2025', '3', '80.0', 68, 69, 70, 71)]), ET_TITLE);
        }
        if (url.startsWith(`${BASE}/stats`)) return answer(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour');
        if (url.startsWith(`${BASE}/`)) return answer(etOverview(), 'Jonas BEISPIEL - Players - European Tour');
        return { ok: false, why: 'not_player_page' };
      },
      fetchAll: p.fetchAll,
    });
    await p.show(s, `${BASE}/?tour=hotelplanner-tour`);
    await s.fetchAll(p.win.url);
    await p.drain();
    expect(p.opened.every((u) => europeantour.playerPageOf(u)?.id === '99002')).toBe(true);
    expect(p.opened).toHaveLength(4);
    expect(p.sent.length).toBeGreaterThanOrEqual(1);
    const refs = p.sent.flatMap((pg) => pg.tournaments.map((t) => t.ref));
    // He never picked 2025 by hand: the run picked it for him, and its final is there.
    expect(refs).toContain('et-made-up-final-2025');
    expect(p.picks).toEqual(['2027', '2026', '2025', '2024', 'DP World Tour', 'HotelPlanner Tour']);
    expect(s.now.phase).toBe('done');
    expect(s.now.sent).toBe(p.sent.at(-1)?.site);
  });

  it('the LET Access Series: her seasons picked on her profile, then each season\'s Order of Merit opened for her line', async () => {
    const PROFILE = 'https://letaccess.com/player-profiles/990001/';
    const p = phone((step) => (step.value === '2026 Season' ? 'already' : 'absent'));
    const s = new OcsSession({
      ...p.common,
      site: 'tour:let_access',
      keeper: new OcsKeeper(p.storage),
      read: async (who) => {
        const url = p.win.url;
        if (url === PROFILE) {
          const pr = ocs.readProfile(ocsProfile());
          return pr?.kind === 'profile' ? { ok: true, ocs: pr } : { ok: false, why: 'changed_page' };
        }
        if (ocs.isOomPage(url) && url.includes('id=2026') && who) {
          const l = ocs.readOom(ocsOom(), who);
          return l?.kind === 'oom' ? { ok: true, ocs: l } : { ok: false, why: 'changed_page' };
        }
        return { ok: false, why: 'not_player_page' };
      },
      fetchAll: p.fetchAll,
    });
    await p.show(s, PROFILE);
    await s.fetchAll(PROFILE);
    await p.drain();
    expect(p.picks).toEqual(['2026 Season', '2025 Season', '2024 Season']);
    expect(p.opened).toEqual(['2026', '2025', '2024'].map((y) => `https://letaccess.com/letas-order-of-merits?id=${y}&oom=LO`));
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]?.site).toBe('tour:let_access');
    expect(p.sent[0]?.ranking.rank).toBeGreaterThan(0);
    expect(p.kept).toEqual([PROFILE]);
    expect(s.now.phase).toBe('done');
  });

  it('the season pages: every page read kept merged until the end, sent within the reach; a new run starts from nothing kept', async () => {
    const RESULTS = 'https://www.pgatour.com/player/99002/max-erfunden/results';
    const read = (pgatour.readResults(pgaResults(), pgaFigures(), TODAY) as { kind: 'page'; page: TourPage }).page;
    const first = read.tournaments[0];
    if (!first) throw new Error('the made-up season has a tournament');
    // A tournament three years ago is out of the reach (decision 51: two years).
    const withOld: TourPage = { ...read, tournaments: [...read.tournaments, { ...first, ref: 'pga-2023-old-open', start: '2023-06-01', ...(first.end ? { end: '2023-06-04' } : {}) }] };
    const p = phone((step) => (step.value === 'PGA Tour' || step.value === '2026' ? 'already' : 'absent'));
    const pages = new SeasonKeeper(p.storage);
    // What an earlier run left (the app closed during it): the new run starts without it.
    await pages.seen({ ...read, tournaments: [{ ...first, ref: 'pga-2026-left-over' }] });
    const s = new SeasonSession({
      ...p.common,
      read: async () => ({ ok: true, season: withOld }),
      fetchAll: { ...p.fetchAll, pages, today: () => TODAY },
    });
    await p.show(s, RESULTS);
    await s.fetchAll(RESULTS);
    await p.drain();
    expect(p.opened).toEqual([RESULTS, 'https://www.pgatour.com/player/99002/max-erfunden/stats']);
    expect(p.sent).toHaveLength(1);
    const refs = p.sent[0]?.tournaments.map((t) => t.ref) ?? [];
    // His season's tournaments, newest first; not the one out of the reach, nothing an earlier run left.
    expect(refs).toEqual(['pga-2026-05-17-an-invented-championship', 'pga-R2026904', 'pga-R2026902']);
    expect(await pages.take(['tour:pga_tour'])).toEqual([]); // forgotten once sent
    expect(s.now.phase).toBe('done');
    expect(s.now.sent).toBe('tour:pga_tour');
    expect(p.kept).toEqual(['https://www.pgatour.com/player/99002/max-erfunden/stats']);
  });

  it('the season pages: a run that read nothing finished says so and sends nothing; closing the window ends a run and sends', async () => {
    const RESULTS = 'https://www.pgatour.com/player/99002/max-erfunden/results';
    const p = phone(() => 'absent');
    const s = new SeasonSession({
      ...p.common,
      read: async () => ({ ok: true, seasonUnread: 'nothing' }),
      fetchAll: { ...p.fetchAll, pages: new SeasonKeeper(p.storage), today: () => TODAY },
    });
    await p.show(s, RESULTS);
    await s.fetchAll(RESULTS);
    await p.drain();
    expect(p.sent).toEqual([]);
    expect([s.now.phase, s.now.note]).toEqual(['ready', 'nothing']);

    const q = phone(() => 'already');
    const read = (pgatour.readResults(pgaResults(), pgaFigures(), TODAY) as { kind: 'page'; page: TourPage }).page;
    const t = new SeasonSession({
      ...q.common,
      read: async () => ({ ok: true, season: read }),
      fetchAll: { ...q.fetchAll, pages: new SeasonKeeper(q.storage), today: () => TODAY },
    });
    await q.show(t, RESULTS);
    await t.fetchAll(RESULTS);
    // A few steps in, the window closes.
    for (let i = 0; i < 6; i++) {
      const next = q.timers.shift();
      if (!next) break;
      next.fn();
      await flush();
    }
    t.close();
    await flush();
    expect(q.sent).toHaveLength(1);
    expect(q.timers).toEqual([]);
  });
});
