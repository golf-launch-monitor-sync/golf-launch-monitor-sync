// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * This phone's browser User-Agent without any page (spec 1.28.0): a test sign-in handed to an app that fetches itself
 * carries it as a real one does, so that app's calls look as after a real sign-in - but a test never opens the
 * provider's page. A web view of nothing (an empty page of the app's own), out of sight, says `navigator.userAgent` and
 * goes; nothing is loaded from anywhere. `done(null)`: it didn't say within a few seconds.
 */

import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { probeUserAgent } from '../lib/handover';

const WAIT_MS = 8_000;
const SAY = 'window.ReactNativeWebView.postMessage(JSON.stringify({ ua: navigator.userAgent })); true;';

export function UserAgentProbe({ done }: { done: (userAgent: string | null) => void }) {
  const said = useRef(false);
  const doneNow = useRef(done);
  doneNow.current = done;
  const say = useRef((ua: string | null) => {
    if (said.current) return;
    said.current = true;
    doneNow.current(ua);
  }).current;
  useEffect(() => {
    const timer = setTimeout(() => say(null), WAIT_MS);
    return () => clearTimeout(timer);
  }, [say]);
  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }} pointerEvents="none">
      <WebView
        source={{ html: '<!doctype html><title></title>' }}
        originWhitelist={['about:*']}
        javaScriptEnabled
        injectedJavaScript={SAY}
        onMessage={(e: WebViewMessageEvent) => say(probeUserAgent(e.nativeEvent.data))}
        onError={() => say(null)}
        // Nothing to go to: the empty page is all it may show.
        onShouldStartLoadWithRequest={(r) => r.url.startsWith('about:')}
      />
    </View>
  );
}
