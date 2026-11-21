// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Which pages the sign-in window trusts (TrackmanLoginView): pure, so the rules are tested.
 */

/** Trackman's own sites: the only pages the window takes a key from. */
const TRACKMAN_HOST = /(^|\.)trackman(golf)?\.com$/;
/**
 * Where Trackman's sign-in page sends a player who picks Apple or Google: shown in the window so that
 * sign-in can finish there, but never trusted with a key.
 */
const SIGN_IN_HOST = /^(appleid\.apple\.com|idmsa\.apple\.com|accounts\.google\.com)$/;
const KEY = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function host(url: string | undefined, pattern: RegExp): boolean {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'https:' && pattern.test(u.hostname);
  } catch {
    return false;
  }
}

export const fromTrackman = (url: string | undefined) => host(url, TRACKMAN_HOST);
export const isSignInPage = (url: string | undefined) => host(url, SIGN_IN_HOST);

/** The key a message from the page carries - only from a Trackman page, and only something shaped like one. */
export function readCapturedToken(pageUrl: string | undefined, data: unknown): string | null {
  if (!fromTrackman(pageUrl) || typeof data !== 'string' || data.length > 20_000) return null;
  try {
    const { token } = JSON.parse(data) as { token?: unknown };
    return typeof token === 'string' && KEY.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** A navigation as the web view asks about it (react-native-webview's `onShouldStartLoadWithRequest`). */
export interface Navigation {
  url: string;
  isTopFrame?: boolean;
}

/** A page's own frames: a captcha's, say, from its provider's site; only over https, or the page's blank ones. */
function frameMayLoad(url: string): boolean {
  if (url === 'about:blank' || url === 'about:srcdoc') return true;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The page itself: Trackman's own pages and the sign-in providers its page offers. */
const pageMayLoad = (url: string) => fromTrackman(url) || isSignInPage(url) || url === 'about:blank';

/**
 * Where a new window the page opens (`target=_blank`, `window.open`) goes: into this same window when the page
 * itself may go there, else nowhere (null). Never into the system's browser.
 */
export function openInWindow(url: string): string | null {
  return typeof url === 'string' && url !== 'about:blank' && pageMayLoad(url) ? url : null;
}

/**
 * What the sign-in window hands its web view. Every load is decided here, so `originWhitelist` lets everything
 * through: react-native-webview gives a URL that misses it to the system (`Linking.openURL`), frames included, so a
 * captcha's frame from its provider's site opened in Safari on the iPhone and stayed empty in the app. A link
 * elsewhere now simply doesn't open; nothing leaves the app.
 */
export const windowRules = {
  originWhitelist: ['*'],
  onShouldStartLoadWithRequest: (req: Navigation): boolean =>
    req.isTopFrame === false ? frameMayLoad(req.url) : pageMayLoad(req.url),
};

/**
 * Runs inside Trackman's own page before it loads: whenever the portal calls Trackman's API, pass the
 * access token it sends on to the app; and say when the page asks for a passkey.
 *
 * A passkey can't work in an app's web view: WebAuthn there needs the sign-in site to name the app as its own
 * (associated domains on iOS, Digital Asset Links on Android), which no site does for an app it doesn't make; a
 * browser's own sign-in window would hold the passkey but not hand the portal's session back without a client id of
 * the provider's, which this project doesn't borrow. So the page's call fails quietly, and the app shows how to sign
 * in instead. Only an ask the player started counts: a page's offer on loading (`mediation: 'conditional'`, the
 * passkey in the keyboard's suggestions) says nothing. The page's own call still goes out exactly as it would.
 */
export const PAGE_SCRIPT = `(function () {
  function isTrackman(u) {
    try { var h = new URL(u, location.href).hostname; return h === 'trackmangolf.com' || /\\.trackmangolf\\.com$/.test(h); }
    catch (e) { return false; }
  }
  function send(v) {
    if (typeof v === 'string' && /^Bearer\\s+[\\w-]+\\.[\\w-]+\\.[\\w-]+/.test(v)) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ token: v.replace(/^Bearer\\s+/, '') }));
    }
  }
  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      var url = typeof input === 'string' ? input : input && input.url;
      if (isTrackman(url)) {
        var h = (init && init.headers) || (input && input.headers);
        if (h) send(typeof h.get === 'function' ? h.get('Authorization') : (h.Authorization || h.authorization));
      }
    } catch (e) {}
    return origFetch.apply(this, arguments);
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) { this.__tmUrl = u; return origOpen.apply(this, arguments); };
  var origSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (String(k).toLowerCase() === 'authorization' && isTrackman(this.__tmUrl)) send(v);
    return origSet.apply(this, arguments);
  };
  try {
    var creds = navigator.credentials;
    ['get', 'create'].forEach(function (name) {
      var orig = creds && creds[name];
      if (typeof orig !== 'function') return;
      creds[name] = function (o) {
        try {
          if (o && o.publicKey && o.mediation !== 'conditional') {
            window.ReactNativeWebView.postMessage(JSON.stringify({ passkey: true }));
          }
        } catch (e) {}
        return orig.apply(creds, arguments);
      };
    });
  } catch (e) {}
})(); true;`;

/** What a page's message to the app says: a key the portal sent to Trackman's API, or that the page asked for a passkey. */
export type PageMessage = { kind: 'token'; token: string } | { kind: 'passkey' };

/** A message from the page - only from a Trackman page, and only in the shapes PAGE_SCRIPT sends. */
export function readPageMessage(pageUrl: string | undefined, data: unknown): PageMessage | null {
  const token = readCapturedToken(pageUrl, data);
  if (token) return { kind: 'token', token };
  if (!fromTrackman(pageUrl) || typeof data !== 'string' || data.length > 1_000) return null;
  try {
    return (JSON.parse(data) as { passkey?: unknown }).passkey === true ? { kind: 'passkey' } : null;
  } catch {
    return null;
  }
}
