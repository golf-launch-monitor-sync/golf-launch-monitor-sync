// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension as a player meets it: the app's pairing page, the connect window, the Trackman
 * portal, "Is this you?", the sync, the popup - with a made-up Trackman and a made-up target app.
 */

import { CODE, pairUrl, PORTAL, TARGET } from '../../../tools/e2e/world.ts';
import { badgeText, connectWindow, expect, popup, test } from './fixture.ts';

test('pairs from the app’s page, takes the sign-in from the portal, asks, and syncs', async ({ context, world, extensionId, background }) => {
  // The app sends the player to the web app's pairing page; the extension picks the code up.
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  await expect(pairPage.getByTestId('pair-status')).toHaveText(/The extension takes over/);
  const connect = await windowOpens;
  await expect(connect.getByText('The app at app.example.org asks for your Trackman data.')).toBeVisible();
  await connect.getByTestId('allow').click();
  await expect(connect.getByTestId('paired')).toHaveText('Connected with Example App.');
  await expect(pairPage.getByTestId('pair-status')).toHaveText('Connected with Example App. You can close this page.');
  // The code left the address bar once it was used.
  await expect.poll(() => pairPage.url()).not.toContain(CODE);
  expect(world.target.tokens.size).toBe(1);
  // Nothing to fetch with yet: the icon says sign in.
  await expect.poll(() => badgeText(background)).toBe('!');

  // The player opens the portal, signed in: the extension takes the key, and asks whose it is.
  const key = world.key();
  world.portal.token = key;
  await connect.getByTestId('open-portal').click();
  await expect(connect.getByTestId('confirm')).toContainText('Is this your Trackman account?');
  await expect(connect.getByTestId('confirm')).toContainText('Alex Example');
  await expect(connect.getByTestId('confirm')).toContainText('2 activities, the newest on 15 Nov 2026 at Example Range');
  await expect.poll(() => badgeText(background)).toBe('?');
  expect(world.target.imports).toHaveLength(0);

  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('2 new sessions, 4 shots', { timeout: 60_000 });
  expect(world.target.sessions.size).toBe(2);
  await expect.poll(() => badgeText(background)).toBe('');

  // The key went to Trackman only, the import token to the target only.
  expect(world.targetSaw()).not.toContain(key);
  for (const r of world.tm.requests) expect(r.headers.Authorization).toBe(`Bearer ${key}`);
  const importToken = [...world.target.tokens][0] as string;
  expect(JSON.stringify(world.tm.requests)).not.toContain(importToken);
  // Every sync asked the plan first.
  expect(world.target.asked.map((a) => a.reason)).toContain('connect');

  // The popup: connected, the guard's counts, the log to export.
  const pop = await popup(context, extensionId);
  await expect(pop.getByTestId('pairing')).toContainText('Connected with Example App');
  await expect(pop.getByTestId('counts')).toHaveText(`Last hour ${world.tm.count()} of 60 · last 24 hours ${world.tm.count()} of 300`);
  const download = pop.waitForEvent('download');
  await pop.getByTestId('export-log').click();
  const log = JSON.parse(await (await (await download).createReadStream()).toArray().then((b) => Buffer.concat(b).toString('utf8')));
  expect(log.format).toBe('glmsync-guard-log/1');
  expect(JSON.stringify(log)).not.toContain('Alex Example');
});

test('a key the portal only sends with its calls is found too; the same account needs no second question', async ({ context, world, extensionId }) => {
  world.target.accountRef = null;
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.getByTestId('allow').click();
  await expect(connect.getByTestId('paired')).toBeVisible();

  world.portal.mode = 'fetch';
  world.portal.token = world.key();
  const portal = await context.newPage();
  await portal.goto(PORTAL);
  await expect(connect.getByTestId('confirm-yes')).toBeVisible();
  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('2 new sessions', { timeout: 60_000 });

  // A week later the portal has a new key of the same account: no question, it simply goes on.
  const whoAsked = world.tm.count('Who');
  world.portal.mode = 'storage';
  world.portal.token = world.key();
  await portal.reload();
  const pop = await popup(context, extensionId);
  await expect(pop.getByTestId('key-ready')).toBeVisible();
  expect(world.tm.count('Who')).toBe(whoAsked);
});

test('says when the sign-in ran out, and when the app ended the connection', async ({ context, world, extensionId, background }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.getByTestId('allow').click();
  const key = world.key();
  world.portal.token = key;
  await (await context.newPage()).goto(PORTAL);
  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('2 new sessions', { timeout: 60_000 });
  await connect.close();

  // Trackman no longer takes the key: the sync says so, the app is told, the icon asks to sign in.
  world.tm.tokens.delete(key);
  world.tm.activities.unshift({ id: 'S3', time: new Date().toISOString(), kind: 'RANGE_PRACTICE' });
  const pop = await popup(context, extensionId);
  await pop.getByTestId('fetch-now').click();
  await expect(pop.getByTestId('key-expired')).toBeVisible({ timeout: 60_000 });
  expect(world.target.imports.at(-1)?.notice?.code).toBe('auth_expired');
  await expect.poll(() => badgeText(background)).toBe('!');

  // The player ends the connection in the app: the extension lets go of it.
  world.tm.tokens.add(key);
  world.target.disconnected = true;
  await pop.evaluate(() => chrome.runtime.sendMessage({ type: 'run' }));
  await expect(pop.getByTestId('ended')).toContainText('Example App ended the connection');
  await expect(pop.getByTestId('no-pairings')).toBeVisible();
});

test('the player can say no in the connect window, and disconnect in the popup', async ({ context, world, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.getByTestId('cancel').click();
  await expect(pairPage.getByTestId('pair-status')).toHaveText(/no longer here/);
  expect(world.target.tokens.size).toBe(0);

  world.target.codes.add('SECOND01');
  const again = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl(TARGET, 'SECOND01'));
  await pairPage.reload();
  const c2 = await again;
  await c2.getByTestId('allow').click();
  await expect(c2.getByTestId('paired')).toBeVisible();
  const pop = await popup(context, extensionId);
  await pop.getByTestId('disconnect').click();
  await pop.getByTestId('disconnect-yes').click();
  await expect(pop.getByTestId('no-pairings')).toBeVisible();
  expect(world.target.tokens.size).toBe(0);
});

test('in the background it asks the app’s plan, and Trackman only when the plan says so', async ({ context, world, extensionId, background }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.getByTestId('allow').click();
  world.portal.token = world.key();
  await (await context.newPage()).goto(PORTAL);
  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('2 new sessions', { timeout: 60_000 });

  // The app's plan says not now: the timer asks it, and nothing else.
  const asked = world.tm.count();
  const plan = world.target.opts as { plan?: () => Record<string, unknown> };
  plan.plan = () => ({ due: false, history: { done: true } });
  await background.evaluate(() => chrome.alarms.create('timer', { when: Date.now() + 200 }));
  await expect.poll(() => world.target.asked.filter((a) => a.reason === 'timer').length, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(world.tm.count()).toBe(asked);

  // Now it says due (a new session at Trackman): the next look fetches it.
  delete plan.plan;
  world.tm.activities.unshift({ id: 'S3', time: new Date().toISOString(), kind: 'RANGE_PRACTICE' });
  await background.evaluate(() => chrome.alarms.create('timer', { when: Date.now() + 200 }));
  await expect.poll(() => world.target.sessions.has('S3'), { timeout: 60_000 }).toBe(true);
});

test.describe('in German', () => {
  test.use({ locale: 'de-DE' });

  test('the popup speaks the browser’s language', async ({ context, extensionId }) => {
    const pop = await popup(context, extensionId);
    await expect(pop.getByTestId('no-pairings')).toContainText('Noch mit keiner App verbunden');
    await expect(pop.getByTestId('open-portal')).toHaveText('Trackman-Portal öffnen');
  });
});
