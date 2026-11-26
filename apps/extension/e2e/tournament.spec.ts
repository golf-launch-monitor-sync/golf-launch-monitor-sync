// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One tournament from golf.de's page (spec/hcp.md, *Taking one tournament*, 1.19.0): a made-up tournament page of
 * golf.de's calendar, whose lines arrive a moment after the page as golf.de's do, the button by its heading once an
 * app is connected for golf.de, the one tournament sent on the tap - and nothing on a result list, the list, or a page
 * golf.de changed.
 */

import { PERSONAL, TOURNAMENT_NAME } from '../../../packages/provider-golfde/src/testing.ts';
import { HCP_CODE, HCP_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { chooseService, connectWindow, expect, test } from './fixture.ts';

const CALENDAR = 'https://www.golf.de/sport/turnierkalender/clubturniere.html';
const TOURNAMENT = `${CALENDAR}#/490000000001?endtage=180&latitude=53.55&longitude=9.99&radius=50`;

test('takes the tournament whose page is open, on the tap only, and nothing of a list or a person', async ({ context, world, extensionId }) => {
  world.golfde.tournament = {};
  // Nothing connected: golf.de's page shows no button.
  const before = await context.newPage();
  await before.goto(TOURNAMENT);
  await expect(before.getByRole('heading', { name: TOURNAMENT_NAME })).toBeVisible();
  await before.waitForTimeout(5000);
  await expect(before.getByTestId('golfde-event')).toHaveCount(0);
  await before.close();

  // Connected for golf.de: no golf.de account and no yes to one is needed for a public page.
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');
  await expect.poll(() => world.hcp.tokens.size).toBe(1);

  const page = await context.newPage();
  await page.goto(TOURNAMENT);
  const take = page.getByTestId('golfde-event-take');
  await expect(take).toHaveText('Add to Example App');
  // Nothing went before the tap.
  await page.waitForTimeout(1500);
  expect(world.hcp.tournamentBodies).toHaveLength(0);

  await take.click();
  await expect(page.getByTestId('golfde-event-said')).toHaveText('Added to your calendar in Example App.');
  expect(world.hcp.tournamentBodies).toHaveLength(1);
  expect(world.hcp.tournaments.get('490000000001')).toMatchObject({
    url: `${CALENDAR}#/490000000001`,
    name: TOURNAMENT_NAME,
    date: '2027-06-12',
    time: '09:30',
    play_form: 'Einzel - Stableford',
    holes: 18,
    entry_close_online: '2027-06-09T18:00',
  });
  // Not the search the player came from (where they searched), not the registration box's name.
  const sent = JSON.stringify(world.hcp.tournamentBodies);
  expect(sent).not.toContain('latitude');
  for (const v of Object.values(PERSONAL)) expect(sent).not.toContain(v);
  // Only the tournament went to the app: no plan, no import.
  expect(world.hcp.plans).toHaveLength(0);
  expect(world.hcp.imports).toHaveLength(0);

  // Again: the app has it already.
  await take.click();
  await expect(page.getByTestId('golfde-event-said')).toHaveText('Already in your calendar in Example App.');

  // A result list and the list are no tournament's page: the button goes.
  await page.evaluate(() => {
    location.hash = '#/490000000001/ergebnisse';
  });
  await expect(page.getByTestId('golfde-event')).toHaveCount(0);
  await page.evaluate(() => {
    location.hash = '#/?radius=50';
  });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('golfde-event')).toHaveCount(0);
  expect(world.hcp.tournamentBodies).toHaveLength(2);
});

test('a page golf.de changed: the tap says it can’t be read, and nothing is sent', async ({ context, world, extensionId }) => {
  world.golfde.tournament = { title: 'Infos zum Turnier' };
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  await chooseService(await windowOpens, 'golfde');
  await expect.poll(() => world.hcp.tokens.size).toBe(1);

  const page = await context.newPage();
  await page.goto(TOURNAMENT);
  // The lines aren't found: the button still shows after a few seconds, so the player isn't left without a word.
  await page.getByTestId('golfde-event-take').click({ timeout: 15_000 });
  await expect(page.getByTestId('golfde-event-said')).toHaveText('This page can’t be read – golf.de may have changed it. Nothing was sent.');
  expect(world.hcp.tournamentBodies).toHaveLength(0);
});
