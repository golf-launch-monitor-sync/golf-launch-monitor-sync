// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The shape recorder as a developer (or a tester) meets it: the extension's options page, a portal of the list, *Start*
 * (the portal's address is granted at install in this build only: no one answers the browser's prompt here), the
 * made-up FSX Live in the tab it opens - whose own script signs in, fetches and uses XMLHttpRequest, and must still work
 * -, *Stop*, the preview, a tick, *I have read the file*, *Save*. Nothing of the made-up person reaches the file, and
 * the recorder asks the portal nothing of its own.
 */

import { readFileSync } from 'node:fs';
import { PERSON, SECRETS } from '../../../packages/shape/src/testing.ts';
import { expect, test } from './fixture.ts';

test('records the shape of a portal, shows it before saving, and saves no value of the player', async ({ context, world, extensionId }) => {
  const dev = await context.newPage();
  await dev.goto(`chrome-extension://${extensionId}/shape.html`);
  await expect(dev.locator('h1')).toHaveText('Developer tools: record a portal’s shape');
  await expect(dev.getByTestId('shape-portal-fsx-live')).toBeChecked();
  const before = new Set(context.pages());
  await dev.getByTestId('shape-start').click();
  await expect(dev.getByTestId('shape-recording')).toBeVisible();
  // The tab the recorder opened: it loads its first address before the test's routes reach it (fixture.ts, OFFLINE),
  // so it is loaded again through them - as the player would reload it.
  await expect.poll(() => context.pages().filter((p) => !before.has(p)).length).toBe(1);
  const portal = context.pages().find((p) => !before.has(p))!;
  if (!portal.url().startsWith('https://performance.foresightsports.com/')) await portal.goto('https://performance.foresightsports.com/');
  // The page works as without the recorder: its own fetch and its own XMLHttpRequest got their answers.
  await expect(portal.locator('#count')).toHaveText('2 sessions');
  await expect(portal.locator('#who')).toHaveText(`${PERSON.first} ${PERSON.last}`);
  await expect(dev.getByTestId('shape-recording')).toContainText(/Recording on Foresight FSX Live since .*: 2 calls to 2 addresses seen\./);

  await dev.getByTestId('shape-stop').click();
  await expect(dev.getByTestId('shape-stopped')).toHaveText('Recorded on Foresight FSX Live: 2 calls to 2 addresses.');
  const preview = dev.getByTestId('shape-preview');
  const first = (await preview.textContent()) ?? '';
  expect(first).toContain('"path": "/api/v1/players/{value}/sessions"');
  expect(first).toContain('"auth": [');
  expect(first).toContain('"path": "/api/v1/profile"');
  expect(first).toMatch(/"via": \[\s*"xhr"\s*\]/);
  for (const s of SECRETS) expect({ s, found: first.toLowerCase().includes(s.toLowerCase()) }).toEqual({ s, found: false });

  // Short repeating values only with a tick - and a tick means reading the file again.
  const save = dev.getByTestId('shape-save');
  await expect(save).toBeDisabled();
  await dev.getByTestId('shape-read').check();
  await expect(save).toBeEnabled();
  await dev.locator('[data-test="shape-candidate"][data-field="$.items[].shots[].club"]').check();
  await expect(save).toBeDisabled();
  await expect(preview).toContainText('"Driver"');
  await dev.getByTestId('shape-read').check();
  const downloading = dev.waitForEvent('download');
  await save.click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^shape-fsx-live-\d{4}-\d{2}-\d{2}\.json$/);
  const saved = readFileSync((await file.path())!, 'utf8');
  expect(saved).toBe((await preview.textContent()) ?? '');
  for (const s of SECRETS.filter((x) => x !== 'Range session')) expect({ s, found: saved.toLowerCase().includes(s.toLowerCase()) }).toEqual({ s, found: false });
  await expect(dev.getByTestId('shape-saved')).toContainText('in your downloads');

  // The portal saw its page and the page's two calls - nothing of the recorder's own.
  expect(world.shapeSaw.map((r) => `${r.method} ${r.path} ${r.type}`)).toEqual([
    'GET / document',
    `GET /api/v1/players/${PERSON.slug}/sessions fetch`,
    'GET /api/v1/profile xhr',
  ]);

  // Stopped, the scripts are off the portal: a page loaded now posts nothing.
  await dev.getByTestId('shape-discard').click();
  await expect(dev.getByTestId('shape-start')).toBeVisible();
  await portal.reload();
  await expect(portal.locator('#count')).toHaveText('2 sessions');
  await dev.waitForTimeout(500);
  await expect(dev.getByTestId('shape-start')).toBeVisible();
});
