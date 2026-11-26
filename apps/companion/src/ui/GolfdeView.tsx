// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * golf.de in the app's own window, for the handicap record (spec/hcp.md, *A client that only observes*): the player
 * signs in there and opens their History Sheet and Scoring Record; the page script (src/lib/golfdePageScript.ts, the
 * extension's own) reads along with what golf.de's page loads and posts it here - no names, no numbers - and the app
 * sends it to the connected apps a little after the last new page, or when the player taps *Send* or leaves.
 *
 * The page loads as this phone's web view is: its own engine and user agent, nothing added. The app sends golf.de
 * nothing of its own; the sign-in stays in this window, on this phone. Nothing the page opens leaves the window
 * (lib/golfdePage.ts, `golfdeWindowRules`).
 *
 * *Fetch all* (spec/hcp.md, clicking for the player): once signed in and the account confirmed, one tap and the window
 * does the clicks - every page of the History Sheet, the Scoring Record, the result lists of the last two years -
 * with a pause between pages (lib/fetchAll.ts); *Stop*, *Done* or the app going to the back ends it, and what was read
 * goes out once at the end.
 *
 * On a tournament's page of golf.de's calendar (spec 1.19.0, *Taking one tournament*) the bar offers *Add to …* for
 * each connected app: a tap asks the page for that one tournament's lines and sends it there (lib/eventTake.ts).
 */

import type { HcpView } from '@glmsync/browser/hcp';
import { translator } from '@glmsync/browser/i18n';
import { eventText } from '@glmsync/browser/hcpView';
import { hcpWhoLine } from '@glmsync/browser/wizard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { lang, t } from '../i18n';
import { Driver, WINDOW_OWNER } from '../lib/fetchAll';
import { EventTake, type EventState } from '../lib/eventTake';
import { golfdeWindowRules, HISTORY_SHEET_URL, openInGolfdeWindow, readEventMessage, readGolfdeMessage } from '../lib/golfdePage';
import { GOLFDE_PAGE_SCRIPT } from '../lib/golfdePageScript';
import { hcpLine } from '../lib/hcpText';
import type { Services } from '../lib/services';
import { Body, Button, s, Small, Title } from './parts';

/** How often the line follows a send under way while the window is open. */
const REFRESH_MS = 3000;

/** `backTo`: the app a link came from, when *Done* jumps back to it (spec 1.18.0): the button says so. */
export function GolfdeView({ svc, done, backTo }: { svc: Services; done: () => void; backTo?: string }) {
  const [view, setView] = useState<HcpView | null>(null);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const web = useRef<WebView<object>>(null);
  const driver = useRef<Driver | null>(null);
  const [event, setEvent] = useState<EventState>({ offer: false, busy: null, said: null });
  const names = useRef<Record<string, string>>({});
  const taker = useRef<EventTake | null>(null);
  if (!taker.current) {
    taker.current = new EventTake({
      hcp: svc.hcp,
      inject: (script) => web.current?.injectJavaScript(script),
      show: setEvent,
      nameOf: (id) => names.current[id],
    });
  }
  if (!driver.current) {
    driver.current = new Driver({
      hcp: svc.hcp,
      inject: (script) => web.current?.injectJavaScript(script),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      show: setView,
    });
  }

  const refresh = useCallback(async () => {
    try {
      setView(await svc.hcp.view());
    } catch {
      // the line is a convenience; the next refresh tries again
    }
  }, [svc]);

  useEffect(() => {
    void refresh();
    const off = svc.hcpSender.subscribe(setView);
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      off();
      clearInterval(timer);
      // The window goes: a run of Fetch all ends with it, and what it read goes out.
      driver.current?.stop();
      taker.current?.stop();
      void svc.hcp.cancelFetchAll().catch(() => undefined);
    };
  }, [svc, refresh]);

  // A connection the app ended on a tap goes from the bar too.
  useEffect(() => {
    if (event.said && !event.said.ok && (event.said.error === 'ended' || event.said.error === 'no_pairing')) void refresh();
  }, [event.said, refresh]);

  function fetchAll() {
    svc.hcp.startFetchAll(WINDOW_OWNER).then(
      (v) => {
        setView(v);
        setNote(null);
        if (v.fetch_all === 'running') void driver.current?.drive();
      },
      () => setNote(t('error.generic')),
    );
  }

  function stopFetchAll() {
    driver.current?.stop();
    svc.hcp.cancelFetchAll().then(setView, () => setNote(t('error.generic')));
  }

  function onMessage(e: WebViewMessageEvent) {
    const about = readEventMessage(e.nativeEvent.url, e.nativeEvent.data);
    if (about) {
      void taker.current?.message(about);
      return;
    }
    const msg = readGolfdeMessage(e.nativeEvent.url, e.nativeEvent.data);
    if (!msg) return; // not the page script's, or not from golf.de: nothing to take
    svc.hcp.see(msg.page, msg.seen).then(
      (v) => {
        setView(v);
        setNote(null);
        svc.hcpSender.seen(v);
      },
      () => setNote(t('error.generic')), // the phone couldn't keep it: said, and the next page tries again
    );
  }

  // A new window of the page (target=_blank, window.open) opens in this one, where the window may go; else nowhere.
  function onOpenWindow(e: { nativeEvent: { targetUrl: string } }) {
    const url = openInGolfdeWindow(e.nativeEvent.targetUrl);
    if (url) web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)}); true;`);
  }

  function close() {
    // Leaving golf.de: a run ends, and what waits goes now (behind the jump home a timer may never fire).
    driver.current?.stop();
    void svc.hcp.cancelFetchAll().catch(() => undefined);
    void svc.hcpSender.flush();
    done();
  }

  const line = view ? hcpLine(view, lang) : null;
  const tr = translator(lang);
  names.current = Object.fromEntries((view?.pairings ?? []).map((p) => [p.id, p.name]));
  const took = event.said ? eventText(event.said, tr) : null;
  // *Is this your golf.de account?*, in the app's own bar (golf.de's page can't reach it): nothing goes out before the yes.
  const answer = (yes: boolean) =>
    svc.hcp.confirm(yes).then(
      (v) => {
        setView(v);
        setNote(null);
        if (yes && v.account === 'confirmed') void svc.hcpSender.now();
      },
      () => setNote(t('error.generic')),
    );
  return (
    <View style={{ flex: 1 }}>
      <View style={[s.bar, { flexWrap: 'wrap', gap: 8 }]}>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Title>golf.de</Title>
          <Small>{t('golfde.hint')}</Small>
          {line && (line.warn ? <Body warn>{line.text}</Body> : <Small>{line.text}</Small>)}
          {line?.confirm && view && <Body>{hcpWhoLine(view.index, tr, lang)}</Body>}
          {note && <Body warn>{note}</Body>}
          {took && <Body warn={took.warn}>{took.text}</Body>}
        </View>
        <View style={{ gap: 6 }}>
          {line?.confirm && <Button label={tr('confirm.yes')} onPress={() => void answer(true)} />}
          {line?.confirm && <Button label={tr('confirm.no')} kind="secondary" onPress={() => void answer(false)} />}
          {line?.fetchAll && <Button label={tr('line.fetchAll')} onPress={fetchAll} />}
          {line?.stop && <Button label={tr('line.stop')} kind="secondary" onPress={stopFetchAll} />}
          {line?.send && <Button label={t('hcp.send')} onPress={() => void svc.hcpSender.now()} disabled={!!view?.sending} />}
          {event.offer &&
            view?.pairings.map((p) => (
              <Button
                key={p.id}
                label={tr('event.take', { name: p.name })}
                busy={event.busy === p.id}
                busyLabel={tr('event.taking', { name: p.name })}
                disabled={event.busy !== null}
                onPress={() => taker.current?.tap(p.id)}
              />
            ))}
          <Button label={backTo ? tr('wizard.back', { target: backTo }) : t('golfde.done')} kind="secondary" onPress={close} />
        </View>
      </View>
      {failed ? (
        <View style={s.scroll}>
          <Body warn>{t('golfde.failed')}</Body>
          <Button
            label={t('golfde.reload')}
            onPress={() => {
              setFailed(false);
              setKey((k) => k + 1);
            }}
          />
        </View>
      ) : (
        <WebView
          key={key}
          ref={web}
          source={{ uri: HISTORY_SHEET_URL }}
          injectedJavaScriptBeforeContentLoaded={GOLFDE_PAGE_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          onOpenWindow={onOpenWindow}
          onError={() => setFailed(true)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          originWhitelist={golfdeWindowRules.originWhitelist}
          onShouldStartLoadWithRequest={golfdeWindowRules.onShouldStartLoadWithRequest}
          style={{ flex: 1 }}
        />
      )}
    </View>
  );
}
