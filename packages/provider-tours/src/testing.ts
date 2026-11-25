// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Pages of the tours made up by hand in their shape, as `snapshotOf` gives them: made-up players, made-up
 * tournaments, made-up numbers. Never a recorded page.
 */

import type { Cell, Snapshot, Table } from './snapshot.ts';

const PGT = 'https://www.progolftour.de';
const cells = (...t: (string | Cell)[]): Cell[] => t.map((c) => (typeof c === 'string' ? { text: c } : c));

/** A season's line of the profile: start, end, the tournament's page, place, Order of Merit points. */
export function pgtEntry(start: string, end: string, slug: string, name: string, place: string, points = '—'): Cell[] {
  return cells('', start, '—', end, { text: name, href: `${PGT}/tournament-details/${slug}` }, place, points === '—' ? '—' : `€ ${points}`, points);
}

/** Lena Beispiel's profile, season 2026: 7th of the Order of Merit, three tournaments. */
export function pgtProfile(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  const table: Table = {
    head: ['', 'Start', '', 'End', 'Tournament', 'Position', 'Prize money', 'Score'],
    rows: rows ?? [
      pgtEntry('02.03.2026', '04.03.2026', 'sample-desert-open-2026', 'Sample Desert Open 2026', 'T6', '1,027.50'),
      pgtEntry('16.06.2026', '18.06.2026', 'beispiel-k%C3%B6ln-classic-2026', 'Beispiel Köln Classic 2026', 'MC'),
      pgtEntry('29.09.2026', '01.10.2026', 'made-up-final-2026', 'Made-up Final 2026', '1', '5,833.33'),
    ],
  };
  return {
    url: `${PGT}/player-profile/99001?year=2026`,
    title: 'Lena Beispiel',
    lines: ['Beispiel', 'Lena', 'Lena Beispiel Year 2026', 'Statistics - Lena Beispiel Year 2026', 'Winner', 'Missed cut'],
    pairs: { 'Order of Merit': '7th', 'Season points': '17,290.60', 'Season prize money': '€ 17,580.46' },
    tables: [table],
    links: [],
    ...over,
  };
}

const RESULT_HEAD = ['', '#', '', 'Player', 'Today', 'To Par', 'Hole', 'R1', 'R2', 'R3', 'Total', 'Prize money', 'Score'];

/** A field's line of a final result: place, player, then R1-R3 (fewer for a missed cut). */
export function pgtLine(place: string, player: string, ...rounds: number[]): Cell[] {
  const r = [0, 1, 2].map((i) => (rounds[i] === undefined ? '' : String(rounds[i])));
  const total = rounds.reduce((a, b) => a + b, 0);
  return cells('', place, '', player, '-1', '-4', 'F', ...r, String(total), '€ 1.00', '1.00');
}

/** The final result of a made-up tournament: three made-up players besides Lena Beispiel (unless `rows`). */
export function pgtResult(slug = 'sample-desert-open-2026', rows?: Cell[][], over: Partial<Snapshot> = {}): Snapshot {
  return {
    url: `${PGT}/tournament-details/${slug}`,
    title: '',
    lines: ['Sample Desert Open 2026', 'Sample Desert Golf Club', 'Final result Sample Desert Open 2026', 'Sample Desert Golf Club PAR 71'],
    pairs: { 'Golfclub:': 'Sample Desert Golf Club Desert Road 1, 12345 Sampletown, Egypt', 'Date:': '02.03.2026 - 04.03.2026' },
    tables: [{
      head: RESULT_HEAD,
      rows: rows ?? [
        pgtLine('1', 'Otto Erfunden', 66, 67, 68),
        pgtLine('T6', 'Lena Beispiel', 69, 70, 70),
        pgtLine('T6', 'Max Ausgedacht', 70, 70, 69),
        pgtLine('MC', 'Paul Platzhalter', 75, 77),
      ],
    }],
    links: [
      `${PGT}/tournament-details/${slug}?tab=livescoring&tournament=5101#livescoring-5101`,
      `${PGT}/tournament-details/${slug}?tab=tee-times&tournament=5101#livescoring-5101`,
    ],
    ...over,
  };
}
