// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension as a player meets it: the app's pairing page, the connect window, the Trackman
 * portal, "Is this you?", the sync, the popup - with a made-up Trackman and a made-up target app.
 */

import { CODE, pairUrl, PORTAL, TARGET } from '../../../tools/e2e/world.ts';
import { chooseService, badgeText, connectWindow, expect, popup, test } from './fixture.ts';

test('pairs from the app’s page, takes the sign-in from the portal, asks, and syncs', async ({ context, world, extensionId, background }) => {
  // The app sends the player to the web app's pairing page; the extension picks the code up.
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  await expect(pairPage.getByTestId('pair-status')).toHaveText(/The extension takes over/);
  const connect = await windowOpens;
  // Connecting step by step, one button each: (1) the app asks by its address, and the tap on what to connect is the
  // yes - no step of its own to allow.
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('wizard-title')).toHaveText('Connect with app.example.org');
  await expect(connect.getByTestId('wizard-progress')).toHaveText('Step 1 of 5');
  await expect(connect.locator('ol.steps li')).toHaveText(['Service', 'Sign in', 'Account', 'First data', 'Done']);
  await expect(connect.getByTestId('offer-what')).toHaveText('Your data then goes to app.example.org – nowhere else.');
  await expect(connect.getByTestId('allow')).toHaveCount(0);
  // One service fits the pairing: one button by its kind.
  await expect(connect.getByTestId('service-trackman')).toHaveText('Connect launch monitor');
  // The connect window is a tab right beside the pairing page, in the same browser window, in front - not a
  // window of its own, which went full screen on a Mac (17 Nov).
  // Without the `tabs` permission the browser shows the extension no tab's address it has no host permission for,
  // its own pages included: the connect window is found by the id the background keeps.
  const tabs = () =>
    background.evaluate(async () => {
      const own = (await chrome.storage.session.get('glmsync/connect-tab'))['glmsync/connect-tab'];
      return (await chrome.tabs.query({})).map((t) => ({ url: t.id === own ? 'connect.html' : (t.pendingUrl ?? t.url ?? ''), windowId: t.windowId, index: t.index, active: t.active }));
    });
  const placed = async () => {
    const all = await tabs();
    const pair = all.find((t) => t.url.includes('/pair'));
    const win = all.find((t) => t.url === 'connect.html');
    return pair && win ? { same: pair.windowId === win.windowId, beside: win.index === pair.index + 1, active: win.active } : null;
  };
  await expect.poll(placed).toEqual({ same: true, beside: true, active: true });
  expect(await background.evaluate(async () => (await chrome.windows.getAll({ windowTypes: ['popup'] })).length)).toBe(0);
  // Nothing is paired before this button.
  expect(world.target.tokens.size).toBe(0);
  await connect.getByTestId('service-trackman').click();
  await expect(pairPage.getByTestId('pair-status')).toHaveText('Connected with Example App. You can close this page.');
  // The code left the address bar once it was used.
  await expect.poll(() => pairPage.url()).not.toContain(CODE);
  expect(world.target.tokens.size).toBe(1);
  // Nothing to fetch with yet: the icon says sign in, and connecting goes on as steps - the first is the sign-in.
  await expect.poll(() => badgeText(background)).toBe('!');
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(connect.getByTestId('wizard-progress')).toHaveText('Step 2 of 5');
  await expect(connect.getByTestId('unconfirmed')).toHaveText('Not yet connected with Example App – sign in at Trackman');

  // The player opens the portal, signed in: the extension takes the key, and asks whose it is.
  const key = world.key();
  world.portal.token = key;
  await connect.getByTestId('open-portal').click();
  // Asked of the browser itself: a tab the extension opened may reach the test late or not at all.
  await expect.poll(() => background.evaluate(async (url) => (await chrome.tabs.query({})).some((t) => (t.pendingUrl ?? t.url ?? '').startsWith(url)), PORTAL)).toBe(true);
  // In the connect window's browser window, beside it and in front (17 Nov: it opened unseen in another window).
  const portalPlaced = async () => {
    const all = await tabs();
    const win = all.find((t) => t.url === 'connect.html');
    const portal = all.find((t) => t.url.startsWith(PORTAL));
    return win && portal ? { same: win.windowId === portal.windowId, beside: portal.index === win.index + 1, active: portal.active } : null;
  };
  await expect.poll(portalPlaced).toEqual({ same: true, beside: true, active: true });
  // The tab the extension opened may be attached to the test a moment late; the player's own tab is certain.
  await (await context.newPage()).goto(PORTAL);
  await expect(connect.getByTestId('wizard-title')).toHaveText('Is this your Trackman account?');
  await expect(connect.getByTestId('wizard-progress')).toHaveText('Step 3 of 5');
  await expect(connect.getByTestId('confirm')).toContainText('Alex Example');
  await expect(connect.getByTestId('confirm')).toContainText('Newest activity on 15 Nov 2026 at Example Range');
  // Before the yes nothing that looks like data on its way (a tester once took "150 activities" for synced) - and on
  // the step only the account and yes or no: the title asks, no line above it, no portal, no test code.
  await expect(connect.getByTestId('unconfirmed')).toHaveCount(0);
  await expect(connect.locator('#status [data-test="wizard"] button')).toHaveText(['Yes, that’s me', 'No']);
  await expect(connect.getByTestId('open-portal')).toHaveCount(0);
  await expect(connect.getByTestId('test-enter')).toHaveCount(0);
  await expect(connect.locator('main')).not.toContainText('activities');
  await expect(connect.getByTestId('counts')).toHaveCount(0);
  await expect(connect.getByTestId('last')).toHaveCount(0);
  await expect.poll(() => badgeText(background)).toBe('?');
  expect(world.target.imports).toHaveLength(0);

  await connect.getByTestId('confirm-yes').click();
  // The first data, shown plainly; then done, with the way back (the overview below it).
  await expect(connect.getByTestId('wizard-brought')).toHaveText('2 sessions, 0 rounds fetched', { timeout: 60_000 });
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'done');
  await expect(connect.getByTestId('unconfirmed')).toHaveCount(0);
  await expect(connect.getByTestId('wizard-back')).toHaveText('Back to Example App');
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

  // The popup: the list of connections, with the account's name and where it stands; its row opens the details -
  // connected, the guard's counts, the log to export.
  const pop = await popup(context, extensionId);
  const row = pop.getByTestId('connection');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Trackman · Alex Example');
  await expect(row).toContainText('to Example App');
  await expect(pop.getByTestId('connection-state')).toHaveText(/^(Running|Loading the history)$/);
  await row.click();
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
  await chooseService(connect);

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
  const pop = await popup(context, extensionId, 'lm');
  await expect(pop.getByTestId('key-ready')).toBeVisible();
  expect(world.tm.count('Who')).toBe(whoAsked);
});

test('says when the sign-in ran out, and when the app ended the connection', async ({ context, world, extensionId, background }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await chooseService(connect);
  const key = world.key();
  world.portal.token = key;
  await (await context.newPage()).goto(PORTAL);
  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('2 new sessions', { timeout: 60_000 });
  await connect.close();

  // Trackman no longer takes the key: the sync says so, the app is told, the icon asks to sign in.
  world.tm.tokens.delete(key);
  world.tm.activities.unshift({ id: 'S3', time: new Date().toISOString(), kind: 'RANGE_PRACTICE' });
  const pop = await popup(context, extensionId, 'lm');
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
  await chooseService(c2);
  const pop = await popup(context, extensionId);
  // Paired, never signed in: the row says the steps aren't through, and opens them.
  await expect(pop.getByTestId('connection-state')).toHaveText('Not set up yet – continue');
  await pop.getByTestId('connection').click();
  await expect(pop.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(pop.getByTestId('unconfirmed')).toHaveText('Not yet connected with Example App – sign in at Trackman');
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
  await chooseService(connect);
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

test('*Connect new* in the popup: the connect window at its first step, which the app’s page then fills', async ({ context, world, extensionId }) => {
  const pop = await popup(context, extensionId);
  await expect(pop.getByTestId('connections-none')).toHaveText('Nothing connected yet.');
  const opens = connectWindow(context, extensionId);
  await pop.getByTestId('connect-new').click();
  const connect = await opens;
  expect(new URL(connect.url()).searchParams.has('new')).toBe(true);
  // No app asked yet: where to start, and nothing else on the page (no sign-in, no apps).
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('wizard-title')).toHaveText('Start in your app');
  await expect(connect.getByTestId('offer-start')).toBeVisible();
  await expect(connect.getByTestId('service-trackman')).toHaveCount(0);
  await expect(connect.locator('#status')).toBeHidden();
  await expect(connect.getByTestId('test-enter')).toBeHidden();

  // The app's pairing page hands over its code: the same window asks.
  const pairPage = await context.newPage();
  await pairPage.goto(pairUrl());
  await expect(connect.getByTestId('wizard-title')).toHaveText('Connect with app.example.org', { timeout: 30_000 });
  await chooseService(connect);
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(connect.getByTestId('test-enter')).toBeVisible();
  expect(world.target.tokens.size).toBe(1);
});

test('the browser refuses the app’s address: the step stays with its sentence, and a second tap asks again', async ({ context, world, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  // The test build holds the address already; here the browser says no, as a player's *Deny* in its prompt would.
  await connect.evaluate(() => {
    const p = chrome.permissions as unknown as Record<string, unknown>;
    (globalThis as unknown as { realPermissions: unknown }).realPermissions = { request: p.request, contains: p.contains };
    p.request = () => Promise.resolve(false);
    p.contains = () => Promise.resolve(false);
  });
  await connect.getByTestId('service-trackman').click();
  await expect(connect.getByTestId('offer-error')).toHaveText('Without the permission for app.example.org the extension can’t send data there.');
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('service-trackman')).toBeEnabled();
  expect(world.target.tokens.size).toBe(0);
  // The player taps again and says yes this time: paired, on to the sign-in.
  await connect.evaluate(() => {
    const real = (globalThis as unknown as { realPermissions: Record<string, unknown> }).realPermissions;
    Object.assign(chrome.permissions as unknown as Record<string, unknown>, real);
  });
  await connect.getByTestId('service-trackman').click();
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'signin');
  await expect(connect.getByTestId('offer-error')).toHaveCount(0);
  expect(world.target.tokens.size).toBe(1);
});

test('a code that ran out: step 1 says so and where to start again', async ({ context, world, extensionId }) => {
  world.target.codes.clear();
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.getByTestId('service-trackman').click();
  await expect(connect.getByTestId('offer-error')).toHaveText('The code has run out or was used already. Start again in your app.');
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('offer-start')).toBeVisible();
  expect(world.target.tokens.size).toBe(0);
});

test.describe('in German', () => {
  test.use({ locale: 'de-DE' });

  test('the popup speaks the browser’s language', async ({ context, extensionId }) => {
    const pop = await popup(context, extensionId);
    await expect(pop.getByTestId('connect-new')).toHaveText('Neue Verbindung');
    await expect(pop.getByTestId('connections-none')).toHaveText('Noch nichts verbunden.');
  });

  test('*Neue Verbindung* in German: the steps and their words', async ({ context, extensionId }) => {
    const pop = await popup(context, extensionId);
    const opens = connectWindow(context, extensionId);
    await pop.getByTestId('connect-new').click();
    const connect = await opens;
    await expect(connect.getByTestId('wizard-title')).toHaveText('In deiner App starten');
    await expect(connect.getByTestId('wizard-progress')).toHaveText('Schritt 1 von 5');
    await expect(connect.locator('ol.steps li')).toHaveText(['Dienst', 'Anmelden', 'Konto', 'Erste Daten', 'Fertig']);
  });
});
