// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import schema from '../../../spec/prores/prores-1.schema.json' with { type: 'json' };
import { makeAjv } from '../../spec/src/check.ts';
import { figureNumber, figuresOf, type FigureElement } from './figures.ts';
import * as lpga from './lpga.ts';
import { checkTourPage, TOUR_SITES, tourBatchOf, type TourPage } from './page.ts';
import * as pgatour from './pgatour.ts';
import { addDays, asOfSeason, isTeamEvent, roundColumns } from './season.ts';
import { isSeasonSite, onSeasonSite, readSeasonPage, SEASON_PAGE_MATCHES, SEASON_SITES, seasonSiteOf, seasonTakes } from './seasonPage.ts';
import type { DomNode } from './snapshot.ts';
import { lpgaFigures, lpgaResults, lpgaRow, pgaFigures, pgaResults, pgaRow } from './testing.ts';

const check = makeAjv().compile(schema);
const TODAY = '2026-11-25';
const OPTS = { account_ref: 'a'.repeat(22), generated_at: '2026-11-25T12:00:00Z', generator: { name: 'Golf Stats Sync', version: '0.16.0' } };

function page(r: ReturnType<typeof pgatour.readResults>): TourPage {
  if (r.kind !== 'page') throw new Error(`unread: ${r.why}`);
  return r.page;
}

describe('PGA Tour: his Results page', () => {
  it('reads the season: the standing, every finished tournament with its rounds, counted back from its last day', () => {
    const p = page(pgatour.readResults(pgaResults(), pgaFigures(), TODAY));
    expect(p).toMatchObject({ site: 'tour:pga_tour', id: '99002', name: 'Max Erfunden', stats: [] });
    expect(p.ranking).toEqual({ source: 'tour:pga_tour', rank: 83, points: 494, events: 3, as_of: TODAY });
    expect(p.tournaments).toEqual([
      {
        ref: 'pga-R2026902', tour: 'pga_tour', name: 'Sample Desert Classic', start: '2026-01-22', end: '2026-01-25', result: 'MC',
        rounds: [{ round_no: 1, gross: 71, holes: 18 }, { round_no: 2, gross: 66, holes: 18 }, { round_no: 3, gross: 70, holes: 18 }],
      },
      {
        ref: 'pga-R2026904', tour: 'pga_tour', name: 'Made-up Coast Open', start: '2026-01-29', end: '2026-02-01', place: 5, tied: true, points: 105,
        rounds: [65, 75, 65, 68].map((gross, i) => ({ round_no: i + 1, gross, holes: 18 })),
      },
      // A major has no shot tracker's link: its id is its day and name.
      expect.objectContaining({ ref: 'pga-2026-05-17-an-invented-championship', place: 18, tied: true, points: 56.25 }),
    ]);
    // What the page hands on is what arrives: checkTourPage keeps it as read, and its batch is valid prores/1.
    expect(checkTourPage(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(check(tourBatchOf(p, OPTS)), JSON.stringify(check.errors)).toBe(true);
  });

  it('the Korn Ferry Tour by its picker (the address may still say otherwise); other tours of the site not at all', () => {
    const kft = page(pgatour.readResults(pgaResults({ pairs: { Tour: 'Korn Ferry Tour', Season: '2026' } }), pgaFigures('1', 'PTS: 2,804'), TODAY));
    expect([kft.site, kft.ranking.source, kft.ranking.rank, kft.ranking.points, kft.tournaments[0]?.tour]).toEqual(['tour:korn_ferry', 'tour:korn_ferry', 1, 2804, 'korn_ferry']);
    expect(pgatour.readResults(pgaResults({ pairs: { Tour: 'PGA Tour Champions' } }), pgaFigures(), TODAY)).toEqual({ kind: 'unread', why: 'other_tour' });
    // No picker: the address says it.
    const byPath = pgatour.readResults(pgaResults({ url: 'https://www.pgatour.com/korn-ferry-tour/player/99002/max-erfunden/results', pairs: {} }), {}, TODAY);
    expect(page(byPath).site).toBe('tour:korn_ferry');
    expect(pgatour.readResults(pgaResults({ url: 'https://www.pgatour.com/americas/player/99002/max-erfunden/results', pairs: {} }), {}, TODAY).kind).toBe('unread');
  });

  it('leaves out what isn\'t his own strokes or isn\'t over: a team event, a tournament still running, a round not played', () => {
    const rows = [
      pgaRow('4.26.2026', 'Zurich Classic of Sampletown', 'CUT', [61, 76, '-', '-'], '-', 'R2026918'),
      pgaRow('11.28.2026', 'Not Yet Played Open', '-', ['-', '-', '-', '-']),
      pgaRow('11.27.2026', 'This Week Classic', 'T3', [66, 67, '-', '-']),
      pgaRow('3.1.2026', 'Withdrawn Open', 'W/D', [74, '-', '-', '-'], '-', 'R2026910'),
      [{ text: 'Season total' }, { text: '' }, { text: '' }],
    ];
    const p = page(pgatour.readResults(pgaResults({}, rows), pgaFigures(), TODAY));
    expect(p.tournaments.map((t) => [t.ref, t.result, t.rounds?.length])).toEqual([['pga-R2026910', 'WD', 1]]);
    // Every tournament listed counts as an event of the season.
    expect(p.ranking.events).toBe(4);
  });

  it('a past season\'s standing is as of its last tournament; an empty season without a standing gives nothing', () => {
    const past = page(pgatour.readResults(pgaResults({ pairs: { Tour: 'PGA Tour', Season: '2025' } }, [pgaRow('8.24.2025', 'Old Final', '30', [70, 70, 70, 70], '1.000')]), pgaFigures(), TODAY));
    expect(past.ranking.as_of).toBe('2025-08-24');
    expect(pgatour.readResults(pgaResults({}, []), {}, TODAY)).toEqual({ kind: 'unread', why: 'nothing' });
  });

  it('a page it doesn\'t know reads nothing rather than guess', () => {
    expect(pgatour.readResults(pgaResults({ tables: [] }), pgaFigures(), TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(pgatour.readResults(pgaResults({ title: '' }), pgaFigures(), TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    const noPos = pgaResults();
    noPos.tables[0]!.head = noPos.tables[0]!.head.map((h) => (h === 'Pos' ? 'Place?' : h));
    expect(pgatour.readResults(noPos, pgaFigures(), TODAY).kind).toBe('unread');
    expect(pgatour.readResults(pgaResults({ url: 'https://www.pgatour.com/player/99002/max-erfunden/stats' }), {}, TODAY).kind).toBe('unread');
  });

  it('knows a player\'s Results page by its address, nothing else', () => {
    expect(pgatour.resultsPageOf('https://www.pgatour.com/player/36001/max-erfunden/results')).toEqual({ id: '36001', tour: 'pga_tour' });
    expect(pgatour.resultsPageOf('https://www.pgatour.com/korn-ferry-tour/player/36001/max-erfunden/results?x=1')).toEqual({ id: '36001', tour: 'korn_ferry' });
    expect(pgatour.resultsPageOf('https://www.pgatour.com/pgatour-champions/player/36001/max-erfunden/results')).toEqual({ id: '36001', tour: null });
    for (const bad of ['https://www.pgatour.com/player/36001/max-erfunden/overview', 'http://www.pgatour.com/player/1/x/results', 'https://evil.example/player/1/x/results', 7]) {
      expect(pgatour.resultsPageOf(bad)).toBeNull();
    }
  });
});

describe('LPGA Tour and Epson Tour: her Results page', () => {
  it('reads the season: the standing, every finished tournament with its rounds, from its first day', () => {
    const p = page(lpga.readResults(lpgaResults(), lpgaFigures(), TODAY));
    expect(p).toMatchObject({ site: 'tour:lpga', id: '99003', name: 'Lena Ausgedacht' });
    expect(p.ranking).toEqual({ source: 'tour:lpga', rank: 134, points: 63.688, events: 3, as_of: TODAY });
    expect(p.tournaments).toEqual([
      { ref: 'lpga-2026-sample-island-championship', tour: 'lpga', name: 'Sample Island Championship', start: '2026-10-01', result: 'MC', rounds: [{ round_no: 1, gross: 68, holes: 18 }, { round_no: 2, gross: 75, holes: 18 }] },
      expect.objectContaining({ ref: 'lpga-2026-made-up-links-open', start: '2026-07-23', place: 44, tied: true, points: 9.07 }),
      expect.objectContaining({ ref: 'lpga-2026-invented-founders-cup', start: '2026-03-19', place: 36, points: 16.5 }),
    ]);
    expect(p.tournaments[1]?.end).toBeUndefined();
    expect(checkTourPage(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(check(tourBatchOf(p, OPTS)), JSON.stringify(check.errors)).toBe(true);
  });

  it('the Epson Tour by its site, with its three rounds; a team event and a tournament still running are left out', () => {
    const E = 'https://www.epsontour.com';
    const rows = [
      lpgaRow('08/28/2026', 'Sample Charity Classic', 'sample-charity-classic', 'T16', [69, 70, 71, '-'], '51.00', E),
      lpgaRow('11/24/2026', 'This Week Classic', 'this-week-classic', '-', [70, '-', '-', '-'], '0.00', E),
      lpgaRow('06/11/2026', 'Dow Championship', 'dow-championship', 'T30', [70, 67, 74, 66], '3.70', E),
    ];
    const p = page(lpga.readResults(lpgaResults({ url: `${E}/athletes/emma-erdacht/99004/results`, title: 'Emma Erdacht' }, rows), lpgaFigures('123', '51.000'), TODAY));
    expect(p.site).toBe('tour:epson');
    expect(p.ranking).toMatchObject({ source: 'tour:epson', rank: 123, points: 51 });
    expect(p.tournaments.map((t) => [t.ref, t.tour, t.rounds?.length, t.points])).toEqual([['epson-2026-sample-charity-classic', 'epson', 3, 51]]);
  });

  it('a page it doesn\'t know reads nothing rather than guess; only her Results page by its address', () => {
    expect(lpga.readResults(lpgaResults({ tables: [] }), lpgaFigures(), TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(lpga.readResults(lpgaResults({}, []), {}, TODAY)).toEqual({ kind: 'unread', why: 'nothing' });
    expect(lpga.resultsPageOf('https://www.lpga.com/athletes/lena-ausgedacht/99003/results')).toEqual({ site: 'lpga', id: '99003' });
    expect(lpga.resultsPageOf('https://www.epsontour.com/athletes/x/1/results#top')).toEqual({ site: 'epson', id: '1' });
    for (const bad of ['https://www.lpga.com/athletes/lena-ausgedacht/99003/overview', 'https://www.lpga.com/athletes/directory', 'https://lpga.com.evil.example/athletes/x/1/results']) {
      expect(lpga.resultsPageOf(bad)).toBeNull();
    }
  });
});

describe('the season pages as one', () => {
  it('runs on the four tours\' sites, knows a player\'s page and reads it by its site', () => {
    expect(SEASON_PAGE_MATCHES).toEqual(['https://www.pgatour.com/*', 'https://www.lpga.com/*', 'https://www.epsontour.com/*']);
    expect([onSeasonSite('https://www.pgatour.com/'), onSeasonSite('https://www.epsontour.com/x'), onSeasonSite('https://www.progolftour.de/'), onSeasonSite('nonsense')]).toEqual([true, true, false, false]);
    expect(seasonSiteOf('https://www.pgatour.com/korn-ferry-tour/player/1/x/results')).toBe('tour:korn_ferry');
    expect(seasonSiteOf('https://www.lpga.com/athletes/x/1/results')).toBe('tour:lpga');
    expect(seasonSiteOf('https://www.pgatour.com/leaderboard')).toBeNull();
    expect(seasonTakes('https://www.lpga.com/x').labels).toEqual(['Seasons']);
    expect(seasonTakes('https://example.org/').figures).toEqual([]);
    expect(readSeasonPage(lpgaResults(), lpgaFigures(), TODAY).kind).toBe('page');
    expect(readSeasonPage(pgaResults(), pgaFigures(), TODAY).kind).toBe('page');
    expect(readSeasonPage(pgaResults({ url: 'https://example.org/player/1/x/results' }), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    for (const site of SEASON_SITES) expect(TOUR_SITES[site]?.site).toBe(site);
    expect([isSeasonSite('tour:lpga'), isSeasonSite('tour:pro_golf_tour'), isSeasonSite(1)]).toEqual([true, false, false]);
  });

  it('days, rounds, team events and a past season', () => {
    expect([addDays('2026-01-01', -3), addDays('2026-02-27', 3)]).toEqual(['2025-12-29', '2026-03-02']);
    expect(roundColumns(['Date', 'R1', 'R2', 'R3', 'Total', 'R5'])).toEqual([1, 2, 3]);
    expect([isTeamEvent('Zurich Classic of New Orleans'), isTeamEvent('Dow Great Lakes Bay Invitational'), isTeamEvent('The Sample Classic')]).toEqual([true, true, false]);
    expect([asOfSeason(2025, '2025-10-01', TODAY), asOfSeason(2026, '2026-10-01', TODAY), asOfSeason(undefined, undefined, TODAY)]).toEqual(['2025-10-01', TODAY, TODAY]);
    expect([figureNumber('PTS: 2,804'), figureNumber('63.688'), figureNumber('3,980.187'), figureNumber('—'), figureNumber('12th'), figureNumber(undefined)]).toEqual([2804, 63.688, 3980.187, undefined, undefined, undefined]);
  });
});

// A tiny DOM with previous siblings: enough for figuresOf.
class Text implements DomNode {
  nodeType = 3;
  constructor(public textContent: string) {}
}
class El implements FigureElement {
  nodeType = 1;
  nextElementSibling: El | null = null;
  previousElementSibling: El | null = null;
  parentElement: El | null = null;
  childNodes: (El | Text)[] = [];
  constructor(public tagName: string, kids: (El | string)[] = []) {
    let prev: El | null = null;
    for (const k of kids) {
      const n = typeof k === 'string' ? new Text(k) : k;
      if (n instanceof El) {
        n.parentElement = this;
        if (prev) {
          prev.nextElementSibling = n;
          n.previousElementSibling = prev;
        }
        prev = n;
      }
      this.childNodes.push(n);
    }
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  getAttribute(): string | null {
    return null;
  }
  all(): El[] {
    return this.childNodes.flatMap((n) => (n instanceof El ? [n, ...n.all()] : []));
  }
  querySelectorAll(sel: string): El[] {
    const tags = sel.split(',').map((s) => s.trim());
    return this.all().filter((e) => tags.includes(e.tagName));
  }
}
const h = (tag: string, kids: (El | string)[] = []) => new El(tag, kids);

describe('figures beside their label', () => {
  it('takes the value before its label or in it, the first in page order', () => {
    const doc = h('html', [
      h('div', [h('div', ['83']), h('div', ['PTS: 494'])]),
      h('div', [h('div', ['83']), h('div', ['PTS: 663'])]),
      h('div', [h('div', ['134']), h('span', ['CME Points Rank'])]),
      h('div', [h('div', ['134']), h('span', ['CME Points Rank Previous'])]),
      h('div', [h('div', ['63.688']), h('span', ['CME', ' Points'])]),
      h('div', [h('span', ['Lonely label'])]),
      h('div', [h('div', ['2,804']), h('div', [h('p', ['Wrapped Points'])])]),
    ]);
    expect(figuresOf(doc, pgatour.FIGURES)).toEqual({ rank: '83', points: 'PTS: 494' });
    expect(figuresOf(doc, lpga.FIGURES)).toEqual({ rank: '134', points: '63.688' });
    expect(figuresOf(doc, [{ key: 'x', label: /^Lonely label$/, take: 'before' }])).toEqual({});
    // A label wrapped in an element of its own: the value is before the wrapper.
    expect(figuresOf(doc, [{ key: 'w', label: /^Wrapped Points$/, take: 'before' }])).toEqual({ w: '2,804' });
    expect(figuresOf(doc, [])).toEqual({});
  });
});
