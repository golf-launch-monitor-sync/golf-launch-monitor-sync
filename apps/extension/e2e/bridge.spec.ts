// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The bridge on a paired target's page (spec/page-bridge.md): the app's own page asks the extension where it
 * stands and to fetch now - the plan first, as always. Made-up Trackman and target; nothing leaves the machine.
 */

import type { Page } from '@playwright/test';
import { APP_PAGE, pairUrl, PORTAL } from '../../../tools/e2e/world.ts';
import { connectWindow, expect, popup, test } from './fixture.ts';

type Reply = Record<string, unknown>;

/** Posts a request into the page as its own script would, and collects the replies (two for a fetch that starts). */
function ask(page: Page, what: 'state' | 'fetch', id: string, waitMs = 60_000): Promise<Reply[]> {
  return page.evaluate(
    ([what, id, waitMs]) =>
      new Promise<Reply[]>((resolve) => {
        const replies: Reply[] = [];
        window.addEventListener('message', (e: MessageEvent) => {
          const d = e.data as Reply | null;
          if (e.source !== window || !d || d.glmsync !== 'reply' || d.id !== id) return;
          replies.push(d);
          if (d.answer !== 'started') resolve(replies);
        });
        window.postMessage({ glmsync: 'request', v: 1, id, ask: what }, location.origin);
        setTimeout(() => resolve(replies), waitMs);
      }),
    [what, id, waitMs] as const,
  );
}

const marked = (page: Page) => page.evaluate(() => document.documentElement.getAttribute('data-glmsync-bridge'));

test('the app’s page learns the sign-in and has the extension fetch now', async ({ context, world, extensionId }) => {
  // The app's page is open before the pairing: it gets the bridge as soon as the pairing stands.
  const app = await context.newPage();
  await app.goto(APP_PAGE);
  expect(await ask(app, 'state', 'before', 2_000)).toEqual([]);

  const pairPage = await context.newPage();
  const windowOpens = connectWindow(context, extensionId);
  await pairPage.goto(pairUrl());
  const connect = await windowOpens;
  await connect.getByTestId('allow').click();
  await expect(connect.getByTestId('paired')).toBeVisible();

  await expect.poll(() => marked(app)).toBe('1');
  expect(await ask(app, 'state', 's1')).toEqual([{ glmsync: 'reply', v: 1, id: 's1', answer: 'state', signin: 'none', fetching: false }]);
  expect(await ask(app, 'fetch', 'f0')).toEqual([{ glmsync: 'reply', v: 1, id: 'f0', answer: 'signin', signin: 'none' }]);
  expect(world.target.asked).toHaveLength(0);

  world.portal.token = world.key();
  await (await context.newPage()).goto(PORTAL);
  await connect.getByTestId('confirm-yes').click();
  await expect(connect.getByTestId('last')).toContainText('2 new sessions', { timeout: 60_000 });

  // A new session at Trackman; the app's page asks to fetch now.
  world.tm.activities.unshift({ id: 'S3', time: new Date().toISOString(), kind: 'RANGE_PRACTICE' });
  const replies = await ask(app, 'fetch', 'f1');
  expect(replies).toEqual([
    { glmsync: 'reply', v: 1, id: 'f1', answer: 'started' },
    { glmsync: 'reply', v: 1, id: 'f1', answer: 'finished', outcome: 'synced' },
  ]);
  expect(world.target.sessions.has('S3')).toBe(true);
  expect(world.target.asked.at(-1)).toMatchObject({ reason: 'manual', client: 'extension', signin: 'ready' });
  // Asked again at once: not another sync.
  expect(await ask(app, 'fetch', 'f2')).toEqual([{ glmsync: 'reply', v: 1, id: 'f2', answer: 'busy' }]);

  // A page of another origin (here the portal) has no bridge.
  const portal = await context.newPage();
  await portal.goto(PORTAL);
  expect(await marked(portal)).toBeNull();
  expect(await ask(portal, 'state', 'p1', 2_000)).toEqual([]);

  // Disconnected in the popup: the bridge goes with the pairing.
  const pop = await popup(context, extensionId);
  await pop.getByTestId('disconnect').click();
  await pop.getByTestId('disconnect-yes').click();
  await expect(pop.getByTestId('no-pairings')).toBeVisible();
  expect(await ask(app, 'state', 's2', 5_000)).toEqual([{ glmsync: 'reply', v: 1, id: 's2', answer: 'unpaired' }]);
  await app.reload();
  expect(await marked(app)).toBeNull();
  expect(await ask(app, 'state', 's3', 2_000)).toEqual([]);
});
