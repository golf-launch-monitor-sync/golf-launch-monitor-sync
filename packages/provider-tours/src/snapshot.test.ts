// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { clean, column, nameKey, snapshotOf } from './snapshot.ts';
import * as progolftour from './progolftour.ts';
import { docOf, h, pgtProfile, pgtResult } from './testing.ts';

describe('a page as text', () => {
  const doc = h('html', [
    h('h1', ['Lena  Beispiel', h('button', ['Year 2026'])]),
    h('div', [h('div', ['Order of Merit']), h('div', [h('i', ['']), ' 7th'])]),
    h('dl', [h('dt', ['Date:']), h('dd', ['02.03.2026 - 04.03.2026'])]),
    h('ul', [h('li', ['Sample Golf Club PAR 71'])]),
    h('table', [
      h('thead', [h('tr', [h('th', ['Player']), h('th', ['R1']), h('th', ['Total'])])]),
      h('tbody', [
        h('tr', [h('td', [h('a', { href: '/player-profile/1' }, ['Lena'])]), h('td', ['70']), h('td', ['70'])]),
        h('tr', [h('td', ['ad'])]),
      ]),
    ]),
    h('table', [h('tr', [h('th', ['A']), h('th', ['B']), h('th', ['C'])]), h('tr', [h('td', ['1']), h('td', ['2']), h('td', ['3'])])]),
    h('a', { href: '?tab=x&tournament=7' }, ['tab']),
    h('a', { href: 'http://[bad' }, ['bad']),
  ]);
  const snap = snapshotOf(doc, 'https://www.progolftour.de/tournament-details/x', ['Order of Merit']);

  it('takes title, lines, labelled values, tables and links as plain text', () => {
    expect(snap.title).toBe('Lena Beispiel');
    expect(snap.pairs).toEqual({ 'Date:': '02.03.2026 - 04.03.2026', 'Order of Merit': '7th' });
    expect(snap.lines).toEqual(['Lena Beispiel Year 2026', 'Sample Golf Club PAR 71']);
    expect(snap.tables[0]).toEqual({
      head: ['Player', 'R1', 'Total'],
      rows: [[{ text: 'Lena', href: 'https://www.progolftour.de/player-profile/1' }, { text: '70' }, { text: '70' }]],
    });
    expect(snap.tables[1]).toEqual({ head: ['A', 'B', 'C'], rows: [[{ text: '1' }, { text: '2' }, { text: '3' }]] });
    expect(snap.links).toEqual([
      'https://www.progolftour.de/player-profile/1',
      'https://www.progolftour.de/tournament-details/x?tab=x&tournament=7',
    ]);
  });

  it('takes a figure written above its label, and the options chosen in the page\'s selects', () => {
    const page = h('html', [
      h('div', [h('p', ['35th']), h('p', ['R2M'])]),
      h('div', [h('p', ['12']), h('p', ['Tournaments Played'])]),
      h('div', [h('p', ['160']), h('p', ['Tournaments Played'])]),
      h('div', [h('p', ['Current Rank'])]),
      h('select', [h('option', ['2027']), h('option', { checked: '' }, ['2026'])]),
      h('select', [h('option', { checked: '' }, ['HotelPlanner Tour'])]),
    ]);
    const s = snapshotOf(page, 'https://www.europeantour.com/players/x-1/', [], ['r2m', 'Tournaments Played', 'Current Rank']);
    // The first of a label counts; a label with nothing before it has no value; the label is kept as asked.
    expect(s.pairs).toEqual({ r2m: '35th', 'Tournaments Played': '12' });
    expect(s.selected).toEqual(['2026', 'HotelPlanner Tour']);
    expect(snap.selected).toEqual([]);
  });

  it('cleans text, finds columns, makes names comparable', () => {
    expect(clean('  a\n b ')).toBe('a b');
    expect(clean(null)).toBe('');
    expect(column(['#', 'Player', 'Date:'], 'date')).toBe(2);
    expect(column(['#'], 'Player')).toBe(-1);
    expect(nameKey('Jörg-Müller (AM)')).toBe(nameKey('JORG MULLER'));
    expect(nameKey("Anne-Marie O'Neill")).toBe('anne marie o neill');
  });
});

describe('a made-up page as a document', () => {
  it('reads back as the snapshot it was made of, for what the Pro Golf Tour module takes', () => {
    const prof = pgtProfile();
    expect(progolftour.readProfile(snapshotOf(docOf(prof), prof.url, progolftour.LABELS))).toEqual(progolftour.readProfile(prof));
    const res = pgtResult();
    expect(progolftour.ownLine(snapshotOf(docOf(res), res.url, progolftour.LABELS), 'Lena Beispiel')).toEqual(progolftour.ownLine(res, 'Lena Beispiel'));
  });
});
