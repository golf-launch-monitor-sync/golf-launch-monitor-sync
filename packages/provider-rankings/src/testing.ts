// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * For tests: a small made-up DOM (`el`, `doc`) and two player pages in the shapes owgr.com and rolexrankings.com show
 * them, written by hand - made-up players, made-up tournaments, no one's real page.
 */

import type { Doc, El } from './read.ts';

type Child = FakeEl | string;

/** A made-up element: its tag, attributes and children; textContent like the DOM's (the texts joined, no spaces). */
export class FakeEl implements El {
  readonly tagName: string;
  constructor(
    tag: string,
    private readonly attrs: Record<string, string>,
    readonly children: Child[],
  ) {
    this.tagName = tag.toUpperCase();
  }
  get textContent(): string {
    return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('');
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  /** Every element below this one (not itself) whose tag is in the list (`table, tr`), or all for `*`. */
  querySelectorAll(selector: string): FakeEl[] {
    const tags = selector.split(',').map((s) => s.trim().toUpperCase());
    const out: FakeEl[] = [];
    const walk = (e: FakeEl) => {
      for (const c of e.children) {
        if (typeof c === 'string') continue;
        if (tags.includes('*') || tags.includes(c.tagName)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

export function el(tag: string, attrs: Record<string, string> | Child = {}, ...children: Child[]): FakeEl {
  if (typeof attrs === 'string' || attrs instanceof FakeEl) return new FakeEl(tag, {}, [attrs, ...children]);
  return new FakeEl(tag, attrs, children);
}

/** A document of these elements (an <html> around them). */
export function doc(...children: Child[]): Doc & { root: FakeEl } {
  const root = el('html', {}, el('body', {}, ...children));
  return { root, querySelectorAll: (s: string) => root.querySelectorAll(s) };
}

const head = (...names: string[]) => el('thead', el('tr', ...names.map((n) => el('th', el('button', n)))));

export interface OwgrRow {
  name: string;
  id?: number;
  tour: string;
  week: number;
  year: number;
  finish: string;
  points: string;
}

/** OWGR's player page: the head with its figures, the three tabs, the table of events (columns as owgr.com has them). */
export function owgrPage(o: { name: string; rank?: string; avg?: string; divisor?: string; rows?: OwgrRow[]; table?: boolean } = { name: 'Max Mustermann' }): Doc & { root: FakeEl } {
  const fig = (v: string | undefined, label: string) => (v === undefined ? '' : el('div', el('div', v), el('div', label)));
  const rows = (o.rows ?? []).map((r) =>
    el('tr',
      el('td', r.id === undefined ? r.name : el('a', { href: `/events/${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${r.id}` }, el('span', r.name))),
      el('td', el('button', el('span', r.tour))),
      el('td', String(r.week)),
      el('td', String(r.year)),
      el('td', r.finish),
      el('td', r.points),
      el('td', '1.0000'),
      el('td', r.points),
      el('td', '4'),
      el('td', '3')));
  return doc(
    el('header', el('nav', el('button', 'CURRENT RANKING'), el('button', 'EVENTS'))),
    el('main',
      el('div', el('img', { alt: o.name }),
        el('div', el('div', el('img', {}), el('div', o.name)), el('div', el('div', 'World number'), el('div', o.rank?.replace(/\D+$/, '') ?? ''))),
        el('div', el('div', 'Statistics'),
          el('div', fig(o.rank, 'Current OWGR Rank'), fig(o.rank, 'Best OWGR Rank'), fig(o.avg, 'Average Points')),
          el('div', fig('324.90038', 'Total Points'), fig(o.divisor, 'Divisor'), fig(o.divisor, 'Actual Events Played')))),
      el('div', el('button', 'Events'), el('button', 'Form Guide'), el('button', 'Best Performances')),
      o.table === false
        ? el('div', { class: 'spinner' })
        : el('table', head('EVENT', 'TOUR', 'WEEK', 'YEAR', 'FINISH POS.', 'POINTS WON', 'WEIGHT', 'ADJ. POINTS', 'RANK FROM', 'RANK TO'), el('tbody', ...rows)),
      el('div', el('div', 'PLAYER COMPARISON'), el('div', el('div', o.name), el('div', `Rank ${o.rank?.replace(/\D+$/, '') ?? ''}`)))),
    el('footer', '©1986 - 2026 OFFICIAL WORLD GOLF RANKING® All Rights Reserved.'),
  );
}

export interface RolexRow {
  name: string;
  id: number;
  tour: string;
  week: number;
  year: number;
  position: string;
  points: string;
  after: string;
}

/** Rolex's player page: the head (rank, avg pts, tot pts, events), the events table, the best performances, the form table. */
export function rolexPage(o: { name: string; rank: string; avg: string; events: string; rows?: RolexRow[] }): Doc & { root: FakeEl } {
  const fig = (v: string, label: string) => el('div', el('h2', v), label);
  return doc(
    el('nav', el('a', { href: '/' }, 'Dashboard')),
    el('div',
      el('div', el('div', el('h2', o.name.toUpperCase()), 'GER'), el('a', { href: '#' }, '☆')),
      el('div', fig(o.rank, 'rank'), fig(o.avg, 'avg pts'), fig('144.89', 'tot pts'), fig(o.events, 'events')),
      el('div', fig('18', 'Best Rank this Year'), fig('53', 'Worst Rank this Year'))),
    el('div',
      el('h2', 'events'),
      el('table',
        el('thead', el('tr', ...['event', 'tour', 'week', 'year', 'position', 'points', 'rank after'].map((n) => el('th', el('a', { href: '#' }, n))))),
        el('tbody', ...(o.rows ?? []).map((r) =>
          el('tr', el('td', el('a', { href: `/events/${r.id}` }, r.name)), el('td', r.tour), el('td', String(r.week)), el('td', String(r.year)),
            el('td', r.position), el('td', r.points), el('td', r.after))))),
      el('button', 'View more')),
    el('div',
      el('h2', 'best performances'),
      el('table',
        el('thead', el('tr', ...['N°', 'events', 'tour', 'year', 'position', 'points', 'rank after'].map((n) => el('th', n)))),
        el('tbody', el('tr', el('td', el('strong', '1')), el('td', el('a', { href: '/events/5000' }, 'Some Old Open')), el('td', 'LPGA'), el('td', '2024'), el('td', '2'), el('td', '31.8'), el('td', '29'))))),
    el('div',
      el('h2', 'Form table'),
      el('table',
        el('thead', el('tr', ...['year', 'evts', '1ST', '2ND', '3RD', '4-10', 'MC', 'year end rank'].map((n) => el('th', n)))),
        el('tbody', el('tr', el('td', '2026'), el('td', '25'), el('td', '—'), el('td', '1'), el('td', '—'), el('td', '5'), el('td', '7'), el('td', '—'))))),
  );
}
