// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { checkRead, dayOf, mergeRead, nameOf, pagesOf, playerPageOf, readPage, shows, siteOfUrl, type EtRead } from './europeantour.ts';
import { tourBatchOf } from './page.ts';
import { ET_TITLE, etLine, etOverview, etResults, etStats } from './testing.ts';

const TODAY = '2026-11-25';
const read = (snap = etResults(), title = ET_TITLE): EtRead => {
  const r = readPage(snap, title, TODAY);
  if (r?.kind !== 'page') throw new Error(`not read: ${JSON.stringify(r)}`);
  return r;
};

describe('a player\'s pages on europeantour.com', () => {
  it('knows them by their address, and the tour the address names', () => {
    expect(playerPageOf('https://www.europeantour.com/players/rory-mcilroy-34024/')).toEqual({ id: '34024', part: 'overview', tour: null });
    expect(playerPageOf('https://www.europeantour.com/players/dominic-foos-39131/results?tour=hotelplanner-tour')).toEqual({ id: '39131', part: 'results', tour: 'hotelplanner' });
    expect(playerPageOf('https://www.europeantour.com/players/x-y-1/stats/?tour=dpworld-tour')).toEqual({ id: '1', part: 'stats', tour: 'dp_world' });
    expect(playerPageOf('https://www.europeantour.com/players/x-1/news/?tour=legends-tour')).toEqual({ id: '1', part: 'other', tour: null });
    for (const no of ['https://www.europeantour.com/dpworld-tour/players/', 'https://europeantour.com.evil.example/players/x-1/', 'http://www.europeantour.com/players/x-1/', 'not a url', 42]) {
      expect(playerPageOf(no)).toBeNull();
    }
    expect(siteOfUrl('https://www.europeantour.com/players/x-1/?tour=hotelplanner-tour')).toBe('tour:hotelplanner');
    expect(siteOfUrl('https://www.europeantour.com/players/x-1/')).toBe('tour:dp_world');
  });

  it('takes his name from the title only where the page writes it too', () => {
    expect(nameOf(ET_TITLE, ['Jonas BEISPIEL'])).toBe('Jonas BEISPIEL');
    expect(nameOf('Jonas BEISPIEL - Players - European Tour', ['Jonas Beispiel'])).toBe('Jonas BEISPIEL');
    expect(nameOf(ET_TITLE, ['Someone ELSE'])).toBeNull();
    expect(nameOf('Players - DP World Tour', ['Players'])).toBeNull();
    expect(dayOf('15/11/2026')).toBe('2026-11-15');
    expect(dayOf('31/02/2026')).toBeUndefined();
  });

  it('reads his results with their rounds, by the tour each tournament\'s link names; another tour\'s are left out', () => {
    const r = read();
    expect(r.player_id).toBe('99002');
    expect(r.player_name).toBe('Jonas BEISPIEL');
    expect(r.rankings).toEqual({ hotelplanner: { source: 'tour:hotelplanner', rank: 12, as_of: TODAY } });
    expect(r.tournaments.map((t) => [t.ref, t.tour, t.result ?? t.place, t.tied ?? false, t.points, t.rounds?.length])).toEqual([
      ['et-made-up-grand-final-2026', 'hotelplanner', 9, true, 63.25, 4],
      ['et-sample-open-2026', 'hotelplanner', 'MC', false, undefined, 2],
      ['et-beispiel-international-2026', 'dp_world', 43, true, 12.5, 4],
      ['et-old-sample-challenge-2015', 'hotelplanner', 1, false, 27200, 4],
    ]);
    const first = r.tournaments[0];
    expect(first).toMatchObject({ name: 'Made-up Grand Final', start: '2026-10-29', end: '2026-11-01' });
    // The par from total and "to par" (each round alike); a missed cut has no total, so no par.
    expect(first?.rounds?.[0]).toEqual({ round_no: 1, gross: 70, par: 72, holes: 18 });
    expect(r.tournaments[1]?.rounds).toEqual([{ round_no: 1, gross: 72, holes: 18 }, { round_no: 2, gross: 75, holes: 18 }]);
    expect(JSON.stringify(r)).not.toContain('Senior');
    expect(JSON.stringify(r)).not.toContain('1,000');
  });

  it('leaves out a tournament still running, and one without rounds; reads a place written plainly', () => {
    const r = read(etResults({}, [
      etLine('29/11/2026', 'dpworld-tour/running-open-2026', 'Running Open', '3', '', 66, 67),
      etLine('03/05/2026', 'dpworld-tour/made-up-match-play-2026', 'Made-up Match Play', '', '100.0'),
      etLine('11/11/2026', 'dpworld-tour/final-stage-sample-2026', 'Final Stage - Sample', '81', '', 71, 67, 73, 65),
    ]));
    expect(r.tournaments.map((t) => [t.ref, t.place])).toEqual([['et-final-stage-sample-2026', 81]]);
  });

  it('reads the overview\'s Rankings as the tour its points name, and the last five', () => {
    const r = read(etOverview(), 'Jonas BEISPIEL - Players - European Tour');
    expect(r.rankings).toEqual({ hotelplanner: { source: 'tour:hotelplanner', rank: 12, points: 1044.11, events: 18, as_of: TODAY } });
    expect(r.tournaments).toHaveLength(1);
    // Rankings whose points the page doesn't name: their rank and events are nobody's.
    const bare = read(etOverview({ pairs: { 'Current Rank': '3', 'Tournaments Played': '160' } }), 'Jonas BEISPIEL - Players - European Tour');
    expect(bare.rankings).toEqual({});
    const dp = read(etOverview({ url: 'https://www.europeantour.com/players/jonas-beispiel-99002/', pairs: { R2DR: '1st', 'Race to Dubai Points': '5044.86', 'Current Rank': '1', 'Tournaments Played': '13' } }), 'Jonas BEISPIEL - Players - European Tour');
    expect(dp.rankings).toEqual({ dp_world: { source: 'tour:dp_world', rank: 1, points: 5044.86, events: 13, as_of: TODAY } });
  });

  it('reads the season statistics of the tour picked, in metres, past seasons as at their end', () => {
    const r = read(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour');
    expect(r.stats).toEqual([
      {
        tour: 'hotelplanner', season: 2026, as_of: TODAY,
        values: { driving_accuracy_pct: 61.2, driving_distance_m: 274.3, gir_pct: 70.1, putts_per_gir: 1.76, putts_per_round: 29.1, sand_saves_pct: 50, scoring_average: 70.45 },
      },
      { tour: 'hotelplanner', season: 2025, as_of: '2025-12-31', values: { scoring_average: 71.02 } },
    ]);
  });

  it('knows when the page shows what is read of it (the wins\' table alone isn\'t the results)', () => {
    expect(shows(etResults())).toBe(true);
    expect(shows(etResults({ tables: [etResults().tables[0]!] }))).toBe(false);
    expect(shows(etStats())).toBe(true);
    expect(shows(etStats({ tables: [] }))).toBe(false);
    expect(shows(etOverview({ tables: [] }))).toBe(false);
    expect(shows(etOverview({ url: 'https://www.europeantour.com/players/jonas-beispiel-99002/news/' }))).toBe(true);
  });

  it('says the page changed where it doesn\'t look as known, and is none elsewhere', () => {
    expect(readPage(etResults(), 'Something else', TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(readPage(etResults({ tables: [] }), ET_TITLE, TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(readPage(etStats({ selected: ['2026'] }), 'Stats - Jonas BEISPIEL - Players - European Tour', TODAY)).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(readPage(etResults({ url: 'https://www.europeantour.com/dpworld-tour/players/' }), ET_TITLE, TODAY)).toBeNull();
  });
});

describe('what the client keeps and sends of them', () => {
  it('merges his pages; another player\'s page replaces it all', () => {
    const kept = mergeRead(mergeRead(null, read(etOverview(), 'Jonas BEISPIEL - Players - European Tour')), read(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour'));
    const all = mergeRead(kept, read());
    expect(all.rankings.hotelplanner).toEqual({ source: 'tour:hotelplanner', rank: 12, points: 1044.11, events: 18, as_of: TODAY });
    expect(all.tournaments).toHaveLength(4);
    expect(all.stats).toHaveLength(2);
    const other = { ...read(), player_id: '1', player_name: 'Other PLAYER' };
    expect(mergeRead(all, other)).toEqual(other);
  });

  it('makes a page of each tour, with its own ranking, tournaments and statistics, that goes into one batch each', () => {
    const r = mergeRead(read(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour'), read());
    const pages = pagesOf(r, TODAY);
    expect(pages.map((p) => [p.site, p.ranking.rank, p.tournaments.length, p.stats.length])).toEqual([
      ['tour:dp_world', undefined, 1, 0],
      ['tour:hotelplanner', 12, 3, 2],
    ]);
    const b = tourBatchOf(pages[1]!, { account_ref: 'a'.repeat(22), generated_at: '2026-11-25T12:00:00Z', generator: { name: 'Golf Stats Sync' } });
    expect(b).toMatchObject({ site: 'tour:hotelplanner', player: { name: 'Jonas BEISPIEL' }, rankings: [{ source: 'tour:hotelplanner', rank: 12 }] });
    expect(b.tournaments?.every((t) => t.tour === 'hotelplanner')).toBe(true);
    expect(b.stats?.[0]).toMatchObject({ tour: 'hotelplanner', season: 2026 });
    // Nothing of a tour: no page of it.
    expect(pagesOf({ ...r, rankings: {}, tournaments: r.tournaments.filter((t) => t.tour === 'hotelplanner'), stats: [] }, TODAY).map((p) => p.site)).toEqual(['tour:hotelplanner']);
  });

  it('reads again strictly what arrives: its frame, each tour\'s part by a tour page\'s rules', () => {
    const r = mergeRead(read(etStats(), 'Stats - Jonas BEISPIEL - Players - European Tour'), read());
    expect(checkRead(JSON.parse(JSON.stringify(r)))).toEqual(r);
    const bad = JSON.parse(JSON.stringify(r));
    bad.tournaments.push({ ref: 'x', tour: 'pga_tour', start: '2026-01-01', rounds: [{ round_no: 1, gross: 70 }] }, { ref: 'bad ref!', tour: 'hotelplanner', start: '2026-01-01', rounds: [{ round_no: 1, gross: 70 }] });
    bad.stats[0].values.evil = 1;
    bad.stats.push({ tour: 'hotelplanner', season: 2024, as_of: '2024-12-31', values: { scoring_average: 300 } });
    bad.rankings.hotelplanner.rank = -1;
    bad.rankings.pga_tour = { rank: 1, as_of: TODAY };
    const got = checkRead(bad);
    expect(got?.tournaments).toHaveLength(4);
    expect(got?.stats).toHaveLength(2);
    expect(got?.stats[0]?.values).not.toHaveProperty('evil');
    expect(got?.rankings).toEqual({});
    for (const no of [null, [], { ...r, kind: 'x' }, { ...r, player_id: 'a-1' }, { ...r, player_name: 'x' }]) expect(checkRead(no)).toBeNull();
  });
});
