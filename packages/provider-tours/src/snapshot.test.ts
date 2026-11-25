// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { clean, column, nameKey, snapshotOf, type DomElement, type DomNode } from './snapshot.ts';

// A tiny DOM, enough for the selectors snapshotOf uses ("a b" as descendant, "a[href]", lists with commas).
class Text implements DomNode {
  nodeType = 3;
  constructor(public textContent: string) {}
}
class El implements DomElement {
  nodeType = 1;
  parent: El | null = null;
  nextElementSibling: El | null = null;
  childNodes: (El | Text)[] = [];
  constructor(public tagName: string, public attrs: Record<string, string> = {}, kids: (El | string)[] = []) {
    let prev: El | null = null;
    for (const k of kids) {
      const n = typeof k === 'string' ? new Text(k) : k;
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
const h = (tag: string, attrs: Record<string, string> | (El | string)[] = {}, kids: (El | string)[] = []) =>
  Array.isArray(attrs) ? new El(tag, {}, attrs) : new El(tag, attrs, kids);

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

  it('cleans text, finds columns, makes names comparable', () => {
    expect(clean('  a\n b ')).toBe('a b');
    expect(clean(null)).toBe('');
    expect(column(['#', 'Player', 'Date:'], 'date')).toBe(2);
    expect(column(['#'], 'Player')).toBe(-1);
    expect(nameKey('Jörg-Müller (AM)')).toBe(nameKey('JORG MULLER'));
    expect(nameKey("Anne-Marie O'Neill")).toBe('anne marie o neill');
  });
});
