// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import schema from '../../../spec/prores/prores-1.schema.json' with { type: 'json' };
import { makeAjv } from '../../spec/src/check.ts';
import * as lpga from './lpga.ts';
import { checkTourPage, tourBatchOf, type TourPage } from './page.ts';
import * as pgatour from './pgatour.ts';
import type { SeasonRead } from './season.ts';
import { readSeasonPage, seasonShows, seasonSiteOf, seasonTakes } from './seasonPage.ts';
import { statLabel, statsAsOf, statValue } from './seasonStats.ts';
import { lpgaResults, lpgaStatRow, lpgaStats, pgaFigures, pgaResults, pgaStatRow, pgaStats } from './testing.ts';

const check = makeAjv().compile(schema);
const TODAY = '2026-11-26';
const OPTS = { account_ref: 'a'.repeat(22), generated_at: '2026-11-26T08:00:00Z', generator: { name: 'Golf Stats Sync', version: '0.18.0' } };

function page(r: SeasonRead): TourPage {
  if (r.kind !== 'page') throw new Error(`unread: ${r.why}`);
  return r.page;
}

describe('a statistic as the sites write it', () => {
  it('reads numbers, shares, yards and feet into prores/1\'s metric values; nothing else', () => {
    expect([statValue('2.249'), statValue('-0.71'), statValue('−0.20'), statValue('+0.30'), statValue('1,112.377')]).toEqual([2.249, -0.71, -0.2, 0.3, 1112.377]);
    expect([statValue('63.94%'), statValue('72.52 %')]).toEqual([63.94, 72.52]);
    expect(statValue('312.7', 'yards')).toBe(285.9);
    expect([statValue("36' 4", 'feet'), statValue("8' 3", 'feet'), statValue('30', 'feet')]).toEqual([11.1, 2.5, 9.1]);
    expect([statValue('17', 'count'), statValue('1.5', 'count'), statValue('-2', 'count')]).toEqual([17, undefined, undefined]);
    for (const none of ['-', '', '$1,073,063', 'T5', '1st', "36' 4", '1.2.3', undefined]) expect(statValue(none)).toBeUndefined();
    expect(statLabel('SG: Off-the-Tee Right Arrow Right Arrow')).toBe('sg: off the tee');
    expect([statsAsOf(2025, TODAY), statsAsOf(2026, TODAY), statsAsOf(2027, TODAY)]).toEqual(['2025-12-31', TODAY, TODAY]);
  });
});

describe('PGA Tour and Korn Ferry Tour: his Stats page', () => {
  it('reads the season\'s statistics in prores/1\'s keys, metric; nothing of the page\'s ranks or money', () => {
    const p = page(pgatour.readStats(pgaStats(), {}, TODAY));
    expect(p).toMatchObject({ site: 'tour:pga_tour', id: '99002', name: 'Max Erfunden', tournaments: [] });
    expect(p.ranking).toEqual({ source: 'tour:pga_tour', as_of: TODAY });
    expect(p.stats).toEqual([{
      tour: 'pga_tour', season: 2026, as_of: TODAY,
      values: {
        sg_total: 0.912, sg_off_tee: -0.104, sg_approach: 0.388, sg_around_green: 0.216, sg_putting: 0.412,
        driving_distance_m: 275.6, driving_accuracy_pct: 61.25, gir_pct: 68.4, proximity_m: 11.4, scrambling_pct: 60.12,
        sand_saves_pct: 51.3, putts_per_gir: 1.731, putts_per_round: 28.95, scoring_average: 70.31, birdies_per_round: 3.95,
        par3_average: 3.04, par4_average: 4.01, par5_average: 4.62,
      },
    }]);
    // What the page hands on is what arrives, and its batch is valid prores/1 with the statistics and no tournament.
    expect(checkTourPage(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const batch = tourBatchOf(p, OPTS);
    expect(check(batch), JSON.stringify(check.errors)).toBe(true);
    expect([batch.tournaments, batch.stats?.length]).toEqual([undefined, 1]);
  });

  it('the tour of the picker, the season of its picker: a past season as at its year\'s end, without today\'s standing', () => {
    const kft = page(pgatour.readStats(pgaStats({ pairs: { Tour: 'Korn Ferry Tour', Season: '2026' } }), pgaFigures('4', 'PTS: 1,210'), TODAY));
    expect([kft.site, kft.stats[0]?.tour, kft.ranking]).toEqual(['tour:korn_ferry', 'korn_ferry', { source: 'tour:korn_ferry', rank: 4, points: 1210, as_of: TODAY }]);
    const past = page(pgatour.readStats(pgaStats({ pairs: { Tour: 'PGA Tour', Season: '2025' } }), pgaFigures(), TODAY));
    expect([past.stats[0]?.season, past.stats[0]?.as_of, past.ranking]).toEqual([2025, '2025-12-31', { source: 'tour:pga_tour', as_of: '2025-12-31' }]);
    expect(pgatour.readStats(pgaStats({ pairs: { Tour: 'PGA Tour Champions', Season: '2026' } }), {}, TODAY)).toEqual({ kind: 'unread', why: 'other_tour' });
    const byPath = pgaStats({ url: 'https://www.pgatour.com/korn-ferry-tour/player/99002/max-erfunden/stats', pairs: { Season: '2026' } });
    expect(page(pgatour.readStats(byPath, {}, TODAY)).site).toBe('tour:korn_ferry');
  });

  it('a page it doesn\'t know, or one without its season, reads nothing rather than guess; a table with nothing known gives nothing', () => {
    expect(pgatour.readStats(pgaStats({ pairs: { Tour: 'PGA Tour' } }), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(pgatour.readStats(pgaStats({ tables: [] }), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(pgatour.readStats(pgaStats({ title: '' }), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(pgatour.readStats(pgaStats({}, [pgaStatRow('Longest Drives', '371'), pgaStatRow('Official Money', '$1')]), {}, TODAY)).toEqual({ kind: 'unread', why: 'nothing' });
    expect(pgatour.readStats(pgaResults(), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    // A value out of its range doesn't leave the page as one (checkTourPage), the others do.
    const odd = page(pgatour.readStats(pgaStats({}, [pgaStatRow('SG: Total', '22.5'), pgaStatRow('Putts Per Round', '28.95')]), {}, TODAY));
    expect(checkTourPage(odd)?.stats[0]?.values).toEqual({ putts_per_round: 28.95 });
  });

  it('knows his Stats page by its address', () => {
    expect(pgatour.statsPageOf('https://www.pgatour.com/player/99002/max-erfunden/stats')).toEqual({ id: '99002', tour: 'pga_tour' });
    expect(pgatour.statsPageOf('https://www.pgatour.com/korn-ferry-tour/player/99002/max-erfunden/stats?x=1')).toEqual({ id: '99002', tour: 'korn_ferry' });
    for (const other of ['https://www.pgatour.com/player/99002/max-erfunden/results', 'https://www.pgatour.com/stats', 'https://evil.example/player/1/x/stats', 42]) {
      expect(pgatour.statsPageOf(other)).toBeNull();
    }
  });
});

describe('LPGA Tour and Epson Tour: her Stats page', () => {
  it('reads the strokes gained cards and the table in prores/1\'s keys, metric, and the standing\'s row as the ranking', () => {
    const p = page(lpga.readStats(lpgaStats(), {}, TODAY));
    expect(p).toMatchObject({ site: 'tour:lpga', id: '99003', name: 'Lena Ausgedacht', tournaments: [] });
    expect(p.ranking).toEqual({ source: 'tour:lpga', rank: 57, points: 1021.5, as_of: TODAY });
    expect(p.stats).toEqual([{
      tour: 'lpga', season: 2026, as_of: TODAY,
      values: {
        sg_total: 0.41, sg_off_tee: -0.22, sg_approach: 0.18, sg_around_green: 0.09, sg_putting: 0.36,
        driving_distance_m: 233.5, driving_accuracy_pct: 70.1, gir_pct: 70.02, putts_per_gir: 1.79, putts_per_round: 29.7,
        sand_saves_pct: 45, scoring_average: 71.02, rounds: 75, events: 20, par3_average: 3.01, par4_average: 4.05,
        par5_average: 4.7, wins: 0, top10: 3, cuts_made: 17,
        // 240 birdies in 75 rounds
        birdies_per_round: 3.2,
      },
    }]);
    expect(checkTourPage(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(check(tourBatchOf(p, OPTS)), JSON.stringify(check.errors)).toBe(true);
  });

  it('the Epson Tour by its site and its standing\'s label; a past season as at its year\'s end', () => {
    const rows = [lpgaStatRow('Race for the Card Points', '310.250', '12'), lpgaStatRow('Scoring Avg Per Round', '70.40', '8')];
    const epson = page(lpga.readStats(lpgaStats({ url: 'https://www.epsontour.com/athletes/lena-ausgedacht/99003/stats', pairs: { Seasons: '2025' } }, rows), {}, TODAY));
    expect(epson.site).toBe('tour:epson');
    expect(epson.ranking).toEqual({ source: 'tour:epson', rank: 12, points: 310.25, as_of: '2025-12-31' });
    expect(epson.stats).toEqual([{ tour: 'epson', season: 2025, as_of: '2025-12-31', values: { scoring_average: 70.4 } }]);
  });

  it('a page it doesn\'t know, or one without its season, reads nothing rather than guess', () => {
    expect(lpga.readStats(lpgaStats({ pairs: {} }), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(lpga.readStats(lpgaStats({ tables: [] }), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(lpga.readStats(lpgaStats({ pairs: { Seasons: '2026' } }, [lpgaStatRow('Low Round', '64')]), {}, TODAY)).toEqual({ kind: 'unread', why: 'nothing' });
    expect(lpga.readStats(lpgaResults(), {}, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(lpga.statsPageOf('https://www.lpga.com/athletes/lena-ausgedacht/99003/stats')).toEqual({ site: 'lpga', id: '99003' });
    expect(lpga.statsPageOf('https://www.lpga.com/athletes/lena-ausgedacht/99003/results')).toBeNull();
  });
});

describe('the season pages as one: Results and Stats', () => {
  it('knows both pages of a player, reads each by its address, and says when each shows what is read', () => {
    expect(seasonSiteOf('https://www.pgatour.com/player/99002/max-erfunden/stats')).toBe('tour:pga_tour');
    expect(seasonSiteOf('https://www.epsontour.com/athletes/x/1/stats')).toBe('tour:epson');
    expect(seasonSiteOf('https://www.pgatour.com/americas/player/1/x/stats')).toBeNull();
    expect(seasonTakes('https://www.lpga.com/athletes/x/1/stats').labels).toEqual(['Seasons', 'SG Total', 'SG Off the Tee', 'SG Approach', 'SG Around Green', 'SG Putting']);
    expect(page(readSeasonPage(pgaStats(), {}, TODAY)).stats).toHaveLength(1);
    expect(page(readSeasonPage(lpgaStats(), {}, TODAY)).stats).toHaveLength(1);
    expect(page(readSeasonPage(pgaResults(), pgaFigures(), TODAY)).tournaments.length).toBeGreaterThan(0);
    expect([seasonShows(pgaStats()), seasonShows(pgaStats({ tables: [] })), seasonShows(lpgaStats()), seasonShows(lpgaStats({ tables: [] }))]).toEqual([true, false, true, false]);
    // The Results page waits for its rounds, not for a statistics table.
    expect([seasonShows(pgaResults()), seasonShows(pgaResults({ tables: pgaStats().tables })), seasonShows(lpgaResults())]).toEqual([true, false, true]);
    expect(seasonShows(pgaStats({ url: 'https://example.org/player/1/x/stats' }))).toBe(false);
  });
});
