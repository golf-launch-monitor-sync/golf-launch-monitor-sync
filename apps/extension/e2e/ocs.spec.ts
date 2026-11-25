// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's pages of the LET Access Series as a player meets them (spec/prores.md, `ocs` of `@glmsync/provider-tours`):
 * paired for a pro's pages, she finds her made-up profile in the players list - the site changes its address without
 * loading a page - then the Order of Merit, where only her own line is taken, and taps *Send* there. What goes is her
 * profile's tournaments with every round and her rank; nobody else's name leaves the page, and the extension asks the
 * site nothing itself.
 */

import { LETAS_PLAYERS, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, test } from './fixture.ts';

test('sends her LET Access profile with every round and her rank of the Order of Merit', async ({ context, world, extensionId }) => {
  test.setTimeout(90_000);
  world.pro.player = 'Erika Erfunden';
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();

  // The players list: no line there. Her profile comes by the site's own link, without a page load.
  const page = await context.newPage();
  await page.goto(LETAS_PLAYERS);
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('ocs-line')).toHaveCount(0);
  await page.getByRole('link', { name: 'Erika Erfunden' }).click();
  await expect(page).toHaveURL(/\/player-profiles\/990001\/$/);
  const line = page.getByTestId('ocs-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App', { timeout: 10_000 });
  // Her results come a moment after the page; read once they show.
  await page.waitForTimeout(2500);

  // The Order of Merit: her line only, and the line says so.
  await page.getByRole('link', { name: 'Order of Merit' }).click();
  await expect(line).toContainText('Rank 3 of the Order of Merit read', { timeout: 10_000 });
  expect(world.pro.imports).toHaveLength(0);
  await page.getByTestId('ocs-send').click();
  await expect(line).toContainText('Sent to Example App.', { timeout: 10_000 });
  expect(world.pro.imports).toHaveLength(1);
  expect(world.pro.imports[0]).toMatchObject({
    format: 'prores/1',
    provider: 'pro',
    site: 'tour:let_access',
    player: { name: 'Erika Erfunden' },
    rankings: [{ source: 'tour:let_access', rank: 3, points: 1807.42, events: 18 }],
    tournaments: [
      { ref: 'letas-9003-2026', tour: 'let_access', name: 'Beispiel Open', start: '2026-07-08', place: 53, tied: true, rounds: [{ round_no: 1, gross: 70, par: 72, holes: 18 }, { round_no: 2, gross: 75, par: 72, holes: 18 }] },
      { ref: 'letas-9001-2026', tour: 'let_access', name: 'Sample Ladies Open', start: '2026-04-12', place: 2, rounds: [{ round_no: 1, gross: 72, par: 72, holes: 18 }, { round_no: 2, gross: 69, par: 72, holes: 18 }, { round_no: 3, gross: 69, par: 72, holes: 18 }] },
    ],
  });
  const sent = JSON.stringify(world.pro.imports);
  for (const other of ['Anna', 'Ausgedacht', 'Berta', '990010', '1,000']) expect(sent).not.toContain(other);
  // The site saw only the one page she opened: no request of the extension's.
  expect(world.letasSaw.map((r) => r.type)).toEqual(['document']);
});
