// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode in the web app (spec/test-mode.md): a connected app's test code at the bottom of the page brings its
 * made-up scenario, "Is this your account?" first, then the data as from Trackman - the first sync, then the older
 * history in chunks while the page is open, `test: true` on every batch, Trackman never asked. A wrong, an expired
 * code, an app without a test account and a browser without a pairing each get their sentence. All synthetic.
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
  await page.getByTestId('use-web').click();
  await expect(page).toHaveURL(`${WEB}/app.html`);
  // Paired, no Trackman sign-in: connecting's first step (a tester of test mode needs none, and goes on below).
  await expect(page.getByTestId('unconfirmed')).toContainText('Example App');
}

async function enter(page: Page, code: string) {
  if (await page.getByTestId('test-enter').isVisible()) await page.getByTestId('test-enter').click();
  await page.getByTestId('test-code').fill(code);
  await page.getByTestId('test-fetch').click();
}

test('a test code: asked first, then the scenario as from Trackman, in chunks while the page is open', async ({ page, world }) => {
  world.testAccount(7, 2);
  world.target.expiredCodes.add('OVER0001');
  await pairByHand(page);

  // Wrong, then expired: a sentence each, nothing kept.
  await enter(page, 'WRONG0001');
  await expect(page.getByTestId('test-error')).toHaveText('That test code isn’t right. Check it, or get a new one in your app.');
  await enter(page, 'OVER0001');
  await expect(page.getByTestId('test-error')).toHaveText('That test code has expired. Get a new one in your app.');

  // The right one (as the app's test link, copied): "Is this your account?" about the made-up account, nothing synced yet.
  await enter(page, `glmsync://test?code=${TEST_CODE}`);
  const ask = page.getByTestId('test-confirm');
  await expect(ask).toContainText('Is this your account?');
  await expect(ask).toContainText('Test mode – made-up data');
  await expect(ask).toContainText('Leon (Test T17)');
  // Its newest activity, no count (a number in the question read as data already on its way).
  await expect(ask).toContainText('Newest activity on');
  await expect(ask).not.toContainText('7 activities');
  await expect(ask).toContainText('Test “Leon, never switched” from Example App');
  await expect(page.getByTestId('test-entry')).toHaveCount(0);
  expect(world.target.imports).toHaveLength(0);

  await page.getByTestId('test-yes').click();
  const card = page.getByTestId('test-card');
  await expect(card).toContainText('Test mode – made-up data');
  await expect(card).toContainText('Signed in as Leon (Test T17)');
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
  await page.reload();
  await expect(page.getByTestId('test-card')).toContainText('Leon (Test T17)');

  // Ended: the card goes, the pairing stays, nothing more comes from the scenario.
  await page.getByTestId('test-end').click();
  await expect(page.getByTestId('test-card')).toContainText('The made-up data leaves this browser');
  await page.getByTestId('test-end-yes').click();
  await expect(page.getByTestId('test-card')).toHaveCount(0);
  await expect(page.getByTestId('pairing')).toContainText('Connected with Example App');
  const had = world.target.imports.length;
  await page.waitForTimeout(2_500);
  expect(world.target.imports).toHaveLength(had);
  expect(await page.evaluate(() => Object.keys(localStorage).join(' '))).not.toContain('test-asking');
});

test('without a pairing it says to connect first; an app’s account that is no test account says so', async ({ page, world }) => {
  await page.goto(`${WEB}/app.html`);
  await page.getByTestId('test-enter').click();
  await expect(page.getByTestId('test-error')).toHaveText(/Connect with the app first/);
  await expect(page.getByTestId('test-fetch')).toHaveCount(0);

  await pairByHand(page);
  await enter(page, TEST_CODE);
  await expect(page.getByTestId('test-error')).toHaveText('Test codes only work with a test account of that app. Your connection stays as it is.');
  expect(world.target.imports).toHaveLength(0);
});

test.describe('in German', () => {
  test.use({ locale: 'de-DE' });

  test('the test mode speaks the browser’s language', async ({ page, world }) => {
    world.testAccount();
    await pairByHand(page);
    await expect(page.getByTestId('test-enter')).toHaveText('Testcode eingeben');
    await enter(page, TEST_CODE);
    await expect(page.getByTestId('test-confirm')).toContainText('Ist das dein Konto?');
    await page.getByTestId('test-yes').click();
    await expect(page.getByTestId('test-card')).toContainText('Test-Modus – erfundene Daten');
    await expect(page.getByTestId('test-end')).toHaveText('Test-Modus beenden');
  });
});
