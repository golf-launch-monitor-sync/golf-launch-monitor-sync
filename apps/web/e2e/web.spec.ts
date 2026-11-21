// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The web app without the extension: the pairing page, syncing by hand, the file, the bookmark - with
 * a made-up Trackman and a made-up target app.
 */

import { expect, test as base } from '@playwright/test';
import { CODE, pairUrl, PORTAL, WEB, World } from '../../../tools/e2e/world.ts';

const test = base.extend<{ world: World }>({
  // Every test runs in the made-up world: nothing may reach a network.
  world: [
    async ({ context }, use) => {
      const world = new World();
      await world.route(context);
      await use(world);
    },
    { auto: true },
  ],
});

test('pairs this page when there is no extension, then fetches by hand', async ({ page, world }) => {
  await page.goto(pairUrl());
  await expect(page.getByTestId('pair-status')).toHaveText('The browser extension isn’t installed in this browser.');
  await expect(page.getByTestId('install')).toHaveAttribute('href', /apps\/extension\/README\.md#install$/);
  await expect(page.locator('#install')).toContainText('Not in the browser stores yet');
  await expect(page.getByTestId('waiting')).toHaveText(/leave this page open: it connects by itself/);
  await expect(page.locator('main')).not.toContainText('null');
  await page.getByTestId('use-web').click();
  await expect(page).toHaveURL(`${WEB}/app.html`);
  await expect(page.getByTestId('pairing')).toContainText('Connected with Example App');
  expect(page.url()).not.toContain(CODE);

  // The key, pasted: first something that isn't one, then the real one; "Is this you?" before anything.
  await page.getByTestId('paste').fill('not a key');
  await page.getByTestId('use-key').click();
  await expect(page.getByTestId('key-message')).toHaveText('That isn’t a Trackman key.');
  const key = world.key();
  await page.getByTestId('paste').fill(key);
  await page.getByTestId('use-key').click();
  await expect(page.getByTestId('confirm')).toContainText('Alex Example');
  await expect(page.getByTestId('fetch-now')).toBeDisabled();
  await page.getByTestId('confirm-yes').click();
  await page.getByTestId('fetch-now').click();
  await expect(page.getByTestId('last')).toContainText('2 new sessions, 4 shots', { timeout: 60_000 });
  expect(world.targetSaw()).not.toContain(key);
  // While the page is open the older history may follow on its own (backfill); by hand it was "manual" from "web".
  expect(world.target.asked.filter((a) => a.reason !== 'backfill').map((a) => [a.reason, a.client])).toEqual([['manual', 'web']]);

  // A file of what is new; the next one has nothing new, so none is saved.
  const download = page.waitForEvent('download');
  await page.getByTestId('file-manual').click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^olmd-trackman-\d{8}-\d{6}\.json$/);
  const text = Buffer.concat(await (await file.createReadStream()).toArray()).toString('utf8');
  expect(JSON.parse(text)).toMatchObject({ format: 'olmd/1', provider: 'trackman', sessions: [{}, {}] });
  expect(text).not.toContain(key);
  await expect(page.getByTestId('file-message')).toContainText('Saved: 2 new sessions');
  await page.getByTestId('file-manual').click();
  await expect(page.getByTestId('file-message')).toHaveText('Nothing new for a file.', { timeout: 60_000 });

  // After a reload everything is still there (this browser's storage).
  await page.reload();
  await expect(page.getByTestId('key-ready')).toBeVisible();
  await expect(page.getByTestId('pairing')).toContainText('Connected with Example App');
});

test('waits for the extension: installed while the page is open, it takes over; after five minutes it stops', async ({ page }) => {
  await page.clock.install();
  await page.goto(pairUrl());
  await page.clock.runFor(2_000);
  await expect(page.getByTestId('waiting')).toBeVisible();
  // Four minutes later the extension arrives (it marks the page, as it does one open when it is installed).
  await page.clock.runFor(4 * 60_000);
  await page.evaluate(() => document.documentElement.setAttribute('data-glmsync-extension', '0.1.0'));
  await page.clock.runFor(2_000);
  await expect(page.getByTestId('pair-status')).toHaveText(/The extension takes over/);
  await expect(page.locator('#install')).toBeHidden();

  // Without it: after five minutes the page stops looking and says to reload. (A fresh load: the same address
  // again would only move to its fragment.)
  await page.goto('about:blank');
  await page.goto(pairUrl());
  await page.clock.runFor(5 * 60_000 + 2_000);
  await expect(page.getByTestId('waiting')).toHaveText('This page stopped waiting. Installed it meanwhile? Reload this page.');
  await page.evaluate(() => document.documentElement.setAttribute('data-glmsync-extension', '0.1.0'));
  await page.clock.runFor(10_000);
  await expect(page.getByTestId('pair-status')).toHaveText('The browser extension isn’t installed in this browser.');
});

test.describe('in Safari', () => {
  test.use({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15',
  });

  test('offers no extension, only this page by hand', async ({ page }) => {
    await page.goto(pairUrl());
    await expect(page.getByTestId('pair-status')).toHaveText(/This browser can’t run the extension \(Safari/);
    await expect(page.getByTestId('install')).toHaveCount(0);
    await expect(page.getByTestId('use-web')).toBeVisible();
  });
});

test('says so when the link is no pairing link', async ({ page }) => {
  await page.goto(`${WEB}/pair#target=javascript%3Aalert(1)&code=${CODE}`);
  await expect(page.getByTestId('pair-status')).toHaveText(/without a valid connection link/);
  expect(page.url()).not.toContain('javascript');
  await page.goto(`${WEB}/pair`);
  await expect(page.getByTestId('pair-status')).toHaveText(/without a valid connection link/);
});

test('a code that ran out: says so, and offers to start again', async ({ page }) => {
  await page.goto(pairUrl(undefined, 'EXPIRED1'));
  await page.getByTestId('use-web').click();
  await expect(page.getByTestId('pair-status')).toHaveText('That didn’t work: The code has run out or was used already. Start again in your app.');
});

test('the bookmark copies the key the portal keeps, or the one its next call carries', async ({ page, world }) => {
  await page.goto(`${WEB}/app.html`);
  const href = (await page.getByTestId('bookmarklet').getAttribute('href')) as string;
  expect(href.startsWith('javascript:')).toBe(true);
  const code = decodeURIComponent(href.slice('javascript:'.length));

  const key = world.key();
  world.portal.token = key;
  await page.goto(PORTAL);
  await page.evaluate(code);
  await expect(page.locator('#glmsync-key-box')).toContainText('Trackman key found');
  await expect(page.locator('#glmsync-key-box textarea')).toHaveValue(key);

  world.portal.mode = 'fetch';
  await page.goto(PORTAL);
  await page.evaluate(code);
  await expect(page.locator('#glmsync-key-box')).toContainText('Waiting for Trackman');
  await page.evaluate((k) => fetch('https://api.trackmangolf.com/graphql', { method: 'POST', headers: { Authorization: `Bearer ${k}` }, body: '{}' }), key);
  await expect(page.locator('#glmsync-key-box textarea')).toHaveValue(key);

  // Elsewhere it only says where it works.
  await page.goto(`${WEB}/`);
  await page.evaluate(code);
  await expect(page.locator('#glmsync-key-box')).toContainText('portal.trackmangolf.com');
});

test.describe('in German', () => {
  test.use({ locale: 'de-DE' });

  test('the pairing page speaks the browser’s language', async ({ page }) => {
    await page.goto(pairUrl());
    await expect(page.getByTestId('pair-status')).toHaveText('Die Browser-Erweiterung ist in diesem Browser nicht installiert.');
    await expect(page.getByTestId('use-web')).toHaveText('Diese Seite mit app.example.org verbinden');
  });
});
