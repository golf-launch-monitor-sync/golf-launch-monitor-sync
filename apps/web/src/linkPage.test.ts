// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { parsePairFragment, universalLink } from '@glmsync/spec';
import { describe, expect, it } from 'vitest';
import { linkPage } from './linkPage.ts';

const PAIR_PAGE = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/pair';
const T = 'https%3A%2F%2Fapp.example.org%2Flm%2Fv1';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36';

const pair = universalLink(`glmsync://pair?target=${T}&code=K7M2-PQ9X&provider=trackman&return=exampleapp%3A%2F%2Fprofile`) as string;
const sync = universalLink(`glmsync://sync?target=${T}&return=exampleapp%3A%2F%2Fsynced`) as string;

describe('the page behind the universal links', () => {
  it('opens the app by its scheme on a phone, with the same keys', () => {
    expect(linkPage(sync, IPHONE, PAIR_PAGE)).toEqual({ show: 'phone', action: 'sync', platform: 'ios', open: `glmsync://sync?target=${T}&return=exampleapp%3A%2F%2Fsynced` });
    expect(linkPage(pair, ANDROID, PAIR_PAGE)).toMatchObject({ show: 'phone', action: 'pair', platform: 'android' });
    expect(linkPage(sync.split('#')[0] as string, ANDROID, PAIR_PAGE)).toMatchObject({ show: 'phone', open: 'glmsync://sync' });
  });

  it('hands a pair link on a computer to the pairing page, without the way back', () => {
    const page = linkPage(pair, MAC, PAIR_PAGE);
    expect(page.show).toBe('forward');
    const to = (page as { to: string }).to;
    expect(to.startsWith(`${PAIR_PAGE}#`)).toBe(true);
    expect(parsePairFragment(to.slice(to.indexOf('#')))).toEqual({ ok: true, action: 'pair', target: 'https://app.example.org/lm/v1', code: 'K7M2-PQ9X', provider: 'trackman' });
  });

  it('says where fetching happens for a sync link on a computer', () => {
    expect(linkPage(sync, MAC, PAIR_PAGE)).toEqual({ show: 'computer-sync' });
  });

  it('takes nothing that isn’t one of its links', () => {
    for (const href of [`${PAIR_PAGE}#target=${T}&code=K7M2PQ9X`, `${sync}&target=${T}`, `${sync.replace('#', '?')}`, '', 'glmsync://sync']) {
      expect(linkPage(href, IPHONE, PAIR_PAGE)).toEqual({ show: 'invalid' });
    }
  });
});
