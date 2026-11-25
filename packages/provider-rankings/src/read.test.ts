// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import schema from '../../../spec/prores/prores-1.schema.json' with { type: 'json' };
import { makeAjv } from '../../spec/src/check.ts';
import { batchOf, subjectOf } from './batch.ts';
import { checkPage, figureOf, hasTable, numberOf, readPage } from './read.ts';
import { playerPageOf } from './sites.ts';
import { doc, el, owgrPage, rolexPage } from './testing.ts';

const OWGR = 'https://www.owgr.com/playerprofile/max-mustermann-90001';
const ROLEX = 'https://www.rolexrankings.com/players/7701';
const ROLEX_TITLE = 'Lena Musterfrau - Players - Rolex Rankings';
const check = makeAjv().compile(schema);

const owgr = () =>
  owgrPage({
    name: 'Max Mustermann',
    rank: '412th',
    avg: '0.9871',
    divisor: '40',
    rows: [
      { name: 'Musterstadt Open', id: 90012, tour: 'DPWT', week: 40, year: 2026, finish: 'T17', points: '2.16597' },
      { name: 'Multi Win Bonus 70% - Musterstadt Open', tour: 'DPWT', week: 40, year: 2026, finish: 'BP', points: '4.00000' },
      { name: 'Beispiel Challenge', id: 90007, tour: 'CHA', week: 39, year: 2026, finish: '1', points: '12.50000' },
      { name: 'A Major Somewhere', id: 89950, tour: 'Maj', week: 29, year: 2026, finish: 'MC', points: '-' },
    ],
  });

describe('which pages', () => {
  it('knows a player’s own page by its address, and nothing else of the sites', () => {
    expect(playerPageOf(OWGR)).toEqual({ site: 'owgr', id: '90001', slug: 'max mustermann' });
    expect(playerPageOf('https://www.owgr.com/playerprofile/j.j.-example-17536/')).toEqual({ site: 'owgr', id: '17536', slug: 'j.j. example' });
    expect(playerPageOf(ROLEX)).toEqual({ site: 'rolex', id: '7701' });
    for (const other of [
      'https://www.owgr.com/current-world-ranking',
      'https://www.owgr.com/events/musterstadt-open-90012',
      'https://www.rolexrankings.com/rankings',
      'https://www.rolexrankings.com/players/7701/compare',
      'http://www.rolexrankings.com/players/7701',
      'https://owgr.com.evil.test/playerprofile/max-mustermann-90001',
      'not an address',
      undefined,
    ]) expect([other, playerPageOf(other)]).toEqual([other, null]);
  });
});

describe('OWGR’s page', () => {
  it('reads the head’s figures and the player’s tournaments by week, without the bonus line', () => {
    const r = readPage(owgr(), OWGR, 'Official World Golf Ranking - Player Profile', '2026-11-25');
    expect(r).toEqual({
      ok: true,
      page: {
        site: 'owgr',
        id: '90001',
        name: 'Max Mustermann',
        ranking: { source: 'owgr', rank: 412, points: 0.9871, events: 40, as_of: '2026-11-25' },
        tournaments: [
          { ref: 'owgr-90012', week: '2026-W40', tour: 'dp_world', name: 'Musterstadt Open', place: 17, tied: true, points: 2.16597 },
          { ref: 'owgr-90007', week: '2026-W39', tour: 'hotelplanner', name: 'Beispiel Challenge', place: 1, points: 12.5 },
          { ref: 'owgr-89950', week: '2026-W29', name: 'A Major Somewhere', result: 'MC' },
        ],
      },
    });
  });

  it('says when the table isn’t there yet, and reads the ranking without it', () => {
    const d = owgrPage({ name: 'Max Mustermann', rank: '412th', avg: '0.9871', divisor: '40', table: false });
    expect(hasTable(d)).toBe(false);
    expect(hasTable(owgr())).toBe(true);
    const r = readPage(d, OWGR, '', '2026-11-25');
    expect(r.ok && r.page.tournaments).toBeNull();
    expect(r.ok && r.page.ranking.rank).toBe(412);
  });

  it('takes the name as the address spells it when the page writes it nowhere', () => {
    const d = owgrPage({ name: 'Somebody Else', rank: '412th', avg: '0.9871', divisor: '40' });
    const r = readPage(d, 'https://www.owgr.com/playerprofile/max-mustermann-90001', '', '2026-11-25');
    expect(r.ok && r.page.name).toBe('Max Mustermann');
  });

  it('reads nothing of a page that doesn’t say what it should', () => {
    expect(readPage(doc(el('div', 'Something else entirely')), OWGR, '', '2026-11-25')).toEqual({ ok: false, why: 'changed_page' });
    expect(readPage(owgr(), 'https://www.owgr.com/current-world-ranking', '', '2026-11-25')).toEqual({ ok: false, why: 'not_player_page' });
  });
});

describe('Rolex’s page', () => {
  const page = () =>
    rolexPage({
      name: 'Lena Musterfrau',
      rank: '87',
      avg: '1.42',
      events: '38',
      rows: [
        { name: 'Beispiel Classic', id: 7001, tour: 'LPGA', week: 47, year: 2026, position: '36T', points: '2.2', after: '87' },
        { name: 'Musterland Masters', id: 6950, tour: 'LET', week: 20, year: 2026, position: '7T', points: '2.34', after: '90' },
        { name: 'Exemple Open', id: 6901, tour: 'LPGA', week: 40, year: 2026, position: 'CUT', points: '—', after: '88' },
        { name: 'An Olympic Event', id: 6800, tour: 'IGF', week: 31, year: 2026, position: '2', points: '22.2', after: '91' },
      ],
    });

  it('reads the head, the name from the title, the events table - not the best performances', () => {
    const r = readPage(page(), ROLEX, ROLEX_TITLE, '2026-11-25');
    expect(r).toEqual({
      ok: true,
      page: {
        site: 'rolex',
        id: '7701',
        name: 'Lena Musterfrau',
        ranking: { source: 'rolex', rank: 87, points: 1.42, events: 38, as_of: '2026-11-25' },
        tournaments: [
          { ref: 'rolex-7001', week: '2026-W47', tour: 'lpga', name: 'Beispiel Classic', place: 36, tied: true, points: 2.2 },
          { ref: 'rolex-6950', week: '2026-W20', tour: 'let', name: 'Musterland Masters', place: 7, tied: true, points: 2.34 },
          { ref: 'rolex-6901', week: '2026-W40', tour: 'lpga', name: 'Exemple Open', result: 'MC' },
          { ref: 'rolex-6800', week: '2026-W31', name: 'An Olympic Event', place: 2, points: 22.2 },
        ],
      },
    });
  });

  it('reads nothing without the title naming the player', () => {
    expect(readPage(page(), ROLEX, 'Rolex Rankings', '2026-11-25')).toEqual({ ok: false, why: 'changed_page' });
  });
});

describe('values as the pages write them', () => {
  it('reads numbers strictly', () => {
    expect(numberOf('324.90038')).toBe(324.90038);
    expect(numberOf('1,234.5')).toBe(1234.5);
    for (const x of ['-', '—', '', '1e3', '-2', '2.2.2', 'NaN']) expect([x, numberOf(x)]).toEqual([x, null]);
  });

  it('finds a figure by its label, the ordinal read as a number', () => {
    const d = doc(el('div', el('div', '3rd'), el('div', 'Current OWGR Rank')), el('div', el('h2', '26'), ' rank '));
    expect(figureOf(d, /current owgr rank/)).toBe(3);
    expect(figureOf(d, /rank/)).toBe(26);
    expect(figureOf(d, /divisor/)).toBeNull();
  });
});

describe('the batch', () => {
  it('is prores/1 of one page, with the confirmation only when given', () => {
    const r = readPage(owgr(), OWGR, '', '2026-11-25');
    if (!r.ok) throw new Error('read');
    expect(subjectOf(r.page)).toBe('owgr:90001');
    const opts = { account_ref: 'Pq3c0mB1v4Lr2kq9WzT8yA5nE6pH7sJ0dF1gK2lM3oN', generated_at: '2026-11-25T18:00:00Z', generator: { name: 'Golf Stats Sync', version: '0.13.0' } };
    const b = batchOf(r.page, { ...opts, plan_id: 'p-1', reason: 'manual' });
    expect([check(b), check.errors ?? []]).toEqual([true, []]);
    expect(b.player).toEqual({ name: 'Max Mustermann' });
    expect(b.sync).toEqual({ plan_id: 'p-1', reason: 'manual' });
    expect(b.tournaments).toHaveLength(3);
    expect(JSON.stringify(b)).not.toContain('90001');
    const yes = batchOf(r.page, { ...opts, confirmed: true });
    expect(yes.player).toEqual({ name: 'Max Mustermann', confirmed: true });
    expect(check(yes)).toBe(true);
    const bare = readPage(owgrPage({ name: 'Max Mustermann', rank: '412th', avg: '0.9871', divisor: '40', table: false }), OWGR, '', '2026-11-25');
    if (!bare.ok) throw new Error('read');
    const only = batchOf(bare.page, opts);
    expect('tournaments' in only).toBe(false);
    expect(check(only)).toBe(true);
  });
});

describe('a page from where it was read', () => {
  it('is read again strictly: what doesn’t fit is dropped, a page without its ranking is none', () => {
    const r = readPage(owgr(), OWGR, '', '2026-11-25');
    if (!r.ok) throw new Error('read');
    expect(checkPage(JSON.parse(JSON.stringify(r.page)))).toEqual(r.page);
    const bad = {
      ...r.page,
      tournaments: [
        ...(r.page.tournaments ?? []),
        { ref: 'rolex-1', week: '2026-W10' },
        { ref: 'owgr-2', week: '2026-W99' },
        { ref: 'owgr-3', week: '2026-W10', tour: 'moon', place: 0, tied: true, points: -1, name: '', leaders: ['Someone'] },
        'x',
      ],
    };
    expect(checkPage(bad)?.tournaments?.slice(3)).toEqual([{ ref: 'owgr-3', week: '2026-W10' }]);
    for (const junk of [null, 'page', [], { ...r.page, site: 'egr' }, { ...r.page, id: '12a' }, { ...r.page, name: 'X' },
      { ...r.page, ranking: { source: 'rolex', rank: 3, as_of: '2026-11-25' } }, { ...r.page, ranking: { source: 'owgr', as_of: '2026-11-25' } }]) {
      expect(checkPage(junk)).toBeNull();
    }
  });
});
