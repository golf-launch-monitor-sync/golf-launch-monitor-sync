// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's world ranking page as a player meets it (spec/prores.md): the app's pairing page with kind=pro, the connect
 * window, then the player's own page on OWGR - made up, its table put in a moment after the page as owgr.com's is - with
 * the extension's line, *Send*, and the question whether the page is theirs, answered in the extension's own page.
 * The extension never asks the site anything itself.
 */

import { OWGR_PAGE, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, popup, test } from './fixture.ts';

test('pairs for a pro’s pages, sends the OWGR page on Send, and asks the site nothing itself', async ({ context, world, extensionId }) => {
  // Not connected yet: the page shows no line at all.
  const before = await context.newPage();
  await before.goto(OWGR_PAGE);
  await before.waitForTimeout(1500);
  await expect(before.getByTestId('ranking-line')).toHaveCount(0);
  await before.close();

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('service-pro')).toHaveText('Connect world ranking');
  await connect.getByTestId('service-pro').click();
  // Then where to find the page: the ranking's own site; nothing is read before the player taps Send there.
  await expect(connect.getByTestId('pro')).toContainText('World ranking (OWGR, Rolex)');
  await expect(connect.getByTestId('pro-open-owgr')).toBeVisible();
  await expect(connect.getByTestId('pro-last')).toHaveText('Nothing sent yet.');
  expect(world.pro.tokens.size).toBe(1);
  expect(world.hcp.tokens.size).toBe(0);
  expect(world.target.tokens.size).toBe(0);

  const page = await context.newPage();
  await page.goto(OWGR_PAGE);
  const line = page.getByTestId('ranking-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  await page.waitForTimeout(500);
  expect(world.pro.imports).toHaveLength(0);
  // Send right away: the table isn't there yet, and the extension waits for it.
  await page.getByTestId('ranking-send').click();
  await expect(line).toContainText('Sent to Example App.');
  expect(world.pro.plans).toEqual(['manual']);
  const b = world.pro.imports[0];
  expect(b).toMatchObject({
    format: 'prores/1',
    provider: 'pro',
    site: 'owgr',
    player: { name: 'Max Mustermann' },
    rankings: [{ source: 'owgr', rank: 412, points: 0.9871, events: 40 }],
    tournaments: [
      { ref: 'owgr-90012', week: '2026-W40', tour: 'dp_world', name: 'Musterstadt Open', place: 17, tied: true, points: 2.16597 },
      { ref: 'owgr-89950', week: '2026-W29', name: 'A Major Somewhere', result: 'MC' },
    ],
  });
  expect(JSON.stringify(b)).not.toContain('90001');
  // owgr.com saw the page the player opened (twice) - documents only, nothing of the extension's.
  expect(world.owgrSaw.map((r) => r.type)).toEqual(['document', 'document']);

  // The popup lists it, with what went last.
  const pop = await popup(context, extensionId, 'pro');
  await expect(pop.getByTestId('pro-last')).toContainText('Official World Golf Ranking sent, 2 tournaments');
});

test('a page with another name: the app asks, the player answers in the extension’s own page, then it goes', async ({ context, world, extensionId }) => {
  world.pro.player = 'Maximilian Mustermann-Beispiel';
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();

  const page = await context.newPage();
  await page.goto(OWGR_PAGE);
  await page.getByTestId('ranking-send').click();
  const line = page.getByTestId('ranking-line');
  await expect(line).toContainText('Example App asks whether this page is yours.');
  expect(world.pro.imports).toHaveLength(0);
  // No yes on the site's page: *Answer* only brings the extension's own page to the front.
  await expect(page.getByTestId('pro-yes')).toHaveCount(0);
  await page.getByTestId('ranking-answer').click();
  await expect(connect.getByTestId('pro-question')).toContainText('This page of the Official World Golf Ranking is for “Max Mustermann”');
  await connect.getByTestId('pro-yes').click();
  await expect(connect.getByTestId('pro-question')).toHaveCount(0);
  await expect.poll(() => world.pro.imports.length).toBe(1);
  expect(world.pro.imports[0]?.player).toEqual({ name: 'Max Mustermann', confirmed: true });
  await expect(line).toContainText('Sent to Example App.');
});
