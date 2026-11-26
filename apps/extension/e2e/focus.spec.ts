// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The focus of a link (spec/deep-links.md, 1.18.0): an app sends the player here for one thing, and the connect window
 * shows only that thing from the first step to *Done* - a launch monitor's pairing nothing of golf.de's record, even
 * when that is connected already, and golf.de's pairing nothing of the launch monitor.
 */

import { CODE, HCP_CODE, HCP_TARGET, pairUrl, TARGET } from '../../../tools/e2e/world.ts';
import { chooseService, connectWindow, expect, test } from './fixture.ts';

test('a launch monitor’s pairing shows nothing of golf.de, though golf.de is connected', async ({ context, world, extensionId }) => {
  // golf.de first: its steps stand in the connect window (its sign-in, not done yet).
  const hcpPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await hcpPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');
  await expect(connect.getByTestId('hcp-open')).toBeVisible();
  // golf.de's pairing is golf.de's alone: nothing of a launch monitor.
  await expect(connect.getByTestId('service-trackman')).toHaveCount(0);
  await expect(connect.locator('#status')).toBeHidden();
  expect(world.hcp.tokens.size).toBe(1);

  // Now the app asks for the launch monitor: only its steps, nothing of golf.de's record above them.
  const lmPage = await context.newPage();
  await lmPage.goto(pairUrl(TARGET, CODE));
  await expect(connect.getByTestId('service-trackman')).toBeVisible();
  await expect(connect.getByTestId('hcp-open')).toBeHidden();
  // (golf.de's steps stay in the page behind the hidden panel: the visible ones are the launch monitor's.)
  await connect.getByTestId('service-trackman').click();
  await expect(connect.getByTestId('wizard').filter({ visible: true })).toHaveAttribute('data-step', 'signin');
  await expect(connect.getByTestId('unconfirmed').filter({ visible: true })).toHaveText('Not yet connected with Example App – sign in at Trackman');
  // The step names Trackman's sign-in only; golf.de's record stays out of sight until the player opens the popup.
  await expect(connect.getByTestId('hcp-open')).toBeHidden();
  await expect(connect.getByText('golf.de').filter({ visible: true })).toHaveCount(0);
  expect(world.target.tokens.size).toBe(1);
});
