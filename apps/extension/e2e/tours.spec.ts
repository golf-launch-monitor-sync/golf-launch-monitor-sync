// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's tour pages as a player meets them (spec/prores.md, `@glmsync/provider-tours`): paired for a pro's pages, the
 * player opens his made-up profile on the Pro Golf Tour and one tournament's page himself, taps *Send*; then *Fetch all*
 * opens the other tournament's page in the same tab, as its link does, and what was read goes out at the end. Of a
 * tournament only his own line leaves the page; the extension asks the site nothing itself.
 */

import { PGT_PROFILE, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, test } from './fixture.ts';

test('sends his Pro Golf Tour page with the rounds read, and Fetch all reads the rest', async ({ context, world, extensionId }) => {
  test.setTimeout(90_000);
  world.pro.player = 'Lena Beispiel';
  // Not connected yet: no line, and nothing read.
  const before = await context.newPage();
  await before.goto(PGT_PROFILE);
  await before.waitForTimeout(1500);
  await expect(before.getByTestId('tour-line')).toHaveCount(0);
  await before.close();

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();

  // His profile, then one tournament's page he opens himself (its final result comes a moment after the page).
  const page = await context.newPage();
  await page.goto(PGT_PROFILE);
  const line = page.getByTestId('tour-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  await page.goto('https://www.progolftour.de/tournament-details/sample-desert-open-2026');
  await expect(page.getByTestId('tour-line')).toHaveCount(0);
  await page.waitForTimeout(2500);
  await page.goto(PGT_PROFILE);
  expect(world.pro.imports).toHaveLength(0);
  await page.getByTestId('tour-send').click();
  await expect(line).toContainText('Sent to Example App.');
  const b = world.pro.imports[0];
  expect(b).toMatchObject({
    format: 'prores/1',
    provider: 'pro',
    site: 'tour:pro_golf_tour',
    player: { name: 'Lena Beispiel' },
    rankings: [{ source: 'tour:pro_golf_tour', rank: 7, points: 17290.6, events: 2 }],
    tournaments: [{
      ref: 'pgt-5101', tour: 'pro_golf_tour', name: 'Sample Desert Open 2026', start: '2026-03-02', end: '2026-03-04',
      venue: 'Sample Golf Club', country: 'Egypt', place: 6, tied: true, field: 3, points: 1027.5,
      rounds: [{ round_no: 1, gross: 69, par: 71, holes: 18 }, { round_no: 2, gross: 70, par: 71, holes: 18 }, { round_no: 3, gross: 70, par: 71, holes: 18 }],
    }],
  });
  const sent = JSON.stringify(world.pro.imports);
  for (const other of ['Otto', 'Erfunden', 'Ausgedacht', '99001']) expect(sent).not.toContain(other);

  // Fetch all: the page he hasn't opened, in this tab; then what was read goes once.
  await page.getByTestId('tour-fetch-all').click();
  await expect(page).toHaveURL(/beispiel-k%C3%B6ln-classic-2026$/, { timeout: 15_000 });
  await expect(page.getByTestId('tour-line')).toContainText('Fetching your tournaments: 0 of 1', { timeout: 10_000 });
  await expect.poll(() => world.pro.imports.length, { timeout: 30_000 }).toBe(2);
  const all = world.pro.imports[1];
  expect(all?.tournaments?.map((t) => [t.ref, t.result ?? t.place, t.rounds?.length])).toEqual([['pgt-5102', 'MC', 2], ['pgt-5101', 6, 3]]);
  // The site saw only the pages: documents, never a request of the extension's.
  expect(new Set(world.pgtSaw.map((r) => r.type))).toEqual(new Set(['document']));
});
