// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The web app without the extension: the pairing page, syncing by hand, the file, the bookmark - with
 * a made-up Trackman and a made-up target app.
 */

import { expect, test as base } from '@playwright/test';
import { CODE, HCP_CODE, HCP_TARGET, pairUrl, PORTAL, WEB, World } from '../../../tools/e2e/world.ts';

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
  // *Connect new* by hand: (1) allow the app, (2) what to connect - only then it pairs.
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pair');
  await expect(page.getByTestId('wizard-title')).toHaveText('Connect with app.example.org?');
  await page.getByTestId('allow').click();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  expect(world.target.tokens.size).toBe(0);
  await page.getByTestId('service-trackman').click();
  await expect(page).toHaveURL(`${WEB}/app.html`);
  // (3) the Trackman key (the bookmark, pasted), in the step itself.
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(page.getByTestId('wizard-progress')).toHaveText('Step 3 of 6');
  await expect(page.getByTestId('unconfirmed')).toHaveText('Not yet connected with Example App – sign in at Trackman');
  await expect(page.getByTestId('wizard').getByTestId('paste')).toBeVisible();
  expect(page.url()).not.toContain(CODE);

  // The key, pasted: first something that isn't one, then the real one; "Is this you?" before anything.
  await page.getByTestId('paste').fill('not a key');
  await page.getByTestId('use-key').click();
  await expect(page.getByTestId('key-message')).toHaveText('That isn’t a Trackman key.');
  const key = world.key();
  await page.getByTestId('paste').fill(key);
  await page.getByTestId('use-key').click();
  await expect(page.getByTestId('confirm')).toContainText('Alex Example');
  await expect(page.getByTestId('confirm')).toContainText('Newest activity on 15 Nov 2026');
  // Only the account and yes or no: the title asks; no line above it, no key box, no test code, no file.
  await expect(page.getByTestId('unconfirmed')).toHaveCount(0);
  await expect(page.getByTestId('wizard').locator('button')).toHaveText(['Yes, that’s me', 'No']);
  await expect(page.getByTestId('fetch-now')).toHaveCount(0);
  await expect(page.getByTestId('paste')).toHaveCount(0);
  await expect(page.getByTestId('test-enter')).toHaveCount(0);
  await expect(page.locator('#file')).toBeHidden();
  // The yes: the first sync right away, shown plainly; then done, and the overview below.
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('wizard-brought')).toHaveText('2 sessions, 0 rounds fetched', { timeout: 60_000 });
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'done');
  await expect(page.getByTestId('wizard-back-hint')).toHaveText('You can go back to Example App now. The rest comes while this page stays open.');
  await expect(page.getByTestId('last')).toContainText('2 new sessions, 4 shots', { timeout: 60_000 });
  expect(world.targetSaw()).not.toContain(key);
  // While the page is open the older history may follow on its own (backfill); the first was "connect" from "web".
  expect(world.target.asked.filter((a) => a.reason !== 'backfill').map((a) => [a.reason, a.client])).toEqual([['connect', 'web']]);

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

  // After a reload everything is still there (this browser's storage), and the steps are behind it: the list, with the
  // account's name and where it stands; its row opens the overview.
  await page.reload();
  const row = page.getByTestId('connection');
  await expect(row).toContainText('Trackman · Alex Example');
  await expect(page.getByTestId('connection-state')).toHaveText(/^(Running|Loading the history)$/);
  await row.click();
  await expect(page.getByTestId('key-ready')).toBeVisible();
  await expect(page.getByTestId('wizard')).toHaveCount(0);
  await expect(page.getByTestId('pairing')).toContainText('Connected with Example App');
});

test('connecting’s steps in German; a first sync that fails stays on its step and offers to try again', async ({ browser, world }) => {
  const context = await browser.newContext({ locale: 'de-DE' });
  await world.route(context);
  const page = await context.newPage();
  await page.goto(pairUrl());
  await page.getByTestId('allow').click();
  await expect(page.getByTestId('wizard-title')).toHaveText('Was möchtest du verbinden?');
  await page.getByTestId('service-trackman').click();
  await expect(page.getByTestId('wizard-progress')).toHaveText('Schritt 3 von 6');
  await expect(page.getByTestId('unconfirmed')).toHaveText('Noch nicht mit Example App verbunden – bei Trackman anmelden');
  await page.getByTestId('paste').fill(world.key());
  await page.getByTestId('use-key').click();
  await expect(page.getByTestId('wizard-title')).toHaveText('Ist das dein Trackman-Konto?');
  await expect(page.getByTestId('unconfirmed')).toHaveCount(0);
  await expect(page.getByTestId('confirm')).toContainText('Neueste Aktivität am 15. Nov. 2026');

  // The app is down for a moment: the first sync fails, the step says why and offers *Fetch now*.
  const opts = world.target.opts as { fail?: Record<string, { status: number }> };
  opts.fail = { '/import': { status: 503 } };
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('wizard-failed')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'load');
  await expect(page.getByTestId('unconfirmed')).toHaveCount(0);
  // Failed is not done: no way back offered yet.
  await expect(page.getByTestId('wizard-title')).toHaveText('Deine Daten werden geholt …');
  await expect(page.getByTestId('wizard-back-hint')).toHaveCount(0);
  delete opts.fail;
  // Fetching again, held at the app's import: the step says the player is done here and may go back (LMS-AS-4).
  let release = () => {};
  world.target.opts.hold = { '/import': new Promise<void>((done) => (release = done)) };
  await page.getByTestId('fetch-now').click();
  await expect(page.getByTestId('wizard-title')).toHaveText('Fertig – deine Daten werden geholt …', { timeout: 30_000 });
  await expect(page.getByTestId('wizard-back-hint')).toHaveText('Du kannst jetzt zurück zu Example App. Der Rest kommt, solange diese Seite offen ist.');
  await expect(page.getByTestId('wizard-failed')).toHaveCount(0);
  release();
  delete world.target.opts.hold;
  await expect(page.getByTestId('wizard-brought')).toHaveText('2 Sessions, 0 Runden geholt', { timeout: 60_000 });
  await expect(page.getByTestId('wizard-title')).toHaveText('Fertig');
  await context.close();
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
    await expect(page.getByTestId('allow')).toBeVisible();
  });
});

test('the handicap record (kind=hcp) needs the extension: no way by hand', async ({ page, world }) => {
  await page.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  await expect(page.getByTestId('pair-status')).toHaveText(/needs the browser extension/, { timeout: 5000 });
  await expect(page.getByTestId('install')).toBeVisible();
  await expect(page.getByTestId('allow')).toHaveCount(0);
  expect(world.hcp.received).toHaveLength(0);
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
  await page.getByTestId('allow').click();
  await page.getByTestId('service-trackman').click();
  await expect(page.getByTestId('offer-error')).toHaveText('That didn’t work: The code has run out or was used already. Start again in your app.');
  // Back at the first step: the same code can't be tried again.
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'pair');
  await expect(page.getByTestId('offer-start')).toBeVisible();
  expect(page.url()).not.toContain('EXPIRED1');
});

test('the main view: *Connect new* says to start in the app; back to the list', async ({ page }) => {
  await page.goto(`${WEB}/app.html`);
  await expect(page.getByTestId('connections-none')).toHaveText('Nothing connected yet.');
  await expect(page.getByTestId('paste')).toBeHidden();
  await page.getByTestId('connect-new').click();
  await expect(page.getByTestId('wizard-title')).toHaveText('Start in your app');
  await expect(page.getByTestId('wizard-progress')).toHaveText('Step 1 of 6');
  await expect(page.getByTestId('connections')).toBeHidden();
  await page.locator('#new').getByTestId('connections-back').click();
  await expect(page.getByTestId('connect-new')).toBeVisible();
});

test('the bookmark copies the key the portal keeps, or the one its next call carries', async ({ page, world }) => {
  // The bookmark is where the sign-in is: connecting's step 3.
  await page.goto(pairUrl());
  await page.getByTestId('allow').click();
  await page.getByTestId('service-trackman').click();
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
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
    await expect(page.getByTestId('allow')).toHaveText('Diese Seite mit app.example.org verbinden');
  });
});
