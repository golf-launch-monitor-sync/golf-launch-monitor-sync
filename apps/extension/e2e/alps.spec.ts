// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's profile on the Alps Tour as a player meets it (spec/prores.md, `alps` of `@glmsync/provider-tours`): paired
 * for a pro's pages, he finds his made-up profile from the start page's Order of Merit - the site changes its address
 * without loading a page - and picks its reports one by one in *Select Report*: the line asks for *This Season record*
 * until his rounds are read. What goes is the season's tournaments with every round, the par from *Results* and his
 * rank; nobody else's name leaves the page, and the extension asks the site nothing itself.
 */

import { ALPS_HOME, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, test } from './fixture.ts';

test('sends his Alps Tour season with every round, the par and his rank, a report at a time', async ({ context, world, extensionId }) => {
  test.setTimeout(90_000);
  world.pro.player = 'Paul Platzhalter';
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();

  // The start page: no line there. His profile comes by the site's own link, without a page load.
  const page = await context.newPage();
  await page.goto(ALPS_HOME);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('alps-line')).toHaveCount(0);
  await page.getByRole('link', { name: 'Paul Platzhalter' }).click();
  await expect(page).toHaveURL(/\/playerprofile\/TST001$/);
  const line = page.getByTestId('alps-line');
  // *Statistics* first, as the site shows it: the line asks for *Fetch all* or the report with his rounds.
  await expect(line).toContainText('Tap “Fetch all”', { timeout: 10_000 });
  await expect(line.getByTestId('alps-fetch-all')).toBeVisible();

  await page.locator('#report').selectOption('Results');
  await page.waitForTimeout(2500);
  await page.locator('#report').selectOption('Order of Merit');
  await page.waitForTimeout(2500);
  await page.locator('#report').selectOption('This Season record');
  await expect(line).toContainText('2 tournaments with rounds read, with the par, rank 4', { timeout: 10_000 });
  expect(world.pro.imports).toHaveLength(0);

  await page.getByTestId('alps-send').click();
  await expect(line).toContainText('Sent to Example App.', { timeout: 10_000 });
  expect(world.pro.imports).toHaveLength(1);
  const par = (gross: number[]) => gross.map((g, i) => ({ round_no: i + 1, gross: g, par: 72, holes: 18 }));
  expect(world.pro.imports[0]).toMatchObject({
    format: 'prores/1',
    provider: 'pro',
    site: 'tour:alps',
    player: { name: 'Paul Platzhalter' },
    rankings: [{ source: 'tour:alps', rank: 4, points: 26845.35, events: 9 }],
    tournaments: [
      { ref: 'alps-2026-02-22-made-up-lagoon-open', tour: 'alps', name: 'Made-up Lagoon Open', start: '2026-02-22', place: 51, tied: true, rounds: par([70, 71]) },
      { ref: 'alps-2026-02-17-sample-desert-open', tour: 'alps', name: 'Sample Desert Open', start: '2026-02-17', place: 6, tied: true, rounds: par([69, 67, 73]) },
    ],
  });
  const sent = JSON.stringify(world.pro.imports);
  for (const other of ['Otto', 'OTH001', '1,507', 'Winnings']) expect(sent).not.toContain(other);
  // The site saw only the one page he opened: no request of the extension's.
  expect(world.alpsSaw.map((r) => r.type)).toEqual(['document']);
});
