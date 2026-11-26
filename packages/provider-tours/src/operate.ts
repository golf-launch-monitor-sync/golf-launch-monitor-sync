// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Doing a pick of *Fetch all* (`run.ts`) in the tour's page: what the player does with the page's own pickers. Only the
 * page's own things - a `<select>` set to one of its own options, or a picker the page draws itself (pgatour.com's
 * *Season* and *Tour* menus, lpga.com's *Seasons* box) opened and one of its own entries chosen - and the page's own
 * scripts load what they load. Nothing here asks the site anything or reads a value it then sends; the page's script
 * reads along afterwards as on any page.
 *
 * Written against the little of the DOM it needs (`OpRoot`, `OpEl`), so it is tested without a browser; how an event is
 * made and a value set is handed in (`OpEnv`): in a browser, real pointer and mouse events and the element's own setter.
 */

import { clean, textOf, type DomNode } from './snapshot.ts';

/** An element as far as it is needed here. */
export interface OpEl {
  tagName: string;
  textContent: string | null;
  /** Where there are any (every browser's element): its text is read with a space at each element's edge. */
  nodeType?: number;
  childNodes?: ArrayLike<DomNode>;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<OpEl>;
}

/** A `<select>` as far as it is needed here. */
export interface OpSelect extends OpEl {
  value: string;
  options: ArrayLike<{ text: string; value: string; selected: boolean }>;
}

export interface OpRoot {
  querySelectorAll(selector: string): ArrayLike<OpEl>;
}

export interface OpEnv {
  /** A person's press on an element: pointer down and up, then the click. */
  press(el: OpEl): void;
  /** A `<select>` set to an option's value as the browser does it, then its `input` and `change`. */
  choose(select: OpSelect, value: string): void;
  /** *Escape*, to close a picker opened for nothing. */
  escape(el: OpEl): void;
  sleep(ms: number): Promise<void>;
}

export type PickResult = 'picked' | 'already' | 'absent' | 'missing';

export interface Pick {
  picker: string | null;
  value: string;
}

const MOST = 20_000;
/** How long a drawn picker may take to show its entries. */
const OPEN_WAIT_MS = 3000;
const OPEN_POLL_MS = 150;

const each = <T>(list: ArrayLike<T>, most = MOST): T[] => Array.from(list).slice(0, most);
/** An element's text as a person reads it: `textContent` runs "Season" and "2026" together, `textOf` doesn't. */
const textIn = (el: OpEl): string => clean(el.childNodes && el.nodeType === 1 ? textOf(el as unknown as DomNode) : el.textContent);
const same = (a: string, b: string): boolean => clean(a).toLowerCase() === clean(b).toLowerCase();
const isSelect = (el: OpEl): el is OpSelect => el.tagName.toLowerCase() === 'select';

/** The page's `<select>` that offers `value`, and that option. */
function selectOffering(root: OpRoot, value: string): { select: OpSelect; option: { text: string; value: string; selected: boolean } } | null {
  for (const el of each(root.querySelectorAll('select'), 50)) {
    if (!isSelect(el)) continue;
    const option = each(el.options, 200).find((o) => same(o.text ?? '', value));
    if (option) return { select: el, option };
  }
  return null;
}

/**
 * A picker the page draws: a button, combobox or menu button whose text is its label and the value it shows ("Season
 * 2026", "Seasons 2026", "Tour PGA Tour") - never a button that is only the label (pgatour.com's tab *Season* is one).
 */
export function triggerOf(root: OpRoot, label: string): { el: OpEl; shows: string } | null {
  const want = clean(label).toLowerCase();
  const all = each(root.querySelectorAll('button, [role="combobox"], [aria-haspopup]'), 2000);
  const hits = all
    .map((el) => ({ el, text: textIn(el).slice(0, 200) }))
    .filter(({ text }) => text.toLowerCase().startsWith(`${want} `));
  // A picker marked as one (aria) before a plain button with such a text.
  const marked = hits.find(({ el }) => el.getAttribute('aria-haspopup') !== null || el.getAttribute('role') === 'combobox');
  const hit = marked ?? hits[0];
  return hit ? { el: hit.el, shows: hit.text.slice(want.length).trim() } : null;
}

/** The entry `value` of the picker opened now: in its menu or list box, the entry itself or the innermost that says it. */
export function entryOf(root: OpRoot, value: string): OpEl | null {
  for (const box of each(root.querySelectorAll('[role="menu"], [role="listbox"]'), 20)) {
    const items = each(box.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"]'), 500);
    const item = items.find((el) => same(textIn(el), value));
    if (item) return item;
    // A list whose entries carry no role: the innermost element whose whole text is the value.
    const plain = each(box.querySelectorAll('*'), 2000).filter((el) => same(textIn(el), value));
    const inner = plain.find((el) => !plain.some((o) => o !== el && contains(el, o)));
    if (inner) return inner;
  }
  return null;
}

function contains(outer: OpEl, inner: OpEl): boolean {
  return each(outer.querySelectorAll('*'), 2000).includes(inner);
}

/** Whether the page shows `value` in the picker now (after a pick, before its table is read). */
export function shows(root: OpRoot, pick: Pick): boolean {
  if (pick.picker === null) {
    const hit = selectOffering(root, pick.value);
    return !!hit && hit.option.selected;
  }
  const trigger = triggerOf(root, pick.picker);
  return !!trigger && same(trigger.shows, pick.value);
}

/**
 * Picks `value` in the page's picker. `already` when it shows it; `absent` when the picker doesn't offer it (a season he
 * didn't play); `missing` when the page has no such picker at all (the page looks different).
 */
export async function pick(root: OpRoot, p: Pick, env: OpEnv): Promise<PickResult> {
  if (p.picker === null) {
    const hit = selectOffering(root, p.value);
    if (!hit) return each(root.querySelectorAll('select'), 1).length > 0 ? 'absent' : 'missing';
    if (hit.option.selected) return 'already';
    env.choose(hit.select, hit.option.value);
    return 'picked';
  }
  const trigger = triggerOf(root, p.picker);
  if (!trigger) return 'missing';
  if (same(trigger.shows, p.value)) return 'already';
  env.press(trigger.el);
  for (let waited = 0; waited <= OPEN_WAIT_MS; waited += OPEN_POLL_MS) {
    const entry = entryOf(root, p.value);
    if (entry) {
      env.press(entry);
      return 'picked';
    }
    await env.sleep(OPEN_POLL_MS);
  }
  // Opened, but no such entry: closed again, as a person would.
  env.escape(trigger.el);
  return 'absent';
}
