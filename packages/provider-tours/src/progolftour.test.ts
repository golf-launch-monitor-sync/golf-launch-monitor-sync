// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { dayOf, mayOpen, ownLine, placeOf, profileOf, readProfile, resultKey, resultUrl, siteRead, type OwnLine, type Profile } from './progolftour.ts';
import { pgtEntry, pgtLine, pgtProfile, pgtResult } from './testing.ts';

const profile = (): Profile => {
  const p = readProfile(pgtProfile());
  if (p?.kind !== 'profile') throw new Error('no profile');
  return p;
};
const line = (snap = pgtResult()): OwnLine => {
  const l = ownLine(snap, 'Lena Beispiel');
  if (l?.kind !== 'result') throw new Error(`no line: ${JSON.stringify(l)}`);
  return l;
};

describe('Pro Golf Tour: the profile', () => {
  it('reads the ranking and the season\'s tournaments, not the prize money', () => {
    const p = profile();
    expect(p).toMatchObject({ player_id: '99001', player_name: 'Lena Beispiel', season: 2026 });
    expect(p.ranking).toEqual({ source: 'tour:pro_golf_tour', rank: 7, points: 17290.6, events: 3 });
    expect(p.entries).toEqual([
      { key: 'sample-desert-open-2026', name: 'Sample Desert Open 2026', start: '2026-03-02', end: '2026-03-04', place: 6, tied: true, points: 1027.5 },
      { key: 'beispiel-köln-classic-2026', name: 'Beispiel Köln Classic 2026', start: '2026-06-16', end: '2026-06-18', result: 'MC' },
      { key: 'made-up-final-2026', name: 'Made-up Final 2026', start: '2026-09-29', end: '2026-10-01', place: 1, points: 5833.33 },
    ]);
    expect(JSON.stringify(p)).not.toContain('17,580');
  });

  it('is no profile on another page, and an unknown shape says so instead of guessing', () => {
    expect(readProfile(pgtResult())).toBeNull();
    expect(readProfile(pgtProfile({ url: 'https://www.progolftour.de/order-of-merit-en' }))).toBeNull();
    expect(readProfile(pgtProfile({ tables: [] }))).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(readProfile(pgtProfile({ title: '' }))).toEqual({ kind: 'unread', why: 'changed_page' });
  });

  it('skips a line that is no tournament and keeps one bad value from costing the rest', () => {
    const p = readProfile(pgtProfile({}, [
      [{ text: '' }, { text: 'Sponsored' }, { text: '' }],
      pgtEntry('31.02.2026', '02.03.2026', 'bad-date', 'Bad date', '3'),
      pgtEntry('10.03.2026', '09.03.2026', 'ends-before-start', 'Odd', 'T1000', 'abc'),
    ]));
    expect(p?.kind === 'profile' && p.entries).toEqual([{ key: 'ends-before-start', name: 'Odd', start: '2026-03-10' }]);
  });

  it('takes the season from the page when the address has none', () => {
    const p = readProfile(pgtProfile({ url: 'https://www.progolftour.de/player-profile/velten-beispiel' }));
    expect(p?.kind === 'profile' && [p.player_id, p.season]).toEqual(['velten-beispiel', 2026]);
  });
});

describe('Pro Golf Tour: his line of a final result', () => {
  it('takes only his line: place, rounds with the par, the field\'s size, the tournament', () => {
    expect(line()).toEqual({
      kind: 'result', key: 'sample-desert-open-2026', ref: 'pgt-5101', place: 6, tied: true, field: 4,
      rounds: [1, 2, 3].map((n, i) => ({ round_no: n, gross: [69, 70, 70][i], par: 71, holes: 18 })),
      start: '2026-03-02', end: '2026-03-04', venue: 'Sample Desert Golf Club', country: 'Egypt', name: 'Sample Desert Open 2026',
    });
  });

  it('never carries anyone else\'s name or score', () => {
    const s = JSON.stringify(line());
    for (const other of ['Otto', 'Erfunden', 'Ausgedacht', 'Platzhalter', '66', '77']) expect(s).not.toContain(other);
  });

  it('finds him written otherwise (accents, hyphens, case, an amateur mark)', () => {
    const snap = pgtResult('x', [pgtLine('T2', 'LÉNA-BEISPIEL (AM)', 70, 71, 72), pgtLine('1', 'Otto Erfunden', 66, 67, 68)]);
    expect(line(snap).rounds.map((r) => r.gross)).toEqual([70, 71, 72]);
  });

  it('a missed cut keeps its two rounds and no place', () => {
    const l = line(pgtResult('x', [pgtLine('1', 'Otto Erfunden', 66, 67, 68), pgtLine('MC', 'Lena Beispiel', 74, 76)]));
    expect([l.place, l.result, l.rounds.length]).toEqual([undefined, 'MC', 2]);
  });

  it('two lines of his name, or none: not his, nothing taken', () => {
    const twice = pgtResult('x', [pgtLine('1', 'Lena Beispiel', 66, 67, 68), pgtLine('2', 'Lena Beispiel', 70, 70, 70)]);
    expect(ownLine(twice, 'Lena Beispiel')).toEqual({ kind: 'unread', why: 'not_him' });
    expect(ownLine(pgtResult(), 'Nobody Here')).toEqual({ kind: 'unread', why: 'not_him' });
    expect(ownLine(pgtResult(), '')).toEqual({ kind: 'unread', why: 'not_him' });
  });

  it('tee times or an entry list are no result; a known table without places is a changed page', () => {
    expect(ownLine(pgtResult('x', [], { tables: [{ head: ['Time', 'Player'], rows: [] }] }), 'Lena Beispiel')).toEqual({ kind: 'unread', why: 'no_result' });
    expect(ownLine(pgtResult('x', [], { tables: [{ head: ['Player', 'R1'], rows: [] }] }), 'Lena Beispiel')).toEqual({ kind: 'unread', why: 'changed_page' });
    expect(ownLine(pgtProfile(), 'Lena Beispiel')).toBeNull();
  });

  it('a round cell that is no score (a to-par, a hole, nothing) is no round', () => {
    const row = pgtLine('T6', 'Lena Beispiel', 69, 70, 70);
    row[7] = { text: '-3' };
    row[8] = { text: 'F' };
    expect(line(pgtResult('x', [row])).rounds.map((r) => r.round_no)).toEqual([3]);
  });

  it('without the tabs\' number the page\'s name is the id, made plain', () => {
    const l = line(pgtResult('vcg-k%C3%B6ln-open-2026', undefined, { links: [] }));
    expect([l.key, l.ref]).toEqual(['vcg-köln-open-2026', 'pgt-vcg-koln-open-2026']);
  });
});

describe('Pro Golf Tour: what a read hands on', () => {
  it('only tournaments with rounds, finished before today; the ranking of today', () => {
    const lines = { 'sample-desert-open-2026': line() };
    const r = siteRead(profile(), lines, '2026-11-25');
    expect(r).toMatchObject({ site: 'tour:pro_golf_tour', id: '99001', name: 'Lena Beispiel', stats: [] });
    expect(r.ranking).toEqual({ source: 'tour:pro_golf_tour', rank: 7, points: 17290.6, events: 3, as_of: '2026-11-25' });
    expect(r.tournaments).toEqual([{
      ref: 'pgt-5101', tour: 'pro_golf_tour', name: 'Sample Desert Open 2026', start: '2026-03-02', end: '2026-03-04',
      venue: 'Sample Desert Golf Club', country: 'Egypt', place: 6, tied: true, field: 4, points: 1027.5, rounds: line().rounds,
    }]);
    expect(siteRead(profile(), lines, '2026-03-04').tournaments).toEqual([]);
  });

  it('a past season\'s ranking is as of its last tournament', () => {
    const p = { ...profile(), season: 2025 };
    expect(siteRead(p, {}, '2026-11-25').ranking.as_of).toBe('2026-10-01');
  });
});

describe('Pro Golf Tour: addresses', () => {
  it('a run opens only tournament pages and profiles of the site', () => {
    expect(mayOpen(resultUrl('vcg-köln-open-2026'))).toBe(true);
    expect(resultUrl('vcg-köln-open-2026')).toBe('https://www.progolftour.de/tournament-details/vcg-k%C3%B6ln-open-2026');
    expect(mayOpen('https://www.progolftour.de/player-profile/99001?year=2026')).toBe(true);
    for (const bad of ['https://www.progolftour.de/login-en', 'https://evil.example/tournament-details/x', 'http://www.progolftour.de/tournament-details/x', 42]) {
      expect(mayOpen(bad)).toBe(false);
    }
    expect(resultKey('https://www.progolftour.de/tournament-details/%E0%A4%A')).toBeNull();
  });

  it('names his profile by its address, and nothing else', () => {
    expect(profileOf('https://www.progolftour.de/player-profile/99001?year=2026')).toEqual({ id: '99001', season: 2026 });
    expect(profileOf('https://www.progolftour.de/player-profile/Velten-Meyer')).toEqual({ id: 'velten-meyer' });
    for (const bad of [resultUrl('x'), 'https://evil.example/player-profile/1', 'http://www.progolftour.de/player-profile/1', null]) {
      expect(profileOf(bad)).toBeNull();
    }
  });

  it('days and places as the site writes them', () => {
    expect([dayOf('19.02.2026'), dayOf('1.2.2026'), dayOf('29.02.2026'), dayOf('2026-02-19')]).toEqual(['2026-02-19', '2026-02-01', undefined, undefined]);
    expect([placeOf('T14'), placeOf('12th'), placeOf('RTD'), placeOf('—'), placeOf('0')]).toEqual([{ place: 14, tied: true }, { place: 12 }, { result: 'WD' }, {}, {}]);
  });
});
