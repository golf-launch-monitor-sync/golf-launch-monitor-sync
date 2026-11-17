// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Where the extension opens its pages: as a tab right beside the page that led there, in that browser
 * window, in front - the connect window beside the pairing page (or the portal), the portal beside the
 * connect window. A popup window of its own went full screen on a Mac with Chrome in full screen, and
 * the portal then opened as a tab in the first window without coming to the front: it looked as if
 * nothing happened. Only with no page to stand beside (the toolbar popup asked) does a tab go where the
 * browser puts it, and with no window open at all a new one is made.
 *
 * Takes the browser's API as an argument, so it is tested without a browser (tabs.test.ts).
 */

/** The tab a page was asked from: its window and its place in it. */
export interface Near {
  windowId: number;
  index: number;
}

export interface TabsApi {
  tabs: {
    create(props: { url: string; active: boolean; windowId?: number; index?: number }): Promise<{ id?: number; windowId?: number }>;
    update(id: number, props: { active: boolean }): Promise<{ id?: number; windowId?: number } | undefined>;
  };
  /** Missing where the browser has no windows (Firefox for Android). */
  windows?: {
    update(id: number, props: { focused: boolean }): Promise<unknown>;
    create(props: { url: string; type: 'normal'; focused: boolean }): Promise<{ tabs?: { id?: number; windowId?: number }[] } | undefined>;
  };
}

/** The place of the tab a message came from, if it came from one. */
export function nearOf(tab: { windowId?: number; index?: number } | undefined | null): Near | null {
  return tab && typeof tab.windowId === 'number' && typeof tab.index === 'number' && tab.windowId >= 0 ? { windowId: tab.windowId, index: tab.index } : null;
}

async function front(api: TabsApi, windowId: number | undefined): Promise<void> {
  if (windowId === undefined || !api.windows) return;
  await api.windows.update(windowId, { focused: true }).catch(() => undefined);
}

/** A tab with `url`, beside `near` when there is one, active, and its window brought to the front. */
export async function openTab(api: TabsApi, url: string, near: Near | null): Promise<{ id?: number; windowId?: number } | undefined> {
  try {
    const tab = await api.tabs.create({ url, active: true, ...(near ? { windowId: near.windowId, index: near.index + 1 } : {}) });
    await front(api, tab.windowId ?? near?.windowId);
    return tab;
  } catch {
    // The window it should go to is gone, or there is no ordinary window (a Mac keeps Chrome running without one).
    if (near) {
      try {
        const tab = await api.tabs.create({ url, active: true });
        await front(api, tab.windowId);
        return tab;
      } catch {
        // no window at all: one is made below
      }
    }
    if (!api.windows) return undefined;
    const w = await api.windows.create({ url, type: 'normal', focused: true });
    return w?.tabs?.[0];
  }
}

/** The tab `id` brought to the front (true), or false when it is gone. */
export async function showTab(api: TabsApi, id: number): Promise<boolean> {
  try {
    const tab = await api.tabs.update(id, { active: true });
    if (!tab) return false;
    await front(api, tab.windowId);
    return true;
  } catch {
    return false;
  }
}
