// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** Chromium with the extension's test build loaded, and the made-up world routed in. */

import { chromium, test as base, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { join } from 'node:path';
import { ROOT, World } from '../../../tools/e2e/world.ts';

const EXTENSION = join(ROOT, 'apps', 'extension', 'dist-e2e', 'chrome');

export const test = base.extend<{ world: World; context: BrowserContext; background: Worker; extensionId: string }>({
  world: async ({}, use) => {
    await use(new World());
  },
  context: async ({ world, locale }, use) => {
    const context = await chromium.launchPersistentContext('', {
      // Extensions need the full Chromium (the headless shell has none).
      ...(process.env.GLMSYNC_CHROMIUM ? { executablePath: process.env.GLMSYNC_CHROMIUM } : { channel: 'chromium' }),
      headless: true,
      ...(locale ? { locale } : {}),
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`, ...(locale ? [`--lang=${locale}`] : [])],
    });
    await world.route(context);
    await use(context);
    await context.close();
  },
  background: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    sw ??= await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host);
  },
});

export const expect = test.expect;

/** The popup, opened as a page. */
export async function popup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

/** The toolbar icon's badge. */
export async function badgeText(background: Worker): Promise<string> {
  return background.evaluate(() => chrome.action.getBadgeText({}));
}

/** The connect window, which the background opens by itself. */
export async function connectWindow(context: BrowserContext, extensionId: string): Promise<Page> {
  const url = `chrome-extension://${extensionId}/connect.html`;
  const open = context.pages().find((p) => p.url() === url);
  if (open) return open;
  return context.waitForEvent('page', { predicate: (p) => p.url() === url });
}
