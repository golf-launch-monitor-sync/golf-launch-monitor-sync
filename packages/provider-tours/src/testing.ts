// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Pages of the tours made up by hand in their shape, as `snapshotOf` gives them: made-up players, made-up
 * tournaments, made-up numbers. Never a recorded page.
 */

import type { Cell, DomElement, DomNode, Snapshot, Table } from './snapshot.ts';

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

// A tiny DOM, enough for the selectors snapshotOf uses ("a b" as descendant, "a[href]", lists with commas): for the
// tests of a page's script, which reads a document where the pure parts read a snapshot.
class TextNode implements DomNode {
  nodeType = 3;
  constructor(public textContent: string) {}
}

export class El implements DomElement {
  nodeType = 1;
  parent: El | null = null;
  nextElementSibling: El | null = null;
  childNodes: (El | TextNode)[] = [];
  constructor(public tagName: string, public attrs: Record<string, string> = {}, kids: (El | string)[] = []) {
    let prev: El | null = null;
    for (const k of kids) {
      const n = typeof k === 'string' ? new TextNode(k) : k;
      if (n instanceof El) {
        n.parent = this;
        if (prev) prev.nextElementSibling = n;
        prev = n;
      }
      this.childNodes.push(n);
    }
  }
  get textContent(): string {
    return this.childNodes.map((n) => n.textContent).join('');
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  all(): El[] {
    return this.childNodes.flatMap((n) => (n instanceof El ? [n, ...n.all()] : []));
  }
  private matches(sel: string): boolean {
    const parts = sel.trim().split(/\s+/);
    const one = (e: El, p: string) => {
      const m = /^([a-z0-9]+)(\[([a-z]+)\])?$/.exec(p);
      return !!m && e.tagName === m[1] && (!m[3] || e.getAttribute(m[3]) !== null);
    };
    if (!one(this, parts[parts.length - 1] ?? '')) return false;
    let up = this.parent;
    for (let i = parts.length - 2; i >= 0; i -= 1) {
      while (up && !one(up, parts[i] ?? '')) up = up.parent;
      if (!up) return false;
      up = up.parent;
    }
    return true;
  }
  querySelectorAll(sel: string): El[] {
    return this.all().filter((e) => sel.split(',').some((s) => e.matches(s)));
  }
}

/** An element: `h('td', [h('a', { href }, ['text'])])`. */
export const h = (tag: string, attrs: Record<string, string> | (El | string)[] = {}, kids: (El | string)[] = []): El =>
  Array.isArray(attrs) ? new El(tag, {}, attrs) : new El(tag, attrs, kids);

/**
 * A made-up page's document from its snapshot, as a site might build it: the title as the h1, the lines as list items,
 * the labelled values as a definition list, the tables with their heads, the links. `snapshotOf` of it reads back what
 * the tour's module needs of the snapshot.
 */
export function docOf(snap: Snapshot): El {
  const cell = (c: Cell, tag: string) => h(tag, c.href ? [h('a', { href: c.href }, [c.text])] : [c.text]);
  const inTables = new Set(snap.tables.flatMap((t) => t.rows.flatMap((r) => r.map((c) => c.href ?? ''))));
  return h('html', [
    h('body', [
      ...(snap.title ? [h('h1', [snap.title])] : []),
      h('ul', snap.lines.map((l) => h('li', [l]))),
      h('dl', Object.entries(snap.pairs).flatMap(([k, v]) => [h('dt', [k]), h('dd', [v])])),
      ...snap.tables.map((t) =>
        h('table', [h('thead', [h('tr', t.head.map((x) => h('th', [x])))]), h('tbody', t.rows.map((r) => h('tr', r.map((c) => cell(c, 'td')))))]),
      ),
      ...snap.links.filter((l) => !inTables.has(l)).map((l) => h('a', { href: l }, ['link'])),
    ]),
  ]);
}
