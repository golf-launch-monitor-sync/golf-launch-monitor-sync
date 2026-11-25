// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's pages on europeantour.com as a player meets them (spec/prores.md, `@glmsync/provider-tours`): paired for a
 * pro's pages, the player opens his made-up results, taps *Send*: his HotelPlanner Tour and his DP World Tour go as a
 * page each. He picks another season in the page's own select; *Send* again brings its tournament too. Of the page
 * only his own results leave it; the extension asks the site nothing itself.
 */

import { ET_RESULTS, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, test } from './fixture.ts';

test('sends his results on europeantour.com as a page per tour, and another season once he picks it', async ({ context, world, extensionId }) => {
  test.setTimeout(90_000);
  world.pro.player = 'Jonas Beispiel';
  // Not connected yet: no line, and nothing read.
  const before = await context.newPage();
  await before.goto(ET_RESULTS);
  await before.waitForTimeout(1500);
  await expect(before.getByTestId('et-line')).toHaveCount(0);
  await before.close();

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();

  const page = await context.newPage();
  await page.goto(ET_RESULTS);
  const line = page.getByTestId('et-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  expect(world.pro.imports).toHaveLength(0);
  await page.getByTestId('et-send').click();
  await expect(line).toContainText('Sent to Example App.');
  expect(world.pro.imports.map((b) => b.site)).toEqual(['tour:dp_world', 'tour:hotelplanner']);
  const [dp, hp] = world.pro.imports;
  expect(dp).toMatchObject({
    format: 'prores/1', provider: 'pro', player: { name: 'Jonas BEISPIEL' },
    tournaments: [{ ref: 'et-beispiel-international-2026', tour: 'dp_world', place: 43, tied: true, points: 12.5, start: '2026-07-02', end: '2026-07-05' }],
  });
  expect(hp).toMatchObject({ rankings: [{ source: 'tour:hotelplanner', rank: 12 }] });
  expect(hp?.tournaments?.map((t) => [t.ref, t.result ?? t.place, t.rounds?.length, t.rounds?.[0]?.par])).toEqual([
    ['et-made-up-grand-final-2026', 9, 4, 72],
    ['et-sample-open-2026', 'MC', 2, undefined],
  ]);
  const sent = JSON.stringify(world.pro.imports);
  for (const other of ['Otto', 'ERFUNDEN', '99002', '1,000']) expect(sent).not.toContain(other);

  // Another season, picked in the page's own select: read once it shows, sent with the next tap.
  await page.locator('#season').selectOption('2025');
  await expect(page.locator('#results')).toContainText('Old Sample Challenge');
  // Read a moment after the pick; *Send* is offered again for it.
  await expect(page.getByTestId('et-send')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('et-send').click();
  await expect.poll(() => world.pro.imports.length).toBe(4);
  expect(world.pro.imports[3]?.tournaments?.map((t) => t.ref)).toEqual(['et-made-up-grand-final-2026', 'et-sample-open-2026', 'et-old-sample-challenge-2025']);
  // The site saw only the pages: documents, never a request of the extension's.
  expect(new Set(world.etSaw.map((r) => r.type))).toEqual(new Set(['document']));
});
