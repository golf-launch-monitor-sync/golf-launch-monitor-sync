// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * golf.de in a window the player doesn't see, for *Fetch all* by itself while the app is open (spec/hcp.md, *By
 * itself, when the record is due*, a companion app; lib/autoFetch.ts decides when). The frame keeps it behind its own
 * screen, full size: iOS suspends a web view that isn't at least partly on screen, so a window of no size might never
 * load. It never takes a touch and isn't read out by a screen reader; the home page says that it runs, with *Stop*.
 *
 * It opens golf.de's *Mein Bereich*, as the extension's background tab, with the cookies of the player's own golf.de
 * window on this phone - it never signs in: its top frame loads only the pages read along on (lib/golfdePage.ts,
 * `unseenWindowRules`), and a page that leads elsewhere (a sign-in, golf.de's start page) ends the run. Once the first
 * page is there it drives the run as the player's window does (lib/fetchAll.ts), as its own page (`AUTO_OWNER`); the
 * page script reads along as always. Nothing here asks golf.de anything of its own.
 */

import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { MY_AREA_URL } from '@glmsync/provider-golfde';
import { AUTO_OWNER } from '../lib/autoFetch';
import { Driver } from '../lib/fetchAll';
import { readGolfdeMessage, unseenWindowRules } from '../lib/golfdePage';
import { GOLFDE_PAGE_SCRIPT } from '../lib/golfdePageScript';
import type { Services } from '../lib/services';

export function UnseenGolfde({ svc }: { svc: Services }) {
  const web = useRef<WebView<object>>(null);
  const driver = useRef<Driver | null>(null);
  if (!driver.current) {
    driver.current = new Driver({
      hcp: svc.hcp,
      owner: AUTO_OWNER,
      inject: (script) => web.current?.injectJavaScript(script),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      show: () => undefined, // the home page follows the run itself (HcpCard)
    });
  }
  const rules = useMemo(() => unseenWindowRules(() => void svc.auto.refused()), [svc]);

  // The window goes (the run ended, the app went to the back): its loop stops with it.
  useEffect(() => () => driver.current?.stop(), []);

  function onLoadEnd() {
    if (!svc.auto.loaded()) return;
    void driver.current
      ?.drive()
      .catch(() => undefined)
      .finally(() => svc.auto.ended());
  }

  function onMessage(e: WebViewMessageEvent) {
    const msg = readGolfdeMessage(e.nativeEvent.url, e.nativeEvent.data);
    if (!msg) return;
    svc.hcp.see(msg.page, msg.seen).then(
      (v) => svc.hcpSender.seen(v),
      () => undefined, // the phone couldn't keep it: the run waits for its answer and ends by its own rules
    );
  }

  // The page didn't load, or the phone ended its page (memory): not golf.de's doing, so interrupted, not held.
  const lost = () => void svc.auto.interrupt();

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <WebView
        ref={web}
        source={{ uri: MY_AREA_URL }}
        injectedJavaScriptBeforeContentLoaded={GOLFDE_PAGE_SCRIPT}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={onMessage}
        onLoadEnd={onLoadEnd}
        onError={lost}
        onContentProcessDidTerminate={lost}
        onRenderProcessGone={lost}
        setSupportMultipleWindows={false}
        mediaPlaybackRequiresUserAction
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        originWhitelist={rules.originWhitelist}
        onShouldStartLoadWithRequest={rules.onShouldStartLoadWithRequest}
        style={{ flex: 1 }}
      />
    </View>
  );
}
