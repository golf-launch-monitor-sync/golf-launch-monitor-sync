// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The store listings' screenshots, made with the click checks' made-up world (a made-up Trackman account, a made-up
 * app): 1280 × 800 at pixel ratio 1, the size the Chrome Web Store and Edge Add-ons take. Only by hand:
 *
 *   STORE_SCREENSHOTS=1 pnpm e2e apps/extension/e2e/store-screenshots.spec.ts
 *
 * writes apps/extension/store/*.png. Skipped otherwise (CI).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Locator } from '@playwright/test';
import { pairUrl, PORTAL, ROOT } from '../../../tools/e2e/world.ts';
import { allowAndChoose, connectWindow, expect, popup, test } from './fixture.ts';

const OUT = join(ROOT, 'apps', 'extension', 'store');

/** One shot: the extension's own page as it looks, framed with a caption on a 1280 × 800 canvas. */
async function frame(context: BrowserContext, what: Locator, caption: string, file: string) {
  const png = (await what.screenshot({ animations: 'disabled' })).toString('base64');
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1280px;height:800px;display:flex;flex-direction:column;
    align-items:center;justify-content:center;gap:28px;background:#eef3ef;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">
    <div style="font-size:30px;font-weight:600;color:#1d3326;max-width:1000px;text-align:center">${caption}</div>
    <img src="data:image/png;base64,${png}" style="max-height:640px;max-width:1100px;border-radius:12px;
      box-shadow:0 12px 40px rgba(0,0,0,.18);background:#fff"/></body></html>`);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, file), clip: { x: 0, y: 0, width: 1280, height: 800 } });
  await page.close();
}

test.skip(!process.env.STORE_SCREENSHOTS, 'by hand only: STORE_SCREENSHOTS=1');

test('store screenshots', async ({ context, world, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.setViewportSize({ width: 560, height: 760 });
  await expect(connect.getByTestId('allow')).toBeVisible();
  await frame(context, connect.locator('main'), 'Your app asks for your launch monitor data – you decide', '1-connect.png');

  await allowAndChoose(connect);
  world.portal.token = world.key();
  await (await context.newPage()).goto(PORTAL);
  await expect(connect.getByTestId('confirm')).toContainText('Alex Example');
  await frame(context, connect.locator('main'), 'Only your own account, and only after you confirm it', '2-confirm.png');

  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('new sessions', { timeout: 60_000 });
  await frame(context, connect.locator('main'), 'Synced into your app – in the background, within a fixed load limit', '3-synced.png');

  const pop = await popup(context, extensionId);
  await pop.setViewportSize({ width: 400, height: 640 });
  await expect(pop.getByTestId('connection')).toContainText('Example App');
  await frame(context, pop.locator('body'), 'Everything at a glance in the toolbar', '4-popup.png');
});
