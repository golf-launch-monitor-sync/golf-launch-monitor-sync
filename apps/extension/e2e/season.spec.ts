// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's season page as a player meets it (spec/prores.md, `@glmsync/provider-tours` `seasonPage`): paired for a
 * pro's pages, the player opens his made-up profile on pgatour.com and goes to *Results* (the site changes the page
 * without loading it), taps *Send*; then her made-up *Results* page on lpga.com. Of the page only his own season
 * leaves it (not the leaderboard strip of others, not a team event's rounds); the extension asks the sites nothing.
 */

import { LPGA_RESULTS, PGA_OVERVIEW, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, test } from './fixture.ts';

test('sends his PGA Tour season from his Results page, and her LPGA season, on Send only', async ({ context, world, extensionId }) => {
  test.setTimeout(90_000);
  // Not connected yet: no line, and nothing read.
  const before = await context.newPage();
  await before.goto(PGA_OVERVIEW);
  await before.locator('#results').click();
  await before.waitForTimeout(2000);
  await expect(before.getByTestId('season-line')).toHaveCount(0);
  await before.close();

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();

  // His profile: no line on the overview; on Results (no page load) the line, and Send waits for the season's table.
  world.pro.player = 'Max Erfunden';
  const page = await context.newPage();
  await page.goto(PGA_OVERVIEW);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('season-line')).toHaveCount(0);
  await page.locator('#results').click();
  const line = page.getByTestId('season-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  expect(world.pro.imports).toHaveLength(0);
  await page.getByTestId('season-send').click();
  await expect(line).toContainText('Sent to Example App.');
  expect(world.pro.imports[0]).toMatchObject({
    format: 'prores/1',
    provider: 'pro',
    site: 'tour:pga_tour',
    player: { name: 'Max Erfunden' },
    rankings: [{ source: 'tour:pga_tour', rank: 83, points: 494, events: 3 }],
    tournaments: [
      { ref: 'pga-R2026904', tour: 'pga_tour', name: 'Made-up Coast Open', start: '2026-01-29', end: '2026-02-01', place: 5, tied: true, points: 105 },
      { ref: 'pga-R2026902', tour: 'pga_tour', name: 'Sample Desert Classic', start: '2026-01-22', end: '2026-01-25', result: 'MC' },
    ],
  });
  expect(world.pro.imports[0]?.tournaments?.map((t) => t.rounds?.length)).toEqual([4, 3]);
  const sent = JSON.stringify(world.pro.imports[0]);
  for (const other of ['Erfunden, O', 'O. Erfunden', 'Zurich', '99002', '122']) expect(sent).not.toContain(other);

  // Her LPGA page: the season from its first days; the team event left out.
  world.pro.player = 'Lena Ausgedacht';
  await page.goto(LPGA_RESULTS);
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  await page.getByTestId('season-send').click();
  await expect(line).toContainText('Sent to Example App.');
  expect(world.pro.imports[1]).toMatchObject({
    site: 'tour:lpga',
    player: { name: 'Lena Ausgedacht' },
    rankings: [{ source: 'tour:lpga', rank: 134, points: 63.688, events: 2 }],
    tournaments: [{ ref: 'lpga-2026-made-up-links-open', tour: 'lpga', start: '2026-07-23', place: 44, tied: true, points: 9.07 }],
  });
  expect(world.pro.imports[1]?.tournaments).toHaveLength(1);
  expect(world.pro.plans).toEqual(['manual', 'manual']);
  // The sites saw only the pages the player opened: documents, never a request of the extension's.
  expect(new Set(world.seasonSaw.map((r) => r.type))).toEqual(new Set(['document']));
});
