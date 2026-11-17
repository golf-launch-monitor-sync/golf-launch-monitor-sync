// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { nearOf, openTab, showTab, type TabsApi } from './tabs.ts';

/** A made-up browser: windows with their tabs, which one is in front, and what was asked of it. */
function browser(opts: { windows?: number[]; noWindows?: boolean; gone?: number[] } = {}) {
  const tabs: { id: number; windowId: number; index: number; url: string; active: boolean }[] = [];
  const windows = new Set(opts.windows ?? [1]);
  let focused: number | null = null;
  let next = 100;
  const calls: string[] = [];
  const api: TabsApi = {
    tabs: {
      async create(p) {
        calls.push(`tabs.create ${JSON.stringify(p)}`);
        const windowId = p.windowId ?? [...windows][0];
        if (windowId === undefined || !windows.has(windowId)) throw new Error('No window with id');
        const index = p.index ?? tabs.filter((t) => t.windowId === windowId).length;
        if (p.active) for (const t of tabs) if (t.windowId === windowId) t.active = false;
        const tab = { id: next++, windowId, index, url: p.url, active: p.active };
        tabs.push(tab);
        return tab;
      },
      async update(id, p) {
        calls.push(`tabs.update ${id}`);
        const tab = tabs.find((t) => t.id === id);
        if (!tab || opts.gone?.includes(id)) throw new Error('No tab with id');
        tab.active = p.active;
        return tab;
      },
    },
    ...(opts.noWindows
      ? {}
      : {
          windows: {
            async update(id: number) {
              calls.push(`windows.update ${id}`);
              focused = id;
            },
            async create(p: { url: string }) {
              calls.push('windows.create');
              const id = next++;
              windows.add(id);
              focused = id;
              const tab = { id: next++, windowId: id, index: 0, url: p.url, active: true };
              tabs.push(tab);
              return { tabs: [tab] };
            },
          },
        }),
  };
  return { api, tabs, calls, windows, focused: () => focused };
}

describe('a page the extension opens', () => {
  it('goes right beside the page that asked, in its window, active, and that window comes to the front', async () => {
    // 17 Nov: Chrome in full screen on a Mac; the pairing page is the third tab of window 2.
    const b = browser({ windows: [1, 2] });
    const tab = await openTab(b.api, 'chrome-extension://x/connect.html', { windowId: 2, index: 2 });
    expect(tab).toMatchObject({ windowId: 2, index: 3 });
    expect(b.tabs[0]).toMatchObject({ windowId: 2, index: 3, active: true });
    expect(b.focused()).toBe(2);
    // No popup window of its own.
    expect(b.calls.some((c) => c.startsWith('windows.create'))).toBe(false);
  });

  it('the portal goes beside the connect window, in the connect window’s browser window, which comes to the front', async () => {
    const b = browser({ windows: [1, 2] });
    const connect = await openTab(b.api, 'chrome-extension://x/connect.html', { windowId: 2, index: 0 });
    const portal = await openTab(b.api, 'https://portal.example/', nearOf({ windowId: connect?.windowId as number, index: 1 }));
    expect(portal).toMatchObject({ windowId: 2, index: 2 });
    expect(b.tabs.find((t) => t.url === 'https://portal.example/')?.active).toBe(true);
    expect(b.focused()).toBe(2);
  });

  it('with no page to stand beside, where the browser puts it, still in front', async () => {
    const b = browser();
    const tab = await openTab(b.api, 'https://portal.example/', null);
    expect(tab).toMatchObject({ windowId: 1 });
    expect(b.focused()).toBe(1);
  });

  it('the window it should go to is gone: a tab where the browser puts it; no window at all: a new one', async () => {
    const b = browser({ windows: [1] });
    expect(await openTab(b.api, 'https://portal.example/', { windowId: 9, index: 0 })).toMatchObject({ windowId: 1 });
    const none = browser({ windows: [] });
    const tab = await openTab(none.api, 'https://portal.example/', null);
    expect(none.calls).toContain('windows.create');
    expect(tab?.windowId).toBe(none.focused());
  });

  it('a browser without windows (Firefox for Android) still gets its tab', async () => {
    const b = browser({ noWindows: true });
    expect(await openTab(b.api, 'https://portal.example/', { windowId: 1, index: 0 })).toMatchObject({ windowId: 1, index: 1 });
  });
});

describe('the connect window open already', () => {
  it('is brought to the front, its window too; a closed one says so', async () => {
    const b = browser({ windows: [1, 2] });
    const tab = await openTab(b.api, 'chrome-extension://x/connect.html', { windowId: 2, index: 0 });
    await b.api.windows?.update(1, { focused: true });
    expect(await showTab(b.api, tab?.id as number)).toBe(true);
    expect(b.focused()).toBe(2);
    expect(await showTab(b.api, 999)).toBe(false);
  });
});

describe('where a message came from', () => {
  it('a tab with its window and place, else nothing', () => {
    expect(nearOf({ windowId: 3, index: 4 })).toEqual({ windowId: 3, index: 4 });
    expect(nearOf({ index: 4 })).toBeNull();
    expect(nearOf({ windowId: -1, index: 0 })).toBeNull(); // chrome.windows.WINDOW_ID_NONE
    expect(nearOf(undefined)).toBeNull();
  });
});
