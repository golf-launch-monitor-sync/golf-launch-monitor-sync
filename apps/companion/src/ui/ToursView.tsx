// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages of his tour in the app's own window (spec/prores.md), today the Pro Golf Tour. He opens his
 * profile there; *Send* in the app's bar has the page script (src/lib/toursPageScript.ts) read his ranking and season
 * with the extension's very reading, and *Fetch all* opens his finished tournaments' pages one by one at the
 * extension's pace and takes only his own line of each. What the window does is lib/toursSession.ts; this is the
 * window around it.
 *
 * The page loads as this phone's web view is: its own engine and user agent, nothing added. The app sends the site
 * nothing of its own, and nothing the page opens leaves the window (lib/toursPage.ts, `tourWindowRules`). The window
 * opens on his profile last sent from here, else on the tour's Order of Merit, where he finds his name.
 */

import { translator } from '@glmsync/browser/i18n';
import { TOUR_SITES, type TourSite } from '@glmsync/provider-tours';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { lang, t } from '../i18n';
import { askId, dayOf } from '../lib/rankingsPage';
import type { Services } from '../lib/services';
import { ANSWER_MS, keptTourPage, openInTourWindow, readScript, readTourMessage, tourSiteOf, tourWindowRules, type TourAnswer } from '../lib/toursPage';
import { TOURS_PAGE_SCRIPT } from '../lib/toursPageScript';
import { TourSession, type TourState } from '../lib/toursSession';
import { toursBar } from '../lib/toursText';
import { Body, Button, s, Small, Title } from './parts';

export function ToursView({ svc, site, done }: { svc: Services; site: TourSite; done: () => void }) {
  const info = TOUR_SITES[site];
  const [state, setState] = useState<TourState>({ view: null, unread: false, tour: null, phase: 'ready', limit: false });
  /** Where the window opens: null while it is decided. */
  const [start, setStart] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [key, setKey] = useState(0);
  const web = useRef<WebView<object>>(null);
  /** The open ask to the page script, with how to hand its answer back. */
  const ask = useRef<{ id: string; resolve: (a: TourAnswer | null) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const shown = useRef<string | null>(null);
  const tr = translator(lang);

  /** Made with the window and closed with it (a remount, as React's strict mode does, gets a session of its own). */
  const [session, setSession] = useState<TourSession | null>(null);

  useEffect(() => {
    let live = true;
    const made = new TourSession({
      keeper: svc.tours,
      pro: svc.pro,
      lastPage: svc.lastPage,
      read: (who) =>
        new Promise<TourAnswer | null>((resolve) => {
          if (ask.current) {
            resolve(null); // one read at a time
            return;
          }
          const id = askId();
          const script = readScript(id, who);
          if (!script || !web.current) {
            resolve(null);
            return;
          }
          // No answer in time (the page went away, a script of the site in the way): taken as no answer.
          const timer = setTimeout(() => {
            ask.current = null;
            resolve(null);
          }, ANSWER_MS);
          ask.current = { id, resolve, timer };
          web.current.injectJavaScript(script);
        }),
      open: (to) => web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(to)}); true;`),
      today: () => dayOf(new Date()),
      onChange: (st) => live && setState(st),
    });
    setSession(made);
    void made.start();
    // His profile on this tour last sent from here, else the tour's Order of Merit.
    void svc.lastPage.get().then(
      (last) => live && setStart(keptTourPage(last) && tourSiteOf(last) === site ? (last as string) : (info?.start ?? null)),
      () => live && setStart(info?.start ?? null),
    );
    return () => {
      live = false;
      if (ask.current) {
        clearTimeout(ask.current.timer);
        ask.current.resolve(null);
        ask.current = null;
      }
      void made.close();
    };
  }, [svc, site, info]);

  function onMessage(e: WebViewMessageEvent) {
    const open = ask.current;
    const got = readTourMessage(e.nativeEvent.url, e.nativeEvent.data, open?.id ?? null);
    if (!open || !got) return; // not an answer to the open ask, or not from the tour's page: nothing to take
    clearTimeout(open.timer);
    ask.current = null;
    open.resolve(got);
  }

  function onNavigation(nav: WebViewNavigation) {
    if (shown.current !== nav.url) {
      shown.current = nav.url;
      setUrl(nav.url);
      session?.moved();
    }
    // A page the run opened is read once it has loaded.
    if (!nav.loading) void session?.loaded(nav.url);
  }

  // A new window of the page (target=_blank, window.open) opens in this one, where the window may go; else nowhere.
  function onOpenWindow(e: { nativeEvent: { targetUrl: string } }) {
    const to = openInTourWindow(e.nativeEvent.targetUrl);
    if (to) web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(to)}); true;`);
  }

  async function answer(yes: boolean) {
    if (!session) return;
    setBusy(true);
    try {
      await session.answer(yes);
    } finally {
      setBusy(false);
    }
  }

  const bar = toursBar(state.view, state.tour, site, url, state.phase, state.limit, lang, (k) => t(k));

  if (!info) {
    // A tour this version doesn't read (an older link): nothing to open.
    return (
      <View style={s.scroll}>
        <Body warn>{t('error.generic')}</Body>
        <Button label={t('rankings.done')} onPress={done} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.bar, { flexWrap: 'wrap', gap: 8 }]}>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Title>{info.name}</Title>
          {state.unread && <Body warn>{t('error.generic')}</Body>}
          {!!bar.text && (bar.warn ? <Body warn>{bar.text}</Body> : <Small>{bar.text}</Small>)}
        </View>
        <View style={{ gap: 6 }}>
          {bar.ask && <Button label={tr('pro.yes')} busy={busy} onPress={() => void answer(true)} />}
          {bar.ask && <Button label={tr('pro.no')} kind="secondary" disabled={busy} onPress={() => void answer(false)} />}
          {bar.send && url && session && <Button label={tr('proLine.send')} onPress={() => void session.send(url)} />}
          {bar.fetchAll && url && session && <Button label={tr('line.fetchAll')} kind="secondary" onPress={() => void session.fetchAll(url)} />}
          {bar.stop && session && <Button label={tr('line.stop')} kind="secondary" onPress={() => void session.stop()} />}
          {state.unread && session && <Button label={t('rankings.reload')} kind="secondary" onPress={() => void session.loadView()} />}
          <Button label={t('rankings.done')} kind="secondary" onPress={done} />
        </View>
      </View>
      {start === null ? null : failed ? (
        <View style={s.scroll}>
          <Body warn>{t('rankings.failed')}</Body>
          <Button
            label={t('rankings.reload')}
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
          source={{ uri: start }}
          injectedJavaScriptBeforeContentLoaded={TOURS_PAGE_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          onNavigationStateChange={onNavigation}
          onOpenWindow={onOpenWindow}
          onError={() => setFailed(true)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          originWhitelist={tourWindowRules.originWhitelist}
          onShouldStartLoadWithRequest={tourWindowRules.onShouldStartLoadWithRequest}
          style={{ flex: 1 }}
        />
      )}
    </View>
  );
}
