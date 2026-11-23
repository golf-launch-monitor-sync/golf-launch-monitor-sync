// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode in the extension (spec/test-mode.md): paired from the app's page, no Trackman sign-in at all. In the
 * connect window's step 3, small under *Open the Trackman portal*, the test code instead: a wrong one stays there with
 * its sentence; the right one brings the app's made-up scenario to step 4, *Is this your account?*, with only the
 * account and yes or no; then the data as from Trackman - the first sync, then the older history a chunk per alarm,
 * `test: true` on every batch, Trackman never asked - and nowhere a Trackman sign-in for it: not in the list, not in
 * its details, not on the icon. Ending it stops it. All synthetic.
 */

import type { Page } from '@playwright/test';
import { accountRefOf } from '../../../packages/core/src/sha256.ts';
import { pairUrl, TEST_CODE, TEST_SUBJECT } from '../../../tools/e2e/world.ts';
import { allowAndChoose, badgeText, connectWindow, expect, popup, test } from './fixture.ts';

async function enter(page: Page, code: string) {
  if (await page.getByTestId('test-enter').isVisible()) await page.getByTestId('test-enter').click();
  await page.getByTestId('test-code').fill(code);
  await page.getByTestId('test-fetch').click();
}

/** Nothing of a Trackman sign-in on the page. */
async function noSignIn(page: Page) {
  for (const id of ['open-portal', 'switch-account', 'key-none', 'key-expired', 'unconfirmed']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByText('Open the Trackman portal')).toHaveCount(0);
}

test('the test code in step 3 instead of the sign-in; then only the account, and no sign-in anywhere after', async ({ context, world, extensionId, background }) => {
  world.testAccount(7, 2);
  world.target.expiredCodes.add('OVER0001');
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await allowAndChoose(connect);
  // Not signed in to Trackman: the icon says so - until a test code stands in for the sign-in.
  await expect.poll(() => badgeText(background)).toBe('!');

  // Step 3: *Open the Trackman portal*, and small under it the test code - the window has no other place for it.
  const wizard = connect.locator('#status [data-test="wizard"]');
  await expect(wizard).toHaveAttribute('data-step', 'signin');
  await expect(wizard.getByTestId('open-portal')).toBeVisible();
  await expect(wizard.getByTestId('test-enter')).toHaveText('Enter a test code');
  await expect(connect.getByTestId('test-enter')).toHaveCount(1);

  await enter(connect, 'WRONG0001');
  await expect(wizard.getByTestId('test-error')).toHaveText('That test code isn’t right. Check it, or get a new one in your app.');
  await enter(connect, 'OVER0001');
  await expect(wizard.getByTestId('test-error')).toHaveText('That test code has expired. Get a new one in your app.');
  await expect(wizard).toHaveAttribute('data-step', 'signin');
  // Typing survives the panel's redraws every few seconds, the cursor in the field.
  await connect.getByTestId('test-code').fill(`t17k ${TEST_CODE.slice(4)}`.toUpperCase());
  await connect.waitForTimeout(3_500);
  await expect(connect.getByTestId('test-code')).toHaveValue(`T17K ${TEST_CODE.slice(4)}`);
  await expect(connect.getByTestId('test-code')).toBeFocused();
  await connect.getByTestId('test-fetch').click();

  // Step 4: only the made-up account and yes or no.
  await expect(wizard).toHaveAttribute('data-step', 'account');
  await expect(connect.getByTestId('wizard-title')).toHaveText('Is this your Trackman account?');
  const ask = connect.getByTestId('test-confirm');
  await expect(ask).toContainText('Leon (Test T17)');
  await expect(ask).toContainText('Test mode – made-up data');
  await expect(wizard.locator('button')).toHaveText(['Yes, that’s me', 'No']);
  await expect(wizard.locator('.unofficial')).toHaveCount(0);
  await noSignIn(connect);
  await expect(connect.getByTestId('test-enter')).toHaveCount(0);
  await expect.poll(() => badgeText(background)).toBe('?');
  expect(world.target.imports).toHaveLength(0);

  // Yes: the first data, then done with *Back to …*, which closes the window.
  await connect.getByTestId('test-yes').click();
  await expect(wizard).toHaveAttribute('data-step', 'done', { timeout: 30_000 });
  await expect(connect.getByTestId('wizard-brought')).toContainText('1 session');
  await noSignIn(connect);
  await expect(connect.getByTestId('test-card')).toContainText('Signed in as Leon (Test T17)');
  const closed = connect.waitForEvent('close');
  await connect.getByTestId('wizard-back').click();
  await closed;
  await expect.poll(() => badgeText(background)).toBe('');

  // The list: the test is a connection of its own, the only one, without a sign-in; its details neither.
  const pop = await popup(context, extensionId);
  const row = pop.locator('[data-test="connection"][data-state="test"]');
  await expect(row).toContainText('Leon (Test T17)');
  await expect(row).toContainText('Test mode');
  await expect(pop.getByTestId('connection')).toHaveCount(1);
  await noSignIn(pop);
  await row.click();
  await expect(pop.getByTestId('test-card')).toContainText('Signed in as Leon (Test T17)');
  await expect(pop.getByTestId('last')).toContainText('new session');
  await noSignIn(pop);
  await expect(pop.getByTestId('test-enter')).toHaveCount(0);
  expect(world.target.imports.map((b) => b.sync?.reason)).toEqual(['connect']);

  // The history: a chunk each time the background's alarm goes (its wait made short here: the clock can't be moved).
  const nextChunk = async () => {
    await background.evaluate(async () => {
      const raw = (await chrome.storage.local.get('glmsync/entries'))['glmsync/entries'] as string;
      const entries = JSON.parse(raw) as { history?: { next_at?: number } }[];
      for (const e of entries) if (e.history) e.history.next_at = 0;
      await chrome.storage.local.set({ 'glmsync/entries': JSON.stringify(entries) });
      await chrome.alarms.create('backfill', { when: Date.now() + 200 });
    });
  };
  await nextChunk();
  await expect.poll(() => world.target.imports.filter((b) => b.sync?.reason === 'backfill').length, { timeout: 30_000 }).toBe(1);
  await nextChunk();
  await expect.poll(() => world.target.imports.filter((b) => b.sync?.reason === 'backfill').length, { timeout: 30_000 }).toBe(2);
  const chunks = world.target.imports.map((b) => [b.sync?.reason, b.sessions.map((s) => s.external_id)]);
  expect(chunks).toEqual([
    ['connect', ['L0']],
    ['backfill', ['L1', 'L2']],
    ['backfill', ['L3', 'L4']],
  ]);
  for (const b of world.target.imports) {
    expect(b.test).toBe(true);
    expect(b.account_ref).toBe(accountRefOf(world.target.salt, 'trackman', TEST_SUBJECT));
  }
  expect(world.tm.count()).toBe(0);
  expect(world.target.received.some((r) => r.url.includes(TEST_CODE))).toBe(false);

  // Ended in the popup: the card goes, the pairing stays - the account's again, so its sign-in shows, the test code
  // under it - and the alarm brings nothing more.
  await pop.getByTestId('test-end').click();
  await pop.getByTestId('test-end-yes').click();
  await expect(pop.getByTestId('test-card')).toHaveCount(0);
  await expect(pop.getByTestId('pairing')).toContainText('Example App');
  await expect(pop.getByTestId('open-portal')).toBeVisible();
  await expect(pop.getByTestId('test-enter')).toBeVisible();
  await expect.poll(() => badgeText(background)).toBe('!');
  const had = world.target.imports.length;
  await nextChunk();
  await pop.waitForTimeout(2_000);
  expect(world.target.imports).toHaveLength(had);
});

test('in the popup too: the test code in step 3 of a connection not set up yet', async ({ context, world, extensionId }) => {
  world.testAccount(3, 2);
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  await allowAndChoose(await windowOpens);
  const pop = await popup(context, extensionId, 'lm');
  await expect(pop.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await enter(pop, TEST_CODE);
  await expect(pop.getByTestId('wizard')).toHaveAttribute('data-step', 'account');
  await noSignIn(pop);
  // No: back to step 3, nothing kept.
  await pop.getByTestId('test-no').click();
  await expect(pop.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(pop.getByTestId('open-portal')).toBeVisible();
  expect(world.target.imports).toHaveLength(0);
});

test('no pairing: no test code to enter, only *Connect new*', async ({ context, extensionId }) => {
  const pop = await popup(context, extensionId);
  await expect(pop.getByTestId('connections-none')).toBeVisible();
  await expect(pop.getByTestId('test-enter')).toBeHidden();
});
