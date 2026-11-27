// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap record as a player meets it (spec/hcp.md): the app's pairing page with kind=hcp, the connect window,
 * then golf.de's own pages - made up, asking their own API as golf.de's do - with the extension reading along, its line
 * on the page, *Send*, and the popup. The extension must never ask golf.de anything itself.
 */

import { entry, PERSONAL } from '../../../packages/provider-golfde/src/testing.ts';
import { MY_AREA_URL as MY_AREA } from '../../../packages/provider-golfde/src/observe.ts';
import { GOLFDE_HISTORY, GOLFDE_RESULTS, HCP_CODE, HCP_TARGET, pairUrl } from '../../../tools/e2e/world.ts';
import { chooseService, connectWindow, expect, popup, test } from './fixture.ts';

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
  // The first step: the app by its address, and one button by the kind the pairing names - its tap is the yes.
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'service');
  await expect(connect.getByTestId('wizard-title')).toHaveText('Connect with app.example.org');
  await expect(connect.getByTestId('service-golfde')).toHaveText('Connect handicap record');
  await connect.getByTestId('service-golfde').click();
  // Then the same steps as for a launch monitor. golf.de's page was open in this browser before (signed in), so the
  // account is known already: the step is its question, and nothing goes out before the answer.
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'account');
  await expect(connect.getByTestId('wizard-progress')).toHaveText('Step 3 of 5');
  // Only the account and yes or no: the title asks.
  await expect(connect.getByTestId('unconfirmed')).toHaveCount(0);
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
  await chooseService(connect, 'golfde');
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

test('golf.de’s reports as since dgv-reports-js 1.23 (urql, each request aborted once read): signed in again, the account is asked', async ({ context, world, extensionId }) => {
  world.golfde.urql = true;
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');

  // Signed out earlier the same evening: the line says so.
  world.golfde.signedIn = false;
  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  await expect(page.getByTestId('golfde-line')).toContainText('not signed in on golf.de');

  // Signed in again: the page's own answers are read along although the page aborts each request once it read it.
  world.golfde.signedIn = true;
  await page.reload();
  await expect(connect.getByTestId('hcp-confirm')).toContainText('Handicap index 8.1');
  await expect(page.getByTestId('golfde-line')).not.toContainText('not signed in');
  await connect.getByTestId('hcp-confirm-yes').click();
  await expect(connect.getByTestId('wizard-brought')).toHaveText('3 results sent to Example App', { timeout: 30_000 });
  expect(world.golfde.apiSaw.slice(-3).map((r) => r.op)).toEqual(['GetMemberDetails', 'GetHandicapHistorySheet', 'GetScoringRecords']);
  expect(world.golfde.apiSaw.every((r) => r.page)).toBe(true);
});

test('not my account: nothing of it is kept or sent, and the line says so', async ({ context, world, extensionId }) => {
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');

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

test('Fetch all: one tap after signing in, and the extension does the clicks - golf.de’s own links and button, nothing asked by itself', async ({ context, world, extensionId }) => {
  test.setTimeout(120_000);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  // Twelve results on two pages of the History Sheet: a tournament of two rounds, two more, a registered private round,
  // and seven from three years ago (their lists aren't opened).
  world.golfde.built = true;
  world.golfde.nodes = [
    entry({ scorecardTournamentNumber: 5103, tournamentDate: day(10) }),
    entry({ scorecardTournamentNumber: 5101, tournamentRound: 2, tournamentDate: day(40) }),
    entry({ scorecardTournamentNumber: 5101, tournamentRound: 1, tournamentDate: day(41) }),
    entry({ scorecardTournamentNumber: 5102, tournamentDate: day(200) }),
    entry({ scorecardTournamentNumber: 5199, tournamentType: 8, tournamentName: `RPR: ${PERSONAL.marker}`, tournamentDate: day(300) }),
    ...Array.from({ length: 7 }, (_, i) => entry({ scorecardTournamentNumber: 4000 + i, tournamentDate: day(1100 + i * 7) })),
  ];

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');
  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  // Before the yes to the account: no Fetch all.
  await expect(page.getByTestId('golfde-confirm')).toBeVisible();
  await expect(page.getByTestId('golfde-fetch-all')).toHaveCount(0);
  await expect(connect.getByTestId('hcp-confirm')).toContainText('Handicap index 8.1');
  await connect.getByTestId('hcp-confirm-yes').click();
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'done', { timeout: 30_000 });
  // Page 1 (ten results) went with the yes.
  await expect.poll(() => world.hcp.results.size).toBe(10);
  const before = world.hcp.imports.length;
  const asked = world.golfde.apiSaw.length;

  await page.getByTestId('golfde-fetch-all').click();
  const line = page.getByTestId('golfde-line');
  await expect(line).toContainText('fetching all for Example App');
  await expect(page.getByTestId('golfde-stop')).toBeVisible();
  // Done: every page, the Scoring Record, three result lists - then one send with all of it.
  await expect(line).toContainText('12 results seen · Example App has them all', { timeout: 90_000 });
  expect(world.hcp.imports.length - before).toBe(1);
  expect(world.hcp.results.size).toBe(12);
  const placed = [...world.hcp.results.values()].filter((r) => r.place !== undefined);
  expect(placed).toHaveLength(3);
  // What golf.de's API saw since the tap: only its page's own requests, in the order a player's clicks make them.
  const saw = world.golfde.apiSaw.slice(asked);
  expect(saw.every((r) => r.page)).toBe(true);
  expect(saw.map((r) => r.op ?? new URL(r.url).pathname)).toEqual([
    'GetMemberDetails',
    'GetHandicapHistorySheet',
    'GetHandicapHistorySheet',
    'GetScoringRecords',
    '/v1.0/tournaments/5103/results',
    '/v1.0/tournaments/5101/results',
    '/v1.0/tournaments/5102/results',
  ]);
  // The tab is on the last list; nothing of anyone's name went to the app.
  expect(page.url()).toContain('#/5102/ergebnisse');
  const sent = JSON.stringify(world.hcp.received);
  for (const v of Object.values(PERSONAL)) expect(sent).not.toContain(v);

  // Again at once: the History Sheet is read again, but no list is opened a second time.
  const again = world.golfde.apiSaw.length;
  await page.getByTestId('golfde-fetch-all').click();
  await expect(line).toContainText('fetching all');
  await expect(line).toContainText('has them all', { timeout: 60_000 });
  expect(world.golfde.apiSaw.slice(again).some((r) => r.url.includes('/results'))).toBe(false);
});

test('Fetch all stops when golf.de signs the player out, and on Stop', async ({ context, world, extensionId }) => {
  test.setTimeout(120_000);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  world.golfde.built = true;
  world.golfde.nodes = Array.from({ length: 25 }, (_, i) => entry({ scorecardTournamentNumber: 6000 + i, tournamentDate: day(5 + i) }));
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');
  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  await connect.getByTestId('hcp-confirm-yes').click();
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'done', { timeout: 30_000 });

  // Stop: ends at once, what was read goes out.
  await page.getByTestId('golfde-fetch-all').click();
  await expect(page.getByTestId('golfde-stop')).toBeVisible();
  await page.getByTestId('golfde-stop').click();
  const line = page.getByTestId('golfde-line');
  await expect(line).not.toContainText('fetching all');
  await expect(page.getByTestId('golfde-fetch-all')).toBeVisible();

  // Signed out on the way: stopped, and the line says why.
  await page.getByTestId('golfde-fetch-all').click();
  await expect(line).toContainText('fetching all');
  world.golfde.signedIn = false;
  await expect(line).toContainText('stopped: not signed in on golf.de any more', { timeout: 60_000 });
  const n = world.golfde.apiSaw.length;
  await page.waitForTimeout(8000);
  expect(world.golfde.apiSaw.length).toBe(n); // nothing more clicked
});

test('by itself when due (spec 1.16.0): a background tab, the same run, the tab closed - signed out: nothing, and it waits for the player', async ({ context, world, extensionId, background }) => {
  test.setTimeout(150_000);
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  world.golfde.built = true;
  world.golfde.nodes = [entry({ scorecardTournamentNumber: 5203, tournamentDate: day(12) }), entry({ scorecardTournamentNumber: 5202, tournamentDate: day(90) })];
  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(`${pairUrl(HCP_TARGET, HCP_CODE)}&kind=hcp`);
  const connect = await windowOpens;
  await chooseService(connect, 'golfde');
  const page = await context.newPage();
  await page.goto(GOLFDE_HISTORY);
  await connect.getByTestId('hcp-confirm-yes').click();
  await expect(connect.getByTestId('wizard')).toHaveAttribute('data-step', 'done', { timeout: 30_000 });
  await expect.poll(() => world.hcp.results.size).toBe(2);
  await page.close(); // the player leaves golf.de
  await pairPage.close();

  // golf.de's tabs as the browser has them (the extension may not read their addresses: no `tabs` permission).
  // A tab the extension opens loads its first address before the test's routes reach it (Playwright attaches to it
  // late), so it shows an error page here - not in a real browser. Loaded once more, golf.de's made-up page answers.
  const routed = async () => {
    for (let i = 0; i < 60; i++) {
      const p = context.pages().find((x) => !x.isClosed() && x.url().startsWith('chrome-error://'));
      if (p) {
        await p.goto(MY_AREA).catch(() => undefined);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };
  const golfdeTabs = async () => context.pages().filter((p) => !p.isClosed() && p.url().includes('golf.de')).map((p) => p.url());
  const look = async () => {
    // As if the half hour since the last look had passed (the look's time lives in the extension's storage).
    await background.evaluate(async () => {
      const raw = (await chrome.storage.local.get('glmsync/hcp/auto'))['glmsync/hcp/auto'];
      const a = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : {};
      delete a.looked;
      await chrome.storage.local.set({ 'glmsync/hcp/auto': JSON.stringify(a) });
      await chrome.alarms.create('hcp-auto-look', { when: Date.now() + 200 });
    });
  };

  // Not due: the app is asked (timer), golf.de isn't opened.
  const plans = world.hcp.plans.length;
  await look();
  await expect.poll(() => world.hcp.plans.slice(plans).some((p) => p.reason === 'timer'), { timeout: 30_000 }).toBe(true);
  await new Promise((r) => setTimeout(r, 1500));
  expect(await golfdeTabs()).toEqual([]);

  // Due: Mein Bereich in a tab that doesn't take the focus, the run there, one send at its end, the tab closed.
  world.hcp.due = true;
  const imports = world.hcp.imports.length;
  const asked = world.golfde.apiSaw.length;
  await look();
  await routed();
  await expect.poll(async () => (await golfdeTabs()).length, { timeout: 30_000 }).toBe(1);
  // It didn't take the focus (headless pages all say visible: the browser's own word on the tab).
  expect(await background.evaluate(async () => {
    const t = (await chrome.storage.session.get('glmsync/hcp/auto-tab'))['glmsync/hcp/auto-tab'] as { id: number };
    return (await chrome.tabs.get(t.id)).active;
  })).toBe(false);
  await expect.poll(() => world.hcp.imports.length, { timeout: 90_000 }).toBe(imports + 1);
  await expect.poll(async () => (await golfdeTabs()).length, { timeout: 20_000 }).toBe(0);
  expect(world.hcp.due).toBe(false); // the app's plan moved on
  const placed = [...world.hcp.results.values()].filter((r) => r.place !== undefined);
  expect(placed).toHaveLength(2);
  const saw = world.golfde.apiSaw.slice(asked);
  expect(saw.every((r) => r.page)).toBe(true); // only golf.de's page's own requests
  expect(saw.filter((r) => r.url.includes('/results'))).toHaveLength(2);
  const sent = JSON.stringify(world.hcp.received);
  for (const v of Object.values(PERSONAL)) expect(sent).not.toContain(v);

  // Signed out meanwhile: the tab opens, golf.de's page says so, the run stops there, nothing is signed in, the tab goes.
  world.hcp.due = true;
  world.golfde.signedIn = false;
  await look();
  await routed();
  await expect.poll(async () => (await golfdeTabs()).length, { timeout: 30_000 }).toBe(1);
  await expect.poll(() => world.hcp.notice?.code ?? null, { timeout: 60_000 }).toBe('signed_out');
  await expect.poll(async () => (await golfdeTabs()).length, { timeout: 20_000 }).toBe(0);
  // And then none by itself until the player has been on golf.de signed in again.
  const timerLooks = world.hcp.plans.filter((p) => p.reason === 'timer').length;
  await look();
  await new Promise((r) => setTimeout(r, 2500));
  expect(await golfdeTabs()).toEqual([]);
  expect(world.hcp.plans.filter((p) => p.reason === 'timer').length).toBe(timerLooks);

  // Switched off in the popup: it stays off.
  const pop = await popup(context, extensionId, 'hcp');
  await expect(pop.getByTestId('hcp-auto-fetch')).toBeChecked();
  await pop.getByTestId('hcp-auto-fetch').uncheck();
  await expect.poll(() => background.evaluate(async () => (await chrome.storage.local.get('glmsync/hcp/auto'))['glmsync/hcp/auto'])).toContain('"off":true');
});
