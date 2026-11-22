// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The pairing as a tester met it on 18 Nov: the app opens the pairing page, the portal opens with someone else's
 * account, the player says no, signs out and in with their own in the same portal tab, says yes - and is told
 * when it is done. Made-up Trackman and target; nothing leaves the machine.
 */

import type { BrowserContext, Page } from '@playwright/test';
import { APP_PAGE, pairUrl, PORTAL } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, test } from './fixture.ts';

/** The app opens the pairing page by script (as the target app does), from a click. */
async function openFromApp(context: BrowserContext): Promise<{ app: Page; pairPage: Promise<Page> }> {
  const app = await context.newPage();
  await app.goto(APP_PAGE);
  await app.evaluate((url) => {
    const b = document.createElement('button');
    b.id = 'connect';
    b.textContent = 'Connect Launch Monitor Sync';
    b.onclick = () => window.open(url, '_blank');
    document.body.append(b);
  }, pairUrl());
  const pairPage = context.waitForEvent('page', { predicate: (p) => p.url().includes('/pair') });
  await app.click('#connect');
  return { app, pairPage };
}

test('another account in the portal: no, sign out, sign in with your own in the same tab, yes, done', async ({ context, world, extensionId }) => {
  const windowOpens = connectWindow(context, extensionId);
  const { pairPage } = await openFromApp(context);
  const pair = await pairPage;
  const connect = await windowOpens;
  // Handed over to the extension's tab beside it: the pairing page closes itself (it was opened by the app).
  await expect.poll(() => pair.isClosed(), { timeout: 15_000 }).toBe(true);
  await connect.getByTestId('allow').click();
  await expect(connect.getByTestId('paired')).toBeVisible();

  // The portal opens with someone else's account.
  world.portal.token = world.key('someone-else');
  const portal = await context.newPage();
  await portal.goto(PORTAL);
  await expect(connect.getByTestId('wizard-title')).toHaveText('Is this your Trackman account?');
  await expect.poll(() => world.target.signins.at(-1)).toEqual({ via: 'status', signin: 'confirm' });
  await connect.getByTestId('confirm-no').click();
  await expect(connect.getByTestId('rejected')).toBeVisible();
  await expect.poll(() => world.target.signins.at(-1)).toEqual({ via: 'status', signin: 'none' });

  // The way to another account: Trackman's sign-out, beside the connect window.
  // (Its tab is seen by the made-up sign-out answering it: a tab the extension opens may reach the test late or
  // not at all, and without the `tabs` permission the browser shows the extension no address of it.)
  await connect.getByTestId('switch-account').click();
  await expect.poll(() => world.signOuts).toBeGreaterThan(0);

  // Signed in with their own account in the same portal tab: coming back from the sign-in, the portal stores
  // the new key only seconds after loading (later than the look 3 s after load), with no call the hooks see.
  world.portal.token = world.key();
  world.portal.mode = 'late';
  world.portal.lateMs = 6_000;
  await portal.goto(`${PORTAL}account/callback`);
  await expect(connect.getByTestId('confirm-yes')).toBeVisible({ timeout: 30_000 });

  // "Yes, that's me": the next step at once (the data on its way), then the data, then done - back to the app.
  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', /^(load|done)$/, { timeout: 5_000 });
  await expect(connect.getByTestId('wizard-brought')).toHaveText('2 sessions, 0 rounds fetched', { timeout: 60_000 });
  await expect(connect.getByTestId('last')).toContainText('2 new sessions', { timeout: 60_000 });
  expect(world.target.asked.at(-1)).toMatchObject({ reason: 'connect', client: 'extension', signin: 'ready' });
  await expect(connect.getByTestId('wizard-back-hint')).toHaveText('You can go back to Example App now; the rest comes by itself.');
  await expect(connect.getByTestId('finished')).toHaveCount(0);
  await connect.getByTestId('wizard-back').click();
  await expect.poll(() => connect.isClosed()).toBe(true);
});

test('a pairing page the player opened themselves stays, and says it may be closed', async ({ context, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  await windowOpens;
  // The browser lets a page close itself only when a script opened it; this one says what to do instead. A page
  // the test opened may count as opened by script in some browsers and close itself 1.5 s after the hand-over:
  // that is the page's part done too (checked before, the page could close while the text was awaited).
  await expect
    .poll(
      async () =>
        pairPage.isClosed() ||
        /You can close this page/.test((await pairPage.getByTestId('pair-status').textContent({ timeout: 1000 }).catch(() => '')) ?? ''),
      { timeout: 10_000 },
    )
    .toBe(true);
});
