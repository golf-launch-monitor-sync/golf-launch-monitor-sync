// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode in the extension (spec/test-mode.md): paired from the app's page, no Trackman sign-in at all; the test
 * code typed in the popup brings the app's made-up scenario, "Is this your account?" first, then the data as from
 * Trackman - the first sync, then the older history a chunk per alarm, `test: true` on every batch, Trackman never
 * asked, the icon without a "sign in". Wrong and expired codes get their sentence; ending it stops it. All synthetic.
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

test('a test code in the popup: asked first, then the scenario in chunks as from Trackman', async ({ context, world, extensionId, background }) => {
  world.testAccount(7, 2);
  world.target.expiredCodes.add('OVER0001');
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await allowAndChoose(connect);
  // Not signed in to Trackman: the icon says so - until the pairing is in test mode, which needs no sign-in.
  await expect.poll(() => badgeText(background)).toBe('!');

  const pop = await popup(context, extensionId, 'lm');
  await enter(pop, 'WRONG0001');
  await expect(pop.getByTestId('test-error')).toHaveText('That test code isn’t right. Check it, or get a new one in your app.');
  await enter(pop, 'OVER0001');
  await expect(pop.getByTestId('test-error')).toHaveText('That test code has expired. Get a new one in your app.');
  // Typing survives the panel's redraws every few seconds.
  await pop.getByTestId('test-code').fill(`t17k ${TEST_CODE.slice(4)}`.toUpperCase());
  await pop.waitForTimeout(3_500);
  await expect(pop.getByTestId('test-code')).toHaveValue(`T17K ${TEST_CODE.slice(4)}`);
  await pop.getByTestId('test-fetch').click();

  const ask = pop.getByTestId('test-confirm');
  await expect(ask).toContainText('Is this your account?');
  await expect(ask).toContainText('Leon (Test T17)');
  await expect(ask).toContainText('Test mode – made-up data');
  expect(world.target.imports).toHaveLength(0);
  await pop.getByTestId('test-yes').click();
  await expect(pop.getByTestId('test-card')).toContainText('Signed in as Leon (Test T17)');
  await expect(pop.getByTestId('last')).toContainText('new session', { timeout: 30_000 });
  // In the list the test is a connection of its own, with its made-up account.
  await pop.getByTestId('connections-back').first().click();
  await expect(pop.locator('[data-test="connection"][data-state="test"]')).toContainText('Leon (Test T17)');
  await expect(pop.locator('[data-test="connection"][data-state="test"]')).toContainText('Test mode');
  await pop.locator('[data-test="connection"][data-state="test"]').click();
  await expect.poll(() => badgeText(background)).toBe('');
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

  // Ended in the popup: the card goes, the pairing stays, the alarm brings nothing more.
  await pop.getByTestId('test-end').click();
  await pop.getByTestId('test-end-yes').click();
  await expect(pop.getByTestId('test-card')).toHaveCount(0);
  await expect(pop.getByTestId('pairing')).toContainText('Example App');
  await expect.poll(() => badgeText(background)).toBe('!');
  const had = world.target.imports.length;
  await nextChunk();
  await pop.waitForTimeout(2_000);
  expect(world.target.imports).toHaveLength(had);
});

test('no pairing: no test code to enter, only *Connect new*', async ({ context, extensionId }) => {
  const pop = await popup(context, extensionId);
  await expect(pop.getByTestId('connections-none')).toBeVisible();
  await expect(pop.getByTestId('test-enter')).toBeHidden();
});
