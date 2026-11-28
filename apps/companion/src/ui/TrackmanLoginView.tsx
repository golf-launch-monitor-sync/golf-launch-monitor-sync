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
 * API - the same key the portal holds, nothing more - and this window's own User-Agent with it, which every call to
 * Trackman from this phone then carries (lib/trackmanPage.ts). The page loads as this web view is, with the phone's
 * own browser engine and its own user agent; nothing is added to it.
 *
 * fresh: without the session this phone already has, and keeping none - for "that's not my account"
 * on a phone someone else signed in to Trackman on.
 *
 * Nothing the page loads or opens leaves the app (lib/trackmanPage.ts, `windowRules`): a captcha's frame loads in the
 * page, a new window in this one, and a link elsewhere doesn't open.
 *
 * Taken over from the Birdie Box Caddie (regsta Consulting GmbH, transferred to this project).
 */

import { useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { openInWindow, PAGE_SCRIPT, readPageMessage, windowRules } from '../lib/trackmanPage';

const PORTAL = 'https://portal.trackmangolf.com/';

export function TrackmanLoginView({
  onToken,
  onPasskey,
  hidden = false,
  fresh = false,
}: {
  /** A key the portal sent, with this window's User-Agent (null: none to read). */
  onToken: (token: string, userAgent: string | null) => void;
  /** The page asked for a passkey, which can't work in this window (lib/trackmanPage.ts, PAGE_SCRIPT). */
  onPasskey?: () => void;
  hidden?: boolean;
  fresh?: boolean;
}) {
  const done = useRef(false);
  const view = useRef<WebView<object>>(null);
  function onMessage(e: WebViewMessageEvent) {
    // Only a Trackman page may hand over a key (a link out to anything else can't).
    if (done.current) return;
    const msg = readPageMessage(e.nativeEvent.url, e.nativeEvent.data);
    if (msg?.kind === 'token') {
      done.current = true;
      onToken(msg.token, msg.userAgent);
    } else if (msg?.kind === 'passkey') onPasskey?.();
  }
  // A new window of the page (target=_blank, window.open) opens in this one, where the page may go; else nowhere.
  function onOpenWindow(e: { nativeEvent: { targetUrl: string } }) {
    const url = openInWindow(e.nativeEvent.targetUrl);
    if (url) view.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
  }
  return (
    <View style={hidden ? { width: 0, height: 0, overflow: 'hidden' } : { flex: 1 }}>
      <WebView
        ref={view}
        source={{ uri: PORTAL }}
        injectedJavaScriptBeforeContentLoaded={PAGE_SCRIPT}
        onMessage={onMessage}
        onOpenWindow={onOpenWindow}
        incognito={fresh}
        sharedCookiesEnabled={!fresh}
        thirdPartyCookiesEnabled
        originWhitelist={windowRules.originWhitelist}
        onShouldStartLoadWithRequest={windowRules.onShouldStartLoadWithRequest}
        style={{ flex: 1 }}
      />
    </View>
  );
}
