// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { resultsUrl } from './clicks.ts';
import { HISTORY_SHEET_URL } from './observe.ts';
import { cursorOfLink, everything, historyHash, operate, scoringButton, type El, type Place, type Root } from './operate.ts';
import { cursorOf } from './testing.ts';

/** A made-up element: a tag, its text, its attributes, maybe an open shadow root; it counts its clicks. */
class Fake implements El {
  clicks = 0;
  constructor(
    readonly tagName: string,
    readonly textContent: string | null = null,
    private readonly attrs: Record<string, string> = {},
    public shadowRoot: Root | null = null,
  ) {}
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
  click(): void {
    this.clicks += 1;
  }
}

const root = (...els: El[]): Root => ({ querySelectorAll: () => els });

class FakePlace implements Place {
  hash = '';
  assigned: string[] = [];
  assign(url: string): void {
    this.assigned.push(url);
  }
}

describe('finding golf.de’s own things', () => {
  it('looks into open shadow roots (the History Sheet is a web component)', () => {
    const button = new Fake('BUTTON', '  Scoring   Record ');
    const sheet = new Fake('MY-HANDICAP-HISTORY-SHEET', null, {}, root(new Fake('DIV', 'History Sheet'), button));
    expect(everything(root(new Fake('HEADER'), sheet))).toHaveLength(4);
    expect(scoringButton(root(new Fake('HEADER'), sheet))).toBe(button);
  });

  it('the Scoring Record’s button by its name only, on a button, link or tab', () => {
    expect(scoringButton(root(new Fake('DIV', 'Scoring Record')))).toBeNull();
    expect(scoringButton(root(new Fake('BUTTON', 'Mehr zum Scoring Record lesen')))).toBeNull();
    const tab = new Fake('DIV', 'Scoring Record', { role: 'tab' });
    expect(scoringButton(root(tab))).toBe(tab);
    expect(scoringButton(root(new Fake('A', 'scoring-record')))).not.toBeNull();
  });

  it('the cursor of a pager link', () => {
    expect(cursorOfLink(`#/??first=10&after=${encodeURIComponent('Y3Vyc29yOjEw')}`)).toBe('Y3Vyc29yOjEw');
    expect(cursorOfLink('https://www.golf.de/mein-bereich/handicap-history-sheet.html#/??first=10&after=abc%3D')).toBe('abc=');
    expect(cursorOfLink('#/scorekarte/5001/1/abc')).toBeNull();
    expect(cursorOfLink(null)).toBeNull();
    expect(historyHash('abc=')).toBe('#/??first=10&after=abc%3D');
  });
});

describe('taking a step', () => {
  it('the next page: golf.de’s own link to it where the pager shows one', () => {
    const other = new Fake('A', '3', { href: historyHash(cursorOf(3)) });
    const next = new Fake('A', '2', { href: historyHash(cursorOf(2)) });
    const place = new FakePlace();
    expect(operate({ do: 'page', cursor: cursorOf(2) }, root(new Fake('X', null, {}, root(other, next))), place)).toBeNull();
    expect([next.clicks, other.clicks]).toEqual([1, 0]);
    expect(place.hash).toBe('');
  });

  it('the next page without such a link: the same address as golf.de’s link', () => {
    const place = new FakePlace();
    operate({ do: 'page', cursor: cursorOf(2) }, root(), place);
    expect(place.hash).toBe(historyHash(cursorOf(2)));
  });

  it('the Scoring Record: its button; without one, a page that changed (and nothing clicked)', () => {
    const button = new Fake('BUTTON', 'Scoring Record');
    expect(operate({ do: 'click', what: 'scoring' }, root(button), new FakePlace())).toBeNull();
    expect(button.clicks).toBe(1);
    expect(operate({ do: 'click', what: 'scoring' }, root(new Fake('BUTTON', 'Drucken')), new FakePlace())).toEqual({ kind: 'changed_page', what: 'GetScoringRecords' });
  });

  it('opens only the History Sheet or a result list', () => {
    const place = new FakePlace();
    operate({ do: 'open', url: HISTORY_SHEET_URL }, root(), place);
    operate({ do: 'open', url: resultsUrl('5001') }, root(), place);
    operate({ do: 'open', url: 'https://evil.test/' }, root(), place);
    operate({ do: 'open', url: 'javascript:alert(1)' }, root(), place);
    expect(place.assigned).toEqual([HISTORY_SHEET_URL, resultsUrl('5001')]);
  });

  it('waiting and the end do nothing', () => {
    const place = new FakePlace();
    expect(operate({ do: 'wait', ms: 10 }, root(), place)).toBeNull();
    expect(operate({ do: 'end' }, root(), place)).toBeNull();
    expect(place).toMatchObject({ hash: '', assigned: [] });
  });
});
