// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode in the web app (spec/test-mode.md): the connected app's test code in connecting's step 3, small under the
 * sign-in, instead of it - then step 4, *Is this your account?* about its made-up account with nothing else on it,
 * then the data as from Trackman (the first sync, then the older history in chunks while the page is open, `test: true`
 * on every batch, Trackman never asked), and nowhere a Trackman sign-in for it. A wrong, an expired code stay on step 3
 * with their sentence; an app without a test account says so. All synthetic.
 */

import { expect, test as base, type Page } from '@playwright/test';
import { accountRefOf } from '../../../packages/core/src/sha256.ts';
import { pairUrl, TEST_CODE, TEST_SUBJECT, WEB, World } from '../../../tools/e2e/world.ts';

const test = base.extend<{ world: World }>({
  world: [
    async ({ context }, use) => {
      const world = new World();
      await world.route(context);
      await use(world);
    },
    { auto: true },
  ],
});

async function pairByHand(page: Page) {
  await page.goto(pairUrl());
  await page.getByTestId('allow').click();
  await page.getByTestId('service-trackman').click();
  await expect(page).toHaveURL(`${WEB}/app.html`);
  // Paired, no Trackman sign-in: connecting's step 3, where a tester enters the test code instead.
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(page.getByTestId('unconfirmed')).toContainText('Example App');
}

/** Nothing of a Trackman sign-in anywhere on the page. */
async function noSignIn(page: Page) {
  for (const id of ['bookmarklet', 'paste', 'open-portal', 'key-none', 'key-expired', 'unconfirmed']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByText('Open the Trackman portal')).toHaveCount(0);
}

async function enter(page: Page, code: string) {
  // Small, in step 3 under the sign-in - nowhere else on the page.
  const step = page.locator('[data-test="wizard"][data-step="signin"]');
  if (await step.getByTestId('test-enter').isVisible()) await step.getByTestId('test-enter').click();
  await page.getByTestId('test-code').fill(code);
  await page.getByTestId('test-fetch').click();
}

test('a test code: asked first, then the scenario as from Trackman, in chunks while the page is open', async ({ page, world }) => {
  world.testAccount(7, 2);
  world.target.expiredCodes.add('OVER0001');
  await pairByHand(page);

  // Under the sign-in (the bookmark), small; the page has no other place for it.
  const signin = page.locator('[data-test="wizard"][data-step="signin"]');
  await expect(signin.getByTestId('bookmarklet')).toBeVisible();
  await expect(signin.getByTestId('test-enter')).toHaveText('Enter a test code');
  await expect(page.getByTestId('test-enter')).toHaveCount(1);

  // Wrong, then expired: a sentence each on step 3, nothing kept.
  await enter(page, 'WRONG0001');
  await expect(signin.getByTestId('test-error')).toHaveText('That test code isn’t right. Check it, or get a new one in your app.');
  await enter(page, 'OVER0001');
  await expect(signin.getByTestId('test-error')).toHaveText('That test code has expired. Get a new one in your app.');

  // The right one (as the app's test link, copied): step 4 about the made-up account, nothing synced yet - and on it
  // only the account and yes or no: no sign-in, no test code, no way out, no notes above or below.
  await enter(page, `glmsync://test?code=${TEST_CODE}`);
  const wizard = page.getByTestId('wizard');
  await expect(wizard).toHaveAttribute('data-step', 'account');
  await expect(page.getByTestId('wizard-title')).toHaveText('Is this your Trackman account?');
  const ask = page.getByTestId('test-confirm');
  await expect(ask).toContainText('Test mode – made-up data');
  await expect(ask).toContainText('Leon (Test T17)');
  // Its newest activity, no count (a number in the question read as data already on its way).
  await expect(ask).toContainText('Newest activity on');
  await expect(ask).not.toContainText('7 activities');
  await expect(ask).toContainText('Test “Leon, never switched” from Example App');
  await noSignIn(page);
  for (const id of ['test-enter', 'test-entry', 'disconnect', 'ended', 'pairing']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.locator('#file')).toBeHidden();
  await expect(wizard.locator('button')).toHaveText(['Yes, that’s me', 'No']);
  await expect(wizard.locator('.unofficial')).toHaveCount(0);
  expect(world.target.imports).toHaveLength(0);

  // Yes: the first data, then done - the overview below with the test's card, and still no Trackman sign-in.
  await page.getByTestId('test-yes').click();
  await expect(wizard).toHaveAttribute('data-step', 'done', { timeout: 30_000 });
  await expect(page.getByTestId('wizard-back-hint')).toContainText('Example App');
  const card = page.getByTestId('test-card');
  await expect(card).toContainText('Test mode – made-up data');
  await expect(card).toContainText('Signed in as Leon (Test T17)');
  await noSignIn(page);
  await expect(page.getByTestId('test-enter')).toHaveCount(0);
  // The first sync: the last three days; then the history in chunks of two, by itself while the page is open.
  await expect(page.getByTestId('last')).toContainText('new session', { timeout: 30_000 });
  await expect.poll(() => world.target.imports.filter((b) => b.sync?.reason === 'backfill').length, { timeout: 30_000 }).toBeGreaterThan(0);
  const first = world.target.imports[0];
  expect(first?.sync?.reason).toBe('connect');
  expect(first?.sessions.map((s) => s.external_id)).toEqual(['L0']);
  expect(first?.rounds.map((r) => r.external_id)).toEqual(['R1']);
  for (const b of world.target.imports) {
    expect(b.test).toBe(true);
    expect(b.sessions.length).toBeLessThanOrEqual(b.sync?.reason === 'backfill' ? 2 : 40);
  }
  // Trackman never asked; the code only ever in its header, never in an address.
  expect(world.tm.count()).toBe(0);
  expect(world.target.received.filter((r) => r.url.endsWith('/test-scenario')).map((r) => r.headers['X-Test-Code'])).toEqual(['WRONG0001', 'OVER0001', TEST_CODE]);
  expect(world.target.received.some((r) => /T17K2M9Q|WRONG0001|OVER0001/.test(r.url))).toBe(false);
  // The guard counts under the scenario's own account: shown on the card.
  await expect(page.getByTestId('test-counts')).toContainText(/Last hour \d+ of/);
  // …and every batch's account is the scenario's subject, as a target's account_ref works it out.
  expect(new Set(world.target.imports.map((b) => b.account_ref))).toEqual(new Set([accountRefOf(world.target.salt, 'trackman', TEST_SUBJECT)]));

  // After a reload the test is still there (this browser's IndexedDB and storage).
  // In the list it is a connection of its own, the only one, without a sign-in; its row opens it, without one too.
  await page.reload();
  const row = page.locator('[data-test="connection"][data-state="test"]');
  await expect(row).toContainText('Leon (Test T17)');
  await expect(page.getByTestId('connection')).toHaveCount(1);
  await expect(page.getByTestId('connection-state')).toHaveText('Test mode');
  await row.click();
  await expect(page.getByTestId('test-card')).toContainText('Leon (Test T17)');
  await noSignIn(page);
  await expect(page.locator('#file')).toBeHidden();

  // Ended: the card goes, the pairing stays, nothing more comes from the scenario.
  await page.getByTestId('test-end').click();
  await expect(page.getByTestId('test-card')).toContainText('The made-up data leaves this browser');
  await page.getByTestId('test-end-yes').click();
  await expect(page.getByTestId('test-card')).toHaveCount(0);
  await expect(page.getByTestId('pairing')).toContainText('Connected with Example App');
  // The pairing is the account's again: its sign-in shows, with the test code under it.
  await expect(page.getByTestId('bookmarklet')).toBeVisible();
  await expect(page.getByTestId('test-enter')).toBeVisible();
  const had = world.target.imports.length;
  await page.waitForTimeout(2_500);
  expect(world.target.imports).toHaveLength(had);
  expect(await page.evaluate(() => Object.keys(localStorage).join(' '))).not.toContain('test-asking');
});

test('without a pairing no test code to enter; an app’s account that is no test account says so, on step 3', async ({ page, world }) => {
  await page.goto(`${WEB}/app.html`);
  await expect(page.getByTestId('connections-none')).toBeVisible();
  await expect(page.getByTestId('test-enter')).toBeHidden();

  await pairByHand(page);
  await enter(page, TEST_CODE);
  await expect(page.getByTestId('test-error')).toHaveText('Test codes only work with a test account of that app. Your connection stays as it is.');
  await expect(page.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  expect(world.target.imports).toHaveLength(0);
});

test.describe('in German', () => {
  test.use({ locale: 'de-DE' });

  test('the test mode speaks the browser’s language', async ({ page, world }) => {
    world.testAccount();
    await pairByHand(page);
    await expect(page.getByTestId('test-enter')).toHaveText('Testcode eingeben');
    await enter(page, TEST_CODE);
    await expect(page.getByTestId('wizard-title')).toHaveText('Ist das dein Trackman-Konto?');
    await expect(page.getByTestId('test-confirm')).toContainText('Ja, das bin ich');
    await expect(page.getByText('Trackman-Portal öffnen')).toHaveCount(0);
    await page.getByTestId('test-yes').click();
    await expect(page.getByTestId('test-card')).toContainText('Test-Modus – erfundene Daten');
    await expect(page.getByTestId('test-end')).toHaveText('Test-Modus beenden');
  });
});
