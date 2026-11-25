// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A page's figures written beside their label, where the value comes *before* it ("134" over "CME Points Rank") or is
 * part of the label's own text ("PTS: 494"): the season ranking of a tour's player page. `snapshotOf`'s labelled values
 * take only a value after its label; this takes the others. Taken in the page's script like the snapshot, from the
 * small elements only (a label is short), first match in page order. A value before its label is a figure ("134",
 * "3,980.187"), never other text.
 */

import { clean, textOf, type DomElement } from './snapshot.ts';

export interface FigureElement extends DomElement {
  previousElementSibling: FigureElement | null;
  parentElement: FigureElement | null;
}
export interface FigureDocument {
  querySelectorAll(selector: string): ArrayLike<FigureElement>;
}

export interface Wanted {
  key: string;
  /** The label's whole text. */
  label: RegExp;
  /** `before`: the value is the element just before the label; `self`: the label's own text holds it. */
  take: 'before' | 'self';
}

/** The labels' values as text, by key; a label not found (or without a value) is left out. */
export function figuresOf(doc: FigureDocument, wanted: readonly Wanted[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (wanted.length === 0) return out;
  for (const el of Array.from(doc.querySelectorAll('div, span, p, dt, dd')).slice(0, 20000)) {
    if ((el.textContent ?? '').length > 80) continue;
    const text = clean(textOf(el));
    if (!text) continue;
    // A wrapper whose child holds the same text: the child is the label (its turn comes next).
    if (Array.from(el.childNodes).some((c) => c.nodeType === 1 && clean(textOf(c)) === text)) continue;
    for (const w of wanted) {
      if (w.key in out || !w.label.test(text)) continue;
      const value = w.take === 'self' ? text : before(el, text);
      if (value) out[w.key] = value;
    }
    if (wanted.every((w) => w.key in out)) break;
  }
  return out;
}

const FIGURE = /^[0-9][0-9,.]{0,15}(?:st|nd|rd|th|T)?$/;

/** The text just before a label: before the label itself, or before the wrappers that hold nothing but it. */
function before(label: FigureElement, text: string): string {
  let at: FigureElement | null = label;
  for (let up = 0; at && up < 5; up += 1) {
    if (at.previousElementSibling) {
      // A figure, nothing else: a whole other box before a lone label is no value of it.
      const v = clean(textOf(at.previousElementSibling));
      return FIGURE.test(v) ? v : '';
    }
    const parent: FigureElement | null = at.parentElement;
    at = parent && clean(textOf(parent)) === text ? parent : null;
  }
  return '';
}

/** A figure as a number: "1,234.5", "PTS: 494", "63.688"; none for anything else. */
export function figureNumber(s: string | undefined): number | undefined {
  const m = /(?:^|\s|:)([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)$/.exec((s ?? '').trim());
  if (!m?.[1]) return undefined;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? n : undefined;
}
