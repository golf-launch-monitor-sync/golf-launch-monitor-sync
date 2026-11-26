// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { runFamilyOf, runMayOpen, runPlanOf, seasonPlayerOf } from './tour-runs.ts';

const TODAY = '2026-11-26';
const what = (url: string) => runPlanOf(url, TODAY)?.steps.map((s) => (s.do === 'open' ? `open ${s.url}` : `pick ${s.picker ?? 'select'}=${s.value}`));

describe('what Fetch all does on each tour (decision 57)', () => {
  it('Alps Tour: the three reports of his profile, nothing opened', () => {
    expect(runPlanOf('https://www.alpstourgolf.com/playerprofile/VAN054', TODAY)).toMatchObject({ family: 'alps', player_id: 'van054' });
    expect(what('https://www.alpstourgolf.com/playerprofile/VAN054')).toEqual([
      'pick select=This Season record', 'pick select=Results', 'pick select=Order of Merit',
    ]);
    expect(runPlanOf('https://www.alpstourgolf.com/stats', TODAY)).toBeNull();
    expect(runMayOpen('alps', 'van054', 'https://www.alpstourgolf.com/playerprofile/VAN054')).toBe(false);
  });

  it('europeantour.com: both tours\' overviews, the seasons of the reach on Wins & Results, both tours on Stats', () => {
    const url = 'https://www.europeantour.com/players/lena-beispiel-99001/stats/?tour=hotelplanner-tour';
    expect(runPlanOf(url, TODAY)).toMatchObject({ family: 'europeantour', player_id: '99001' });
    const base = 'https://www.europeantour.com/players/lena-beispiel-99001/';
    expect(what(url)).toEqual([
      `open ${base}?tour=dpworld-tour`, `open ${base}?tour=hotelplanner-tour`, `open ${base}results/?tour=dpworld-tour`,
      'pick select=2027', 'pick select=2026', 'pick select=2025', 'pick select=2024',
      `open ${base}stats/?tour=dpworld-tour`, 'pick select=DP World Tour', 'pick select=HotelPlanner Tour',
    ]);
    expect(runMayOpen('europeantour', '99001', `${base}results/?tour=dpworld-tour`)).toBe(true);
    expect(runMayOpen('europeantour', '99001', 'https://www.europeantour.com/players/otto-erfunden-12/')).toBe(false);
    expect(runMayOpen('europeantour', '99001', 'https://www.europeantour.com/api/players/99001')).toBe(false);
  });

  it('LET and LET Access Series: her profile\'s seasons, then each season\'s Order of Merit', () => {
    expect(runPlanOf('https://letaccess.com/player-profiles/123456/', TODAY)).toMatchObject({ family: 'tour:let_access', player_id: '123456' });
    expect(what('https://letaccess.com/player-profiles/123456/')).toEqual([
      'pick select=2026 Season', 'pick select=2025 Season', 'pick select=2024 Season',
      'open https://letaccess.com/letas-order-of-merits?id=2026&oom=LO', 'open https://letaccess.com/letas-order-of-merits?id=2025&oom=LO',
      'open https://letaccess.com/letas-order-of-merits?id=2024&oom=LO',
    ]);
    expect(what('https://ladieseuropeantour.com/player-profiles/123456/')?.at(-1)).toBe('open https://ladieseuropeantour.com/order-of-merit?id=2024&oom=PT');
    expect(runMayOpen('tour:let', '123456', 'https://ladieseuropeantour.com/order-of-merit?id=2025&oom=PT')).toBe(true);
    expect(runMayOpen('tour:let', '123456', 'https://letaccess.com/letas-order-of-merits?id=2025&oom=LO')).toBe(false);
    expect(runMayOpen('tour:let', '123456', 'https://ladieseuropeantour.com/player-profiles/654321/')).toBe(false);
  });

  it('pgatour.com: on Results and on Stats, each of its two tours with the seasons of the reach', () => {
    const url = 'https://www.pgatour.com/korn-ferry-tour/player/99001/lena-beispiel/results';
    expect(runPlanOf(url, TODAY)).toMatchObject({ family: 'pgatour', player_id: '99001' });
    const steps = what(url) ?? [];
    expect(steps.slice(0, 5)).toEqual([
      'open https://www.pgatour.com/player/99001/lena-beispiel/results', 'pick Tour=PGA Tour', 'pick Season=2026', 'pick Season=2025', 'pick Season=2024',
    ]);
    expect(steps).toContain('pick Tour=Korn Ferry Tour');
    expect(steps).toContain('open https://www.pgatour.com/player/99001/lena-beispiel/stats');
    expect(steps).toHaveLength(18);
    expect(runMayOpen('pgatour', '99001', 'https://www.pgatour.com/player/99001/lena-beispiel/stats')).toBe(true);
    expect(runMayOpen('pgatour', '99001', 'https://www.pgatour.com/player/12/otto-erfunden/stats')).toBe(false);
  });

  it('lpga.com and epsontour.com: the seasons on Results and on Stats', () => {
    expect(runPlanOf('https://www.epsontour.com/athletes/lena-beispiel/99001/stats', TODAY)).toMatchObject({ family: 'epson', player_id: '99001' });
    expect(what('https://www.lpga.com/athletes/lena-beispiel/99001/results')).toEqual([
      'open https://www.lpga.com/athletes/lena-beispiel/99001/results', 'pick Seasons=2026', 'pick Seasons=2025', 'pick Seasons=2024',
      'open https://www.lpga.com/athletes/lena-beispiel/99001/stats', 'pick Seasons=2026', 'pick Seasons=2025', 'pick Seasons=2024',
    ]);
    expect(runMayOpen('lpga', '99001', 'https://www.epsontour.com/athletes/lena-beispiel/99001/stats')).toBe(false);
  });

  it('knows the tour of any page of these sites, and the player of a season page', () => {
    expect(runFamilyOf('https://www.pgatour.com/leaderboard')).toBe('pgatour');
    expect(runFamilyOf('https://www.epsontour.com/athletes/x/1/results')).toBe('epson');
    expect(runFamilyOf('https://ladieseuropeantour.com/order-of-merit')).toBe('tour:let');
    expect(runFamilyOf('https://www.alpstourgolf.com/')).toBe('alps');
    expect(runFamilyOf('https://www.europeantour.com/players/x-1/')).toBe('europeantour');
    expect(runFamilyOf('https://www.progolftour.de/')).toBeNull();
    expect(runFamilyOf('nonsense')).toBeNull();
    expect(seasonPlayerOf('https://www.lpga.com/athletes/lena-beispiel/99001/stats')).toBe('99001');
    expect(seasonPlayerOf('https://www.pgatour.com/player/99001/lena-beispiel/results')).toBe('99001');
  });

  it('no run anywhere else, and nothing from an address that isn\'t one', () => {
    expect(runPlanOf('https://www.pgatour.com/leaderboard', TODAY)).toBeNull();
    expect(runPlanOf('https://www.progolftour.de/player-profile/1', TODAY)).toBeNull();
    expect(runPlanOf('not an address', TODAY)).toBeNull();
  });
});
