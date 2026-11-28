// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** SR-8b: *Update now* in the extension - the browser's own update first, else the extension's page in its store. */

import { describe, expect, it } from 'vitest';
import { FIREFOX_XPI, RELEASES_URL, storePage, updateExtension, type UpdateApi } from './update.ts';

const ID = 'abcdefghijklmnopabcdefghijklmnop';

describe('storePage', () => {
  it('the store the browser installed it from, by its own id', () => {
    expect(storePage({ id: ID, installType: 'normal', updateUrl: 'https://clients2.google.com/service/update2/crx' }, 'chrome')).toBe(`https://chromewebstore.google.com/detail/${ID}`);
    expect(storePage({ id: ID, installType: 'normal', updateUrl: 'https://edge.microsoft.com/extensionwebstorebase/v1/crx' }, 'chrome')).toBe(`https://microsoftedge.microsoft.com/addons/detail/${ID}`);
    // Firefox's signed add-on comes from the project's site: the newest one installs with a click.
    expect(storePage({ id: 'glmsync@example', installType: 'normal' }, 'firefox')).toBe(FIREFOX_XPI);
  });

  it('loaded by hand, an address that isn’t a store’s, or nothing readable: the releases', () => {
    expect(storePage({ id: ID, installType: 'development' }, 'chrome')).toBe(RELEASES_URL);
    expect(storePage({ id: ID, installType: 'development' }, 'firefox')).toBe(RELEASES_URL);
    expect(storePage({ id: ID, installType: 'normal', updateUrl: 'https://evil.example/crx' }, 'chrome')).toBe(RELEASES_URL);
    expect(storePage({ id: 'not an id', installType: 'normal', updateUrl: 'https://clients2.google.com/service/update2/crx' }, 'chrome')).toBe(RELEASES_URL);
    expect(storePage(null, 'chrome')).toBe(RELEASES_URL);
  });
});

describe('updateExtension', () => {
  function api(over: { check?: unknown | 'throws' | 'missing'; self?: unknown; open?: 'throws' } = {}) {
    const calls: string[] = [];
    const a: UpdateApi = {
      browser: 'chrome',
      ...(over.check === 'missing'
        ? {}
        : {
            requestUpdateCheck: async () => {
              calls.push('check');
              if (over.check === 'throws') throw new Error('no');
              return over.check ?? { status: 'update_available', version: '9.9.9' };
            },
          }),
      reload: () => calls.push('reload'),
      self: async () => over.self ?? { id: ID, installType: 'normal', updateUrl: 'https://clients2.google.com/service/update2/crx' },
      open: async (url) => {
        calls.push(`open ${url}`);
        if (over.open === 'throws') throw new Error('no');
      },
    };
    return { a, calls };
  }

  it('an update the browser has: applied at once', async () => {
    const { a, calls } = api();
    expect(await updateExtension(a)).toBe('reloading');
    expect(calls).toEqual(['check', 'reload']);
    // Firefox answers as a list.
    expect(await updateExtension(api({ check: ['update_available', { version: '9.9.9' }] }).a)).toBe('reloading');
  });

  it('none, held back, or no way to ask: the store page', async () => {
    for (const check of [{ status: 'no_update' }, { status: 'throttled' }, 'throws', 'missing', 'junk']) {
      const { a, calls } = api({ check });
      expect(await updateExtension(a)).toBe('page');
      expect(calls.at(-1)).toBe(`open https://chromewebstore.google.com/detail/${ID}`);
      expect(calls).not.toContain('reload');
    }
  });

  it('the page wouldn’t open: says so', async () => {
    expect(await updateExtension(api({ check: { status: 'no_update' }, open: 'throws' }).a)).toBe('failed');
  });
});
