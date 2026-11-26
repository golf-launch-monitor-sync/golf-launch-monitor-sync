// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { entryOf, pick, shows, triggerOf, type OpEl, type OpEnv, type OpRoot, type OpSelect } from './operate.ts';

// A tiny page: elements with a text, attributes and children; `select`s with options. `textContent` runs the texts of
// the children together, as a browser's does ("Season" and "2026": "Season2026").
class Text {
  nodeType = 3;
  constructor(public textContent: string) {}
}
class Node implements OpEl {
  parent: Node | null = null;
  nodeType = 1;
  constructor(public tagName: string, public attrs: Record<string, string> = {}, public kids: Node[] = [], public own = '') {
    for (const k of kids) k.parent = this;
  }
  get childNodes(): (Node | Text)[] {
    return [...(this.own ? [new Text(this.own)] : []), ...this.kids];
  }
  get textContent(): string {
    return [this.own, ...this.kids.map((k) => k.textContent)].join('');
  }
  getAttribute(n: string): string | null {
    return this.attrs[n] ?? null;
  }
  all(): Node[] {
    return this.kids.flatMap((k) => [k, ...k.all()]);
  }
  querySelectorAll(sel: string): Node[] {
    return this.all().filter((n) => sel.split(',').some((one) => matches(n, one.trim())));
  }
}
function matches(n: Node, sel: string): boolean {
  if (sel === '*') return true;
  const attr = /^\[([a-z-]+)(?:="([^"]+)")?\]$/.exec(sel);
  if (attr?.[1]) return attr[2] === undefined ? n.getAttribute(attr[1]) !== null : n.getAttribute(attr[1]) === attr[2];
  return n.tagName === sel;
}
class Select extends Node implements OpSelect {
  constructor(public opts: { text: string; value: string; selected: boolean }[]) {
    super('select');
  }
  get options() {
    return this.opts;
  }
  get value(): string {
    return this.opts.find((o) => o.selected)?.value ?? '';
  }
  set value(v: string) {
    for (const o of this.opts) o.selected = o.value === v;
  }
}
const el = (tag: string, attrs: Record<string, string> = {}, kids: Node[] = [], own = '') => new Node(tag, attrs, kids, own);
const txt = (s: string) => el('span', {}, [], s);

/** A page whose drawn picker shows its menu once its trigger was pressed. */
function drawnPage(label: string, shown: string, entries: string[], role: 'menu' | 'listbox' = 'menu') {
  const menu = role === 'menu'
    ? el('div', { role: 'menu' }, entries.map((e) => el('button', { role: 'menuitem' }, [], e)))
    : el('div', { role: 'listbox' }, [el('div', { role: 'group' }, entries.map((e) => el('div', { 'aria-label': e }, [el('div', {}, [], e)])))]);
  const trigger = role === 'menu'
    ? el('button', { 'aria-haspopup': 'menu' }, [el('p', {}, [], label), el('p', {}, [], shown)])
    : el('div', { role: 'combobox' }, [el('p', {}, [], label), txt(shown)]);
  const root = el('body', {}, [el('button', {}, [], label), trigger]);
  return { root, trigger, menu };
}

function env(onPress: (n: OpEl) => void = () => undefined) {
  const pressed: OpEl[] = [];
  const e: OpEnv & { pressed: OpEl[]; escaped: number; chosen: string[] } = {
    pressed,
    escaped: 0,
    chosen: [],
    press: (n) => {
      pressed.push(n);
      onPress(n);
    },
    choose: (s, v) => {
      s.value = v;
      e.chosen.push(v);
    },
    escape: () => {
      e.escaped += 1;
    },
    sleep: async () => undefined,
  };
  return e;
}

describe('a pick done in the page', () => {
  it('sets the page\'s own select to the option it offers (europeantour.com\'s seasons, the Alps Tour\'s reports)', async () => {
    const select = new Select([{ text: '2026', value: 'a', selected: true }, { text: '2025', value: 'b', selected: false }]);
    const root: OpRoot = el('body', {}, [select]);
    const e = env();
    expect(await pick(root, { picker: null, value: '2025' }, e)).toBe('picked');
    expect(e.chosen).toEqual(['b']);
    expect(shows(root, { picker: null, value: '2025' })).toBe(true);
    expect(await pick(root, { picker: null, value: '2025' }, e)).toBe('already');
    expect(await pick(root, { picker: null, value: '2019' }, e)).toBe('absent');
    expect(await pick(el('body'), { picker: null, value: '2019' }, e)).toBe('missing');
  });

  it('opens a drawn menu by its label and picks the entry (pgatour.com), never the tab that is only the label', async () => {
    const page = drawnPage('Season', '2026', ['2026', '2025', '2024']);
    const e = env((n) => {
      if (n === page.trigger) page.root.kids.push(page.menu);
    });
    expect(triggerOf(page.root, 'Season')?.el).toBe(page.trigger);
    expect(triggerOf(page.root, 'Season')?.shows).toBe('2026');
    expect(await pick(page.root, { picker: 'Season', value: '2026' }, e)).toBe('already');
    expect(await pick(page.root, { picker: 'Season', value: '2025' }, e)).toBe('picked');
    expect(e.pressed[0]).toBe(page.trigger);
    expect(e.pressed[1]?.textContent).toBe('2025');
    expect(page.trigger.textContent).toBe('Season2026');
  });

  it('picks in a list box whose entries carry no role (lpga.com): the innermost element saying the value', async () => {
    const page = drawnPage('Seasons', '2026', ['2026', '2025'], 'listbox');
    page.root.kids.push(page.menu);
    const hit = entryOf(page.root, '2025');
    expect(hit?.textContent).toBe('2025');
    expect(hit?.getAttribute('aria-label')).toBeNull();
    expect(await pick(page.root, { picker: 'Seasons', value: '2025' }, env())).toBe('picked');
  });

  it('an entry the picker doesn\'t offer: closed again, absent; no picker at all: missing', async () => {
    const page = drawnPage('Season', '2026', ['2026']);
    const e = env((n) => {
      if (n === page.trigger) page.root.kids.push(page.menu);
    });
    expect(await pick(page.root, { picker: 'Season', value: '2023' }, e)).toBe('absent');
    expect(e.escaped).toBe(1);
    expect(await pick(page.root, { picker: 'Tour', value: 'PGA Tour' }, e)).toBe('missing');
  });
});
