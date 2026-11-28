// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The sign-in window's rules, run through react-native-webview's own decision (its
 * `createOnShouldStartLoadWithRequest`, the compiled file the app ships), with `react-native` stood in
 * for: what the library does with a URL that misses `originWhitelist` is part of the rule. It hands
 * that URL to the system (`Linking.openURL`), which on the iPhone opened a captcha's frame in Safari
 * while the frame stayed empty in the app.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { openInWindow, PAGE_SCRIPT, readPageMessage, windowRules } from './trackmanPage.ts';

const opened: string[] = [];
const fakeNative = {
  Linking: {
    canOpenURL: async () => true,
    openURL: async (url: string) => {
      opened.push(url);
    },
  },
  View: 'View',
  Text: 'Text',
  ActivityIndicator: 'ActivityIndicator',
  Platform: { OS: 'ios' },
  StyleSheet: { create: <T>(s: T) => s },
};

type Decide = (e: { nativeEvent: { url: string; lockIdentifier: number; isTopFrame?: boolean } }) => void;
type Shared = {
  createOnShouldStartLoadWithRequest: (
    load: (shouldStart: boolean, url: string) => void,
    whitelist: readonly string[],
    decide?: (req: { url: string; isTopFrame?: boolean }) => boolean,
  ) => Decide;
};

function library(): Shared {
  const fromApp = createRequire(new URL('../../package.json', import.meta.url));
  const fromWebView = createRequire(fromApp.resolve('react-native-webview/package.json'));
  const native = fromWebView.resolve('react-native');
  fromWebView.cache[native] = { id: native, filename: native, loaded: true, exports: fakeNative } as unknown as NodeJS.Module;
  return fromWebView('./lib/WebViewShared.js') as Shared;
}

/** What the web view does with one navigation: loads it here, and whether the system got it. */
async function navigate(url: string, isTopFrame: boolean): Promise<{ loads: boolean; toSystem: boolean }> {
  opened.length = 0;
  let loads: boolean | null = null;
  const decide = library().createOnShouldStartLoadWithRequest(
    (shouldStart) => {
      loads = shouldStart;
    },
    windowRules.originWhitelist,
    windowRules.onShouldStartLoadWithRequest,
  );
  decide({ nativeEvent: { url, lockIdentifier: 1, isTopFrame } });
  await new Promise((r) => setTimeout(r, 0)); // the library opens the system's browser a tick later
  return { loads: loads === true, toSystem: opened.length > 0 };
}

describe('the sign-in window', () => {
  it('loads a captcha frame from another site in the page, and never hands it to the system', async () => {
    for (const url of [
      'https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv0/0/abc/light/normal',
      'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox',
      'https://www.google.com/recaptcha/api2/anchor?k=abc',
      'about:srcdoc',
    ]) {
      expect(await navigate(url, false), url).toEqual({ loads: true, toSystem: false });
    }
  });

  it('keeps the page itself on Trackman and the sign-in providers, and opens nothing outside the app', async () => {
    expect(await navigate('https://login.trackmangolf.com/connect/authorize?x=1', true)).toEqual({ loads: true, toSystem: false });
    expect(await navigate('https://portal.trackmangolf.com/', true)).toEqual({ loads: true, toSystem: false });
    expect(await navigate('https://appleid.apple.com/auth/authorize', true)).toEqual({ loads: true, toSystem: false });
    expect(await navigate('about:blank', true)).toEqual({ loads: true, toSystem: false });
    for (const url of ['https://example.com/', 'http://portal.trackmangolf.com/', 'mailto:support@example.com', 'tel:+4940123', 'itms-apps://x']) {
      expect(await navigate(url, true), url).toEqual({ loads: false, toSystem: false });
    }
  });

  it('takes a frame only over https (or the page’s own blank frames)', async () => {
    expect(await navigate('http://challenges.example.com/', false)).toEqual({ loads: false, toSystem: false });
    expect(await navigate('javascript:alert(1)', false)).toEqual({ loads: false, toSystem: false });
  });

  it('opens a new window of the page (target=_blank, window.open) in the same window, only where the page may go', () => {
    // Without onOpenWindow, Android gives a new window to a bare WebView, which hands it to the system's browser;
    // with it, iOS and Android both ask the app, which loads it in place (openInWindow).
    const view = readFileSync(new URL('../ui/TrackmanLoginView.tsx', import.meta.url), 'utf8');
    expect(view).toMatch(/onOpenWindow=\{/);
    expect(view).toContain('openInWindow(');
    expect(view).not.toMatch(/setSupportMultipleWindows=\{false\}/);
    expect(openInWindow('https://login.trackmangolf.com/account/login')).toBe('https://login.trackmangolf.com/account/login');
    expect(openInWindow('https://appleid.apple.com/auth/authorize?x=1')).toBe('https://appleid.apple.com/auth/authorize?x=1');
    expect(openInWindow('https://example.com/')).toBeNull();
    expect(openInWindow('javascript:alert(1)')).toBeNull();
    expect(openInWindow('')).toBeNull();
  });
});

/** PAGE_SCRIPT run in a stand-in of the page: what it hands the app, and that the page's own calls still go out. */
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';

function page(opts: { credentials?: boolean; userAgent?: string | null } = {}) {
  const posted: unknown[] = [];
  const calls: string[] = [];
  const credentials =
    opts.credentials === false
      ? undefined
      : {
          get: (o: unknown) => {
            calls.push(`get ${JSON.stringify(o)}`);
            return Promise.reject(new Error('NotAllowedError'));
          },
          create: (o: unknown) => {
            calls.push(`create ${JSON.stringify(o)}`);
            return Promise.reject(new Error('NotAllowedError'));
          },
        };
  class XHR {
    open() {}
    setRequestHeader() {}
  }
  const window = {
    ReactNativeWebView: { postMessage: (m: string) => posted.push(JSON.parse(m)) },
    fetch: (..._args: unknown[]) => Promise.resolve('fetched'),
  };
  const navigator = { credentials, ...(opts.userAgent !== null ? { userAgent: opts.userAgent ?? UA } : {}) };
  new Function('window', 'navigator', 'XMLHttpRequest', 'location', 'URL', PAGE_SCRIPT)(window, navigator, XHR, { href: 'https://login.trackmangolf.com/' }, URL);
  return { window, navigator, posted, calls };
}

describe('the page script', () => {
  it('passes on the key the portal sends to Trackman with this window’s User-Agent, and the call still goes out', async () => {
    const p = page();
    const key = 'aaa.bbb.ccc';
    await expect(p.window.fetch('https://api.trackmangolf.com/graphql', { headers: { Authorization: `Bearer ${key}` } })).resolves.toBe('fetched');
    await p.window.fetch('https://example.com/', { headers: { Authorization: `Bearer ${key}` } });
    expect(p.posted).toEqual([{ token: key, ua: UA }]);
  });

  it('hands the key on without a User-Agent where the page has none to read', async () => {
    const p = page({ userAgent: null });
    await p.window.fetch('https://api.trackmangolf.com/graphql', { headers: { Authorization: 'Bearer aaa.bbb.ccc' } });
    expect(p.posted).toEqual([{ token: 'aaa.bbb.ccc', ua: null }]);
  });

  it('says when the page asks for a passkey, and lets the page’s call go on as it would', async () => {
    const p = page();
    const creds = p.navigator.credentials as { get: (o: unknown) => Promise<unknown>; create: (o: unknown) => Promise<unknown> };
    await expect(creds.get({ publicKey: { challenge: 'x' } })).rejects.toThrow('NotAllowedError');
    expect(p.posted).toEqual([{ passkey: true }]);
    expect(p.calls).toEqual(['get {"publicKey":{"challenge":"x"}}']);
    await expect(creds.create({ publicKey: { challenge: 'y' } })).rejects.toThrow();
    expect(p.posted).toEqual([{ passkey: true }, { passkey: true }]);
  });

  it('stays quiet for the passkey offer a page makes on loading (conditional), and for passwords', async () => {
    const p = page();
    const creds = p.navigator.credentials as { get: (o: unknown) => Promise<unknown> };
    await creds.get({ publicKey: { challenge: 'x' }, mediation: 'conditional' }).catch(() => undefined);
    await creds.get({ password: true }).catch(() => undefined);
    expect(p.posted).toEqual([]);
    expect(p.calls).toHaveLength(2);
  });

  it('runs on a page without navigator.credentials', () => {
    expect(() => page({ credentials: false })).not.toThrow();
  });
});

describe('readPageMessage', () => {
  it('reads a key with the window’s User-Agent, and a passkey ask, only from a Trackman page', () => {
    expect(readPageMessage('https://portal.trackmangolf.com/', JSON.stringify({ token: 'aaa.bbb.ccc', ua: UA }))).toEqual({ kind: 'token', token: 'aaa.bbb.ccc', userAgent: UA });
    expect(readPageMessage('https://portal.trackmangolf.com/', JSON.stringify({ token: 'aaa.bbb.ccc' }))).toEqual({ kind: 'token', token: 'aaa.bbb.ccc', userAgent: null });
    expect(readPageMessage('https://login.trackmangolf.com/', JSON.stringify({ passkey: true }))).toEqual({ kind: 'passkey' });
    expect(readPageMessage('https://appleid.apple.com/', JSON.stringify({ passkey: true }))).toBeNull();
    expect(readPageMessage('https://login.trackmangolf.com/', JSON.stringify({ passkey: 'yes' }))).toBeNull();
    expect(readPageMessage('https://login.trackmangolf.com/', 42)).toBeNull();
  });
});

describe('the User-Agent a page hands with its key', () => {
  it('is kept only when it is a header value; the key comes through either way', () => {
    for (const bad of ['a\r\nCookie: x', 'x'.repeat(513), '', 42, { a: 1 }]) {
      expect(readPageMessage('https://portal.trackmangolf.com/', JSON.stringify({ token: 'aaa.bbb.ccc', ua: bad })), String(bad)).toEqual({ kind: 'token', token: 'aaa.bbb.ccc', userAgent: null });
    }
  });
});
