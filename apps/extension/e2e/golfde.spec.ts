// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap record as a player meets it (spec/hcp.md): the app's pairing page with kind=hcp, the connect window,
 * then golf.de's own pages - made up, asking their own API as golf.de's do - with the extension reading along, its line
 * on the page, *Send*, and the popup. The extension must never ask golf.de anything itself.
 */

import { PERSONAL } from '../../../packages/provider-golfde/src/testing.ts';
import { GOLFDE_HISTORY, GOLFDE_RESULTS, HCP_CODE, HCP_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { allowAndChoose, connectWindow, expect, popup, test } from './fixture.ts';

test('pairs for the handicap record, reads along on golf.de, sends on Send, and asks golf.de nothing itself', async ({ context, world, extensionId }) => {
  // Not connected yet: golf.de's page shows no line at all.
  const before = await context.newPage();
  await before.goto(GOLFDE_HISTORY);
  await expect.poll(() => world.golfde.apiSaw.length).toBe(3);
  await before.waitForTimeout(1000);
  await expect(before.getByTestId('golfde-line')).toHaveCount(0);
  await before.close();

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await expect(connect.getByTestId('wizard-title')).toHaveText('Connect with app.example.org?');
  await connect.getByTestId('allow').click();
  // What to connect: the handicap record asks for golf.de.
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('wizard')).toContainText('Handicap record');
  await connect.getByTestId('service-golfde').click();
  // Then the same steps as for a launch monitor. golf.de's page was open in this browser before (signed in), so the
  // account is known already: the step is its question, and nothing goes out before the answer.
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'account');
  await expect(connect.getByTestId('wizard-progress')).toHaveText('Step 4 of 6');
  await expect(connect.getByTestId('unconfirmed')).toHaveText('Not yet connected with Example App – confirm your account');
  await expect(connect.getByTestId('finished')).toHaveCount(0);
  expect(world.hcp.tokens.size).toBe(1);
  expect(world.target.tokens.size).toBe(0); // the launch monitor API heard nothing

  // The player opens the History Sheet: the page asks golf.de's API itself; the extension reads along - and before
  // the player said the account is theirs, the line counts nothing and nothing goes to the app.
  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  const line = page.getByTestId('golfde-line');
  await expect(line).toContainText('Golf Stats Sync: not yet connected with Example App – confirm your account');
  await expect(line).not.toContainText('results');
  await expect(page.getByTestId('golfde-send')).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(world.hcp.imports).toHaveLength(0);

  // *Confirm* on the line brings the connect window to the front; the yes is given there.
  await page.getByTestId('golfde-confirm').click();
  await expect(connect.getByTestId('wizard-title')).toHaveText('Is this your golf.de account?');
  await expect(connect.getByTestId('hcp-confirm')).toContainText('Handicap index 8.1, as of');
  await connect.getByTestId('hcp-confirm-yes').click();
  // What was seen goes right after the yes; the steps say how much.
  await expect(connect.getByTestId('wizard-brought')).toHaveText('3 results sent to Example App', { timeout: 30_000 });
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'done');
  await expect(line).toContainText('Example App has them all');
  expect(world.hcp.results.size).toBe(3);
  const own = [...world.hcp.results.values()].find((r) => r.ref === world.golfde.own.resultGuid);
  expect(own).toMatchObject({ played_on: '2026-10-03', gbe: 85, sd: 11.2 });
  expect(world.hcp.index).toMatchObject({ value: 8.1, low: 7.4 });

  // The result list: the player's own place, sent with the next Send.
  const list = await context.newPage();
  await list.goto(GOLFDE_RESULTS);
  await expect(list.getByTestId('golfde-line')).toContainText('1 new');
  await list.getByTestId('golfde-send').click();
  await expect(list.getByTestId('golfde-line')).toContainText('has them all');
  expect([...world.hcp.results.values()].find((r) => r.ref === world.golfde.own.resultGuid)).toMatchObject({ place: 7, field: 42 });

  // golf.de's API saw only golf.de's page's own requests: none of the extension's.
  expect(world.golfde.apiSaw.length).toBe(3 + 3 + 1);
  expect(world.golfde.apiSaw.every((r) => r.page)).toBe(true);
  // And the app got no name, no number of anyone.
  const sent = JSON.stringify(world.hcp.received);
  for (const v of Object.values(PERSONAL)) expect(sent).not.toContain(v);
  expect(world.hcp.plans.every((p) => p.reason === 'manual')).toBe(true);

  // The popup shows it, and disconnects it.
  const pop = await popup(context, extensionId);
  await expect(pop.locator('[data-test="connection"][data-id="hcp"]')).toContainText('golf.de');
  await pop.locator('[data-test="connection"][data-id="hcp"]').click();
  await expect(pop.getByTestId('hcp-pairing')).toContainText('Connected with Example App');
  await expect(pop.getByTestId('hcp-seen')).toContainText('3 results seen on golf.de, 0 not sent yet.');
  await pop.getByTestId('hcp-disconnect').click();
  await pop.getByTestId('hcp-disconnect-yes').click();
  await expect(pop.getByTestId('hcp-pairing')).toHaveCount(0);
  expect(world.hcp.tokens.size).toBe(0);
});

test('signed out on golf.de: the line says so, and nothing goes to the app without an account', async ({ context, world, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await allowAndChoose(connect, 'golfde');
  // golf.de not opened yet in this browser: the first step is its sign-in.
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(connect.getByTestId('unconfirmed')).toHaveText('Not yet connected with Example App – sign in at golf.de');
  await expect(connect.getByTestId('hcp-open')).toBeVisible();

  world.golfde.signedIn = false;
  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  await expect(page.getByTestId('golfde-line')).toContainText('not signed in on golf.de');
  await page.waitForTimeout(500);
  expect(world.hcp.imports).toHaveLength(0); // nothing seen, and no account to tell it for yet
});

test('not my account: nothing of it is kept or sent, and the line says so', async ({ context, world, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await allowAndChoose(connect, 'golfde');

  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  await expect(connect.getByTestId('hcp-confirm')).toContainText('Handicap index 8.1');
  await connect.getByTestId('hcp-confirm-no').click();
  await expect(connect.getByTestId('hcp-rejected')).toContainText('nothing of this account is sent');
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await page.reload();
  await expect(page.getByTestId('golfde-line')).toContainText('not your account – nothing goes to Example App');
  await page.waitForTimeout(1000);
  expect(world.hcp.imports).toHaveLength(0);
});
