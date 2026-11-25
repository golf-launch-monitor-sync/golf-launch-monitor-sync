// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Season pages made up by hand in the shape `snapshotOf` gives them (PGA Tour and Korn Ferry Tour, LPGA Tour and
 * Epson Tour): made-up players, made-up tournaments, made-up numbers. Never a recorded page.
 */

import type { Cell, Snapshot } from './snapshot.ts';

const PGA = 'https://www.pgatour.com';
const cells = (...t: (string | Cell)[]): Cell[] => t.map((c) => (typeof c === 'string' ? { text: c } : c));

const PGA_HEAD = ['Date', 'Tournament', 'Pos', 'R1', 'R2', 'R3', 'R4', 'Total', 'To Par', 'Rank', 'Pts', '', 'Rank', 'Pts', 'Winnings', ''];

/** A season's line on pgatour.com: the last day (M.D.YYYY), the tournament, place, R1-R4 ("-" for none), points. */
export function pgaRow(date: string, name: string, pos: string, rounds: (number | '-')[], pts = '-', event?: string): Cell[] {
  const r = [0, 1, 2, 3].map((i) => String(rounds[i] ?? '-'));
  const total = rounds.filter((x): x is number => typeof x === 'number').reduce((a, b) => a + b, 0);
  const tourcast = event ? { text: 'TOURCAST Logo Right Arrow', href: `https://tourcast.pgatour.com/tourcast.html?id=${event}&webview=true#/hole-view?round=1&hole=1` } : '-';
  return cells(date, name, pos, ...r, String(total), '-3', '50', pts, '', '-', '-', '$1,000', tourcast);
}

/** Max Erfunden's *Results* page, PGA Tour 2026: 83rd of the FedExCup with 494 points, three tournaments. */
export function pgaResults(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  return {
    url: `${PGA}/player/99002/max-erfunden/results`,
    title: 'Max Erfunden',
    lines: ['Max Erfunden', 'Results & Scorecards', 'Season Recap'],
    pairs: { Tour: 'PGA Tour', Season: '2026' },
    selected: [],
    tables: [{
      head: PGA_HEAD,
      rows: rows ?? [
        pgaRow('1.25.2026', 'Sample Desert Classic', 'CUT', [71, 66, 70, '-'], '-', 'R2026902'),
        pgaRow('2.1.2026', 'Made-up Coast Open', 'T5', [65, 75, 65, 68], '105.000', 'R2026904'),
        pgaRow('5.17.2026', 'An Invented Championship', 'T18', [67, 70, 73, 69], '56.250'),
      ],
    }],
    links: [],
    ...over,
  };
}

/** The standing beside the season's table (`figuresOf` with pgatour.FIGURES). */
export const pgaFigures = (rank = '83', points = 'PTS: 494'): Record<string, string> => ({ rank, points });

const LPGA_HEAD = ['TOURNAMENT', 'POS', 'TO PAR', 'OFFICIAL MONEY', 'R1', 'R2', 'R3', 'R4', 'TOTAL', 'CME POINTS'];

/** A season's line on lpga.com or epsontour.com: the first day and the tournament (with its link), place, R1-R4, points. */
export function lpgaRow(date: string, name: string, slug: string, pos: string, rounds: (number | '-')[], pts = '0.00', origin = 'https://www.lpga.com'): Cell[] {
  const r = [0, 1, 2, 3].map((i) => String(rounds[i] ?? '-'));
  const total = rounds.filter((x): x is number => typeof x === 'number').reduce((a, b) => a + b, 0);
  return cells({ text: `${date} ${name}`, href: `${origin}/tournaments/${slug}/overview` }, pos, '-1', '$0', ...r, String(total), pts);
}

/** Lena Ausgedacht's *Results* page, LPGA Tour 2026: 134th of the Race to CME Globe, three tournaments. */
export function lpgaResults(over: Partial<Snapshot> = {}, rows?: Cell[][]): Snapshot {
  return {
    url: 'https://www.lpga.com/athletes/lena-ausgedacht/99003/results',
    title: 'Lena Ausgedacht',
    lines: ['Lena Ausgedacht', 'Race to CME Globe'],
    pairs: { Seasons: '2026' },
    selected: [],
    tables: [{
      head: LPGA_HEAD,
      rows: rows ?? [
        lpgaRow('10/01/2026', 'Sample Island Championship', 'sample-island-championship', 'CUT', [68, 75, '-', '-']),
        lpgaRow('07/23/2026', 'Made-up Links Open', 'made-up-links-open', 'T44', [77, 70, 74, 77], '9.07'),
        lpgaRow('03/19/2026', 'Invented Founders Cup', 'invented-founders-cup', 'T36', [75, 67, 69, 72], '16.50'),
      ],
    }],
    links: [],
    ...over,
  };
}

/** The standing above its labels (`figuresOf` with lpga.FIGURES). */
export const lpgaFigures = (rank = '134', points = '63.688'): Record<string, string> => ({ rank, points });
