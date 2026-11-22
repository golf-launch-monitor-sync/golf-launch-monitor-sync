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

/**
 * The popup, opened as a page: its main view, the list of connections - or, with `open`, the details of a connection
 * (`lm` the launch monitor's, `hcp` golf.de's), opened by its row.
 */
export async function popup(context: BrowserContext, extensionId: string, open?: 'lm' | 'hcp'): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  if (open) await page.locator(`[data-test="connection"][data-id="${open}"]`).click();
  return page;
}

/** *Connect new*'s first two steps in the connect window: allow the app, then the service the offer asks for. */
export async function allowAndChoose(connect: Page, service = 'trackman'): Promise<void> {
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'pair');
  await connect.getByTestId('allow').click();
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await connect.getByTestId(`service-${service}`).click();
  await expect(connect.getByTestId('wizard').first()).not.toHaveAttribute('data-step', /^(pair|service)$/);
}

/** The toolbar icon's badge. */
export async function badgeText(background: Worker): Promise<string> {
  return background.evaluate(() => chrome.action.getBadgeText({}));
}

/** The connect window, which the background opens by itself. */
export async function connectWindow(context: BrowserContext, extensionId: string): Promise<Page> {
  const url = `chrome-extension://${extensionId}/connect.html`;
  // `connect.html?new=1` when *Connect new* opened it.
  const is = (p: Page) => p.url() === url || p.url().startsWith(`${url}?`);
  const open = context.pages().find(is);
  if (open) return open;
  return context.waitForEvent('page', { predicate: is });
}
