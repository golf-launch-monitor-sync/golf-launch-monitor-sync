// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Fetch all* on the tours whose pages show a part at a time (decision 57; `run` and `tour-runs` of
 * `@glmsync/provider-tours`, the extension's tour-run.ts): on his tap, the extension does what he does by hand - picks
 * the Alps Tour's reports in *Select Report*; opens his pages on europeantour.com and picks the seasons in their own
 * select; on pgatour.com opens the menus the page draws (*Tour*, *Season*) and picks their entries - one step at a
 * time with a person's pause, reads each as when he does it, and sends once at the end. The sites see only their pages;
 * nobody else's name leaves them.
 */

import { ALPS_HOME, ET_RESULTS, PGA_OVERVIEW, PRO_CODE, PRO_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import type { BrowserContext } from '@playwright/test';
import { connectWindow, expect, test } from './fixture.ts';

async function pairForPro(context: BrowserContext, extensionId: string): Promise<void> {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(PRO_TARGET, PRO_CODE)}&kind=pro`);
  const connect = await windowOpens;
  await connect.getByTestId('service-pro').click();
  await expect(connect.getByTestId('pro')).toBeVisible();
}

test('Fetch all on the Alps Tour picks his three reports and sends the season with the par and his rank', async ({ context, world, extensionId }) => {
  test.setTimeout(150_000);
  world.pro.player = 'Paul Platzhalter';
  await pairForPro(context, extensionId);
  const page = await context.newPage();
  await page.goto(ALPS_HOME);
  await page.getByRole('link', { name: 'Paul Platzhalter' }).click();
  const line = page.getByTestId('alps-line');
  await expect(line).toContainText('Tap “Fetch all”', { timeout: 10_000 });

  await line.getByTestId('alps-fetch-all').click();
  await expect(line).toContainText('Fetching all for you: step', { timeout: 10_000 });
  await expect(line.getByTestId('alps-stop')).toBeVisible();
  // It picks in the page's own select, as he would.
  await expect(page.locator('#report')).toHaveValue('This Season record', { timeout: 10_000 });
  expect(world.pro.imports).toHaveLength(0);
  await expect(line).toContainText('Sent to Example App.', { timeout: 90_000 });
  expect(world.pro.imports).toHaveLength(1);
  const par = (gross: number[]) => gross.map((g, i) => ({ round_no: i + 1, gross: g, par: 72, holes: 18 }));
  expect(world.pro.imports[0]).toMatchObject({
    site: 'tour:alps',
    player: { name: 'Paul Platzhalter' },
    rankings: [{ source: 'tour:alps', rank: 4, points: 26845.35, events: 9 }],
    tournaments: [
      { ref: 'alps-2026-02-22-made-up-lagoon-open', rounds: par([70, 71]) },
      { ref: 'alps-2026-02-17-sample-desert-open', rounds: par([69, 67, 73]) },
    ],
  });
  for (const other of ['Otto', 'OTH001', '1,507']) expect(JSON.stringify(world.pro.imports)).not.toContain(other);
  // The site saw only the one page he opened: the picks are the page's own.
  expect(world.alpsSaw.map((r) => r.type)).toEqual(['document']);
  // Its line offers Fetch all again (three runs a day).
  await expect(line.getByTestId('alps-fetch-all')).toBeVisible();
});

test('Fetch all on europeantour.com opens his pages, picks the seasons, and sends both tours once', async ({ context, world, extensionId }) => {
  test.setTimeout(180_000);
  world.pro.player = 'Jonas Beispiel';
  await pairForPro(context, extensionId);
  const page = await context.newPage();
  await page.goto(ET_RESULTS);
  const line = page.getByTestId('et-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  await line.getByTestId('et-fetch-all').click();
  await expect(line).toContainText('Fetching all for you: step', { timeout: 10_000 });
  // His overview of each tour, then Wins & Results with the seasons picked in its select, then Stats.
  await expect(page).toHaveURL(/\/players\/jonas-beispiel-99002\/\?tour=dpworld-tour$/, { timeout: 20_000 });
  await expect(page).toHaveURL(/\/players\/jonas-beispiel-99002\/stats\/\?tour=dpworld-tour$/, { timeout: 120_000 });
  await expect(page.getByTestId('et-line')).toContainText('Sent to Example App.', { timeout: 30_000 });
  expect(world.pro.imports.map((b) => b.site)).toEqual(['tour:dp_world', 'tour:hotelplanner']);
  const [dp, hp] = world.pro.imports;
  expect(dp?.tournaments?.map((t) => t.ref)).toEqual(['et-beispiel-international-2026']);
  // The season of 2025 came by the run's own pick in the page's select.
  expect(hp?.tournaments?.map((t) => t.ref)).toEqual(['et-made-up-grand-final-2026', 'et-sample-open-2026', 'et-old-sample-challenge-2025']);
  for (const other of ['Otto', 'ERFUNDEN', '1,000']) expect(JSON.stringify(world.pro.imports)).not.toContain(other);
  // Only his pages were opened, as documents: no request of the extension's own.
  expect(new Set(world.etSaw.map((r) => r.type))).toEqual(new Set(['document']));
  expect(world.etSaw.every((r) => new URL(r.url).pathname.startsWith('/players/jonas-beispiel-99002/'))).toBe(true);
});

test('Fetch all on pgatour.com picks tours and seasons in the menus the page draws, on Results and on Stats', async ({ context, world, extensionId }) => {
  test.setTimeout(300_000);
  world.pro.player = 'Max Erfunden';
  await pairForPro(context, extensionId);
  const page = await context.newPage();
  await page.goto(PGA_OVERVIEW);
  await page.locator('#results').click();
  const line = page.getByTestId('season-line');
  await expect(line).toContainText('Golf Stats Sync: send this page to Example App');
  await line.getByTestId('season-fetch-all').click();
  await expect(line).toContainText('Fetching all for you: step', { timeout: 10_000 });
  // The season picked in the page's own menu, as he would: its menu button shows it.
  await expect(page.locator('[data-picker="Season"] .shows')).toHaveText('2025', { timeout: 60_000 });
  await expect(page).toHaveURL(/\/player\/99002\/max-erfunden\/stats$/, { timeout: 200_000 });
  await expect(line).toContainText('Sent to Example App.', { timeout: 200_000 });
  // One page for the PGA Tour with both seasons; the Korn Ferry Tour he didn't play sends nothing.
  expect(world.pro.imports.map((b) => b.site)).toEqual(['tour:pga_tour']);
  const [pga] = world.pro.imports;
  expect(pga?.tournaments?.map((t) => t.ref)).toEqual(['pga-R2026904', 'pga-R2026902', 'pga-R2025910']);
  expect(pga?.stats?.map((s) => s.season)).toEqual([2026, 2025]);
  expect(pga?.rankings?.[0]).toMatchObject({ source: 'tour:pga_tour', rank: 83 });
  for (const other of ['O. Erfunden', 'Zurich', '$1,234,567']) expect(JSON.stringify(world.pro.imports)).not.toContain(other);
  expect(new Set(world.seasonSaw.map((r) => r.type))).toEqual(new Set(['document']));
});
