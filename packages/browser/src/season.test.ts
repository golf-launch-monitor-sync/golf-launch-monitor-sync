// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { MemoryStorage } from '@glmsync/core';
import { pgatour, type TourPage } from '@glmsync/provider-tours';
import { pgaFigures, pgaResults, pgaRow } from '@glmsync/provider-tours/testing';
import { describe, expect, it } from 'vitest';
import { SeasonKeeper } from './season.ts';

const TODAY = '2026-11-26';
function read(over = {}, rows?: Parameters<typeof pgaResults>[1], figures = pgaFigures()): TourPage {
  const r = pgatour.readResults(pgaResults(over, rows), figures, TODAY);
  if (r.kind !== 'page') throw new Error('no page');
  return r.page;
}

describe('what a client keeps of the season pages while Fetch all goes through them', () => {
  it('merges the seasons of a tour into one page, with the newest standing, and forgets them as they go out', async () => {
    const k = new SeasonKeeper(new MemoryStorage());
    await k.seen(read());
    await k.seen(read({ pairs: { Tour: 'PGA Tour', Season: '2025' } }, [pgaRow('3.9.2025', 'Earlier Classic', 'T9', [70, 70, 70, 70], '60.000', 'R2025910')], pgaFigures('120', 'PTS: 300')));
    await k.seen(read({ pairs: { Tour: 'Korn Ferry Tour', Season: '2026' } }));
    const [pga, ...rest] = await k.take(['tour:pga_tour']);
    expect(rest).toEqual([]);
    expect(pga?.tournaments.map((t) => t.start?.slice(0, 4))).toEqual(['2026', '2026', '2026', '2025']);
    expect(pga?.ranking).toMatchObject({ rank: 83, as_of: TODAY });
    expect(await k.take(['tour:pga_tour'])).toEqual([]);
    expect((await k.take(['tour:korn_ferry', 'tour:pga_tour'])).map((p) => p.site)).toEqual(['tour:korn_ferry']);
  });

  it('another player\'s page replaces what was kept; what doesn\'t hold or isn\'t a season site is ignored', async () => {
    const s = new MemoryStorage();
    const k = new SeasonKeeper(s);
    await k.seen(read());
    await k.seen({ ...read(), id: '12', name: 'Otto Erfunden', tournaments: read().tournaments.slice(0, 1) });
    expect((await k.take(['tour:pga_tour']))[0]).toMatchObject({ id: '12' });
    expect(await k.seen({ site: 'tour:pga_tour' })).toBe(0);
    expect(await k.seen({ ...read(), site: 'tour:let' })).toBe(0);
    await s.set('tours:season-run', '{not json');
    expect(await k.take(['tour:pga_tour'])).toEqual([]);
  });
});
