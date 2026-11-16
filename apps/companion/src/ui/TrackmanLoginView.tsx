// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Trackman's own web portal inside the app, for the player's own sign-in. Visible to sign in; hidden
 * (zero size) to renew an expired key quietly, which works as long as Trackman still remembers the
 * sign-in on this phone (the app tries that only where this phone held the player's key before, and
 * takes only a key of that same account: SignIns.renewalFits).
 *
 * The player types their password into Trackman's page; the app never sees it. A small script that
 * runs in the page before it loads passes on the access key the portal itself sends to Trackman's
 * API - the same key the portal holds, nothing more. No disguise: the page loads as this web view
 * is, with the phone's own browser engine and its own user agent.
 *
 * fresh: without the session this phone already has, and keeping none - for "that's not my account"
 * on a phone someone else signed in to Trackman on.
 *
 * Taken over from the Birdie Box Caddie (regsta Consulting GmbH, transferred to this project).
 */

import { useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { fromTrackman, isSignInPage, readCapturedToken } from '../lib/trackmanPage';

const PORTAL = 'https://portal.trackmangolf.com/';

/**
 * Runs inside Trackman's own page before it loads: whenever the portal calls Trackman's API, pass the
 * access token it sends on to the app.
 */
const CAPTURE = `(function () {
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
})(); true;`;

export function TrackmanLoginView({
  onToken,
  hidden = false,
  fresh = false,
}: {
  onToken: (token: string) => void;
  hidden?: boolean;
  fresh?: boolean;
}) {
  const done = useRef(false);
  function onMessage(e: WebViewMessageEvent) {
    // Only a Trackman page may hand over a key (a link out to anything else can't).
    if (done.current) return;
    const token = readCapturedToken(e.nativeEvent.url, e.nativeEvent.data);
    if (token) {
      done.current = true;
      onToken(token);
    }
  }
  return (
    <View style={hidden ? { width: 0, height: 0, overflow: 'hidden' } : { flex: 1 }}>
      <WebView
        source={{ uri: PORTAL }}
        injectedJavaScriptBeforeContentLoaded={CAPTURE}
        onMessage={onMessage}
        incognito={fresh}
        sharedCookiesEnabled={!fresh}
        thirdPartyCookiesEnabled
        // Trackman's own pages and the sign-in providers its page offers; a link to anywhere else
        // doesn't open here.
        originWhitelist={[
          'https://trackmangolf.com',
          'https://*.trackmangolf.com',
          'https://trackman.com',
          'https://*.trackman.com',
          'https://appleid.apple.com',
          'https://idmsa.apple.com',
          'https://accounts.google.com',
        ]}
        // A page's own frames (a captcha, say) may load from elsewhere; the page itself may not.
        onShouldStartLoadWithRequest={(req: WebViewNavigation & { isTopFrame?: boolean }) =>
          req.isTopFrame === false || fromTrackman(req.url) || isSignInPage(req.url) || req.url === 'about:blank'
        }
        style={{ flex: 1 }}
      />
    </View>
  );
}
