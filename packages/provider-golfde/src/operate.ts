// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Doing a run's step in golf.de's page (clicks.ts): the click the player would make. Only golf.de's own things - a
 * link of its pager, its Scoring Record button, an address its own links have - and golf.de's scripts load what they
 * load. Nothing here asks golf.de anything, adds a header or reads a value; the page script reads along as always.
 *
 * Written against the little of the DOM it needs (`Root`), so it is tested without a browser; the extension's side of
 * the page and the companion app's page script run it on the real one. golf.de's History Sheet is a web component
 * with an open shadow root: what is looked for is looked for there too.
 */

import type { Seen } from './observe.ts';
import { mayOpen, type Step } from './steps.ts';

export { mayOpen, type Step };

/** An element as far as it is needed here. */
export interface El {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  click(): void;
  shadowRoot?: Root | null;
}

export interface Root {
  querySelectorAll(selector: string): ArrayLike<El>;
}

export interface Place {
  /** `location.hash` of the page: assigning it is following a link to the same page. */
  hash: string;
  assign(url: string): void;
}

const MOST = 20_000;

/** Every element of `root` and of the open shadow roots in it (as far as `MOST`). */
export function everything(root: Root): El[] {
  const out: El[] = [];
  const walk = (r: Root, depth: number) => {
    const all = r.querySelectorAll('*');
    for (let i = 0; i < all.length && out.length < MOST; i++) {
      const el = all[i] as El;
      out.push(el);
      if (el.shadowRoot && depth < 8) walk(el.shadowRoot, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

const plain = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** golf.de's way to the Scoring Record: a button or link of that name. */
export function scoringButton(root: Root): El | null {
  const able = (el: El) => /^(BUTTON|A)$/i.test(el.tagName) || /^(button|tab|link)$/.test(el.getAttribute('role') ?? '');
  return everything(root).find((el) => able(el) && /^scoring[\s-]*record$/i.test(plain(el.textContent))) ?? null;
}

/** The cursor a link of the History Sheet's pager goes to (`#/??first=10&after=<cursor>`); null: not such a link. */
export function cursorOfLink(href: string | null): string | null {
  if (!href) return null;
  const at = href.indexOf('#');
  if (at < 0) return null;
  const query = href.slice(at + 1).replace(/^\/\?+/, '');
  for (const part of query.split('&')) {
    const [k, v] = part.split('=');
    if (k === 'after' && v) {
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
  }
  return null;
}

/** The address of the History Sheet's page after `cursor`, as golf.de's pager writes it (ten entries a page). */
export const historyHash = (cursor: string): string => `#/??first=10&after=${encodeURIComponent(cursor)}`;

/**
 * Takes the step in the page. What comes back is something to tell the run (a `changed_page` when golf.de's page
 * hasn't the thing to click), else null: the page's own answer tells the rest.
 */
export function operate(step: Step, root: Root, place: Place): Seen | null {
  switch (step.do) {
    case 'open':
      // Only the pages a run may open; anything else is not taken (it can't come from the run, so nothing to tell).
      if (mayOpen(step.url)) place.assign(step.url);
      return null;
    case 'page': {
      // golf.de's own link to that page where the pager shows one, else the same address as that link.
      const link = everything(root).find((el) => /^A$/i.test(el.tagName) && cursorOfLink(el.getAttribute('href')) === step.cursor);
      if (link) link.click();
      else place.hash = historyHash(step.cursor);
      return null;
    }
    case 'click': {
      const button = scoringButton(root);
      if (!button) return { kind: 'changed_page', what: 'GetScoringRecords' };
      button.click();
      return null;
    }
    default:
      return null;
  }
}
