// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A page as the tour modules read it: its address, its headings and list lines, its labelled values, its tables and
 * its links - plain text, no markup. `snapshotOf` takes it from the page the player has open (in the extension's
 * content script or the companion app's window); everything after that is pure and tested on hand-made snapshots.
 *
 * A snapshot holds the whole page, other players' names included, so it never leaves the page's script: the module
 * reduces it there to the player's own line (`ownLine` of a tour) before anything is handed on.
 */

export interface Cell {
  text: string;
  /** The first link in the cell. */
  href?: string;
}

export interface Table {
  head: string[];
  rows: Cell[][];
}

export interface Snapshot {
  url: string;
  /** The first h1's own text (without its buttons, e.g. a season picker). */
  title: string;
  /** Texts of h1-h3 and list items, in page order. */
  lines: string[];
  /** A label's value: a `dt`'s `dd`, or the next element after one whose whole text is a label asked for. */
  pairs: Record<string, string>;
  tables: Table[];
  links: string[];
}

const MOST_LINES = 600;
const MOST_LINKS = 600;
const MOST_ROWS = 600;
const MOST_TEXT = 300;

/** Whitespace collapsed, icon-font glyphs (private use) dropped, cut to a sane length. */
export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/[-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MOST_TEXT);
}

// The little of the DOM this needs (so a test or another window can hand in its own).
export interface DomNode {
  nodeType: number;
  textContent: string | null;
}
export interface DomElement extends DomNode {
  tagName: string;
  childNodes: ArrayLike<DomNode>;
  nextElementSibling: DomElement | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}
export interface DomDocument {
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}

const each = <T>(list: ArrayLike<T>, most: number): T[] => Array.from(list).slice(0, most);

/** An element's text with a space at every element's edge (textContent runs "Club" and "PAR 71" together). */
export function textOf(n: DomNode, depth = 0): string {
  if (n.nodeType === 3) return n.textContent ?? '';
  const el = n as DomElement;
  if (depth > 40 || !el.childNodes || /^(script|style|svg)$/i.test(el.tagName ?? '')) return '';
  return each(el.childNodes, 500).map((c) => textOf(c, depth + 1)).join(' ');
}
const textIn = (el: DomElement): string => clean(textOf(el));

function ownText(el: DomElement): string {
  return clean(each(el.childNodes, 200).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join(' '));
}

function cellOf(el: DomElement, base: string): Cell {
  const a = each(el.querySelectorAll('a[href]'), 1)[0];
  const href = a ? absolute(a.getAttribute('href'), base) : undefined;
  return href ? { text: textIn(el), href } : { text: textIn(el) };
}

function absolute(href: string | null, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

function tableOf(el: DomElement, base: string): Table | null {
  let head = each(el.querySelectorAll('thead th, thead td'), 40).map(textIn);
  let trs = each(el.querySelectorAll('tbody tr'), MOST_ROWS);
  if (head.length === 0) {
    // No thead: the first row of header cells is the head.
    const all = each(el.querySelectorAll('tr'), MOST_ROWS + 1);
    head = all[0] ? each(all[0].querySelectorAll('th'), 40).map(textIn) : [];
    trs = all.slice(1);
  }
  const rows: Cell[][] = [];
  for (const tr of trs) {
    const cells = each(tr.querySelectorAll('td, th'), 40).map((c) => cellOf(c, base));
    if (cells.length >= 3) rows.push(cells);
  }
  return head.length > 0 ? { head, rows } : null;
}

/** The snapshot of the page open now. `labels`: the texts whose next element holds a value worth reading. */
export function snapshotOf(doc: DomDocument, url: string, labels: readonly string[] = []): Snapshot {
  const h1 = each(doc.querySelectorAll('h1'), 1)[0];
  const lines = each(doc.querySelectorAll('h1, h2, h3, li'), MOST_LINES).map(textIn).filter(Boolean);
  const pairs: Record<string, string> = {};
  for (const dt of each(doc.querySelectorAll('dt'), 100)) {
    const k = textIn(dt);
    const dd = dt.nextElementSibling;
    if (k && dd && dd.tagName.toLowerCase() === 'dd' && !(k in pairs)) pairs[k] = textIn(dd);
  }
  if (labels.length > 0) {
    const wanted = new Set(labels);
    for (const el of each(doc.querySelectorAll('div, span, p, th, td'), 20000)) {
      // A label is short: the long elements (the page's wrappers) aren't walked at all.
      if ((el.textContent ?? '').length > 80) continue;
      const k = textIn(el);
      if (wanted.has(k) && !(k in pairs) && el.nextElementSibling) pairs[k] = textIn(el.nextElementSibling);
    }
  }
  const tables = each(doc.querySelectorAll('table'), 20).map((t) => tableOf(t, url)).filter((t): t is Table => t !== null);
  const links = each(doc.querySelectorAll('a[href]'), MOST_LINKS)
    .map((a) => absolute(a.getAttribute('href'), url))
    .filter((h): h is string => Boolean(h));
  return { url, title: h1 ? ownText(h1) : '', lines, pairs, tables, links };
}

/** The column of the first head among `names` (case and a trailing colon ignored), or -1. */
export function column(head: readonly string[], ...names: string[]): number {
  const want = names.map((n) => n.toLowerCase());
  return head.findIndex((h) => want.includes(h.toLowerCase().replace(/:$/, '').trim()));
}

/** A name as two pages may both write it: lower case, accents and umlauts plain, hyphens as spaces, "(AM)" dropped. */
export function nameKey(s: string): string {
  return s
    .replace(/\((am|a)\)/gi, ' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[-‐‑'’.]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
