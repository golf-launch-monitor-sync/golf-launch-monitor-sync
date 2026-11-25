// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages of his tour in the app's own window (spec/prores.md), with the extension's very reading in
 * the page script (src/lib/toursPageScript.ts):
 *
 * - The Pro Golf Tour: he opens his profile there; *Send* in the app's bar has the page script read his ranking and
 *   season, and *Fetch all* opens his finished tournaments' pages one by one at the extension's pace and takes only his
 *   own line of each (lib/toursSession.ts).
 * - DP World Tour and HotelPlanner Tour (europeantour.com, one page per player for both): each page of his is read once
 *   it has loaded and again a moment after he picks another season or tour in the page's own select, kept merged, and
 *   *Send* sends a page per tour (lib/etSession.ts).
 * - The LET and the LET Access Series: her profile is read once it has loaded, on the Order of Merit only her own line;
 *   *Send* sends her profile with her rank (lib/ocsSession.ts). The sites change their address without loading a page,
 *   so the page script tells the window when it did (`readMovedMessage`), as the web view doesn't always.
 *
 * The page loads as this phone's web view is: its own engine and user agent, nothing added. The app sends the site
 * nothing of its own, and nothing the page opens leaves the window (lib/toursPage.ts, `tourWindowRules`). The window
 * opens on his page last sent from here, else on the tour's list of players, where he finds his name.
 */

import { translator } from '@glmsync/browser/i18n';
import { TOUR_SITES, type TourSite } from '@glmsync/provider-tours';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { lang, t } from '../i18n';
import { askId, dayOf } from '../lib/rankingsPage';
import type { Services } from '../lib/services';
import { EtSession, type EtState } from '../lib/etSession';
import { OcsSession, type OcsState } from '../lib/ocsSession';
import { ANSWER_MS, isEt, isOcs, keptTourPage, openInTourWindow, readMovedMessage, readPickMessage, readScript, readTourMessage, sameWindow, tourWindowRules, type TourAnswer } from '../lib/toursPage';
import { TOURS_PAGE_SCRIPT } from '../lib/toursPageScript';
import { TourSession, type TourState } from '../lib/toursSession';
import { etBar, ocsBar, toursBar } from '../lib/toursText';
import { Body, Button, s, Small, Title } from './parts';

export function ToursView({ svc, site, done }: { svc: Services; site: TourSite; done: () => void }) {
  const info = TOUR_SITES[site];
  /** europeantour.com: its own way of reading (each page of his, no *Fetch all*). */
  const et = isEt(site);
  /** The LET's tours: their own way too (her profile, her line of the Order of Merit, no *Fetch all*). */
  const lets = isOcs(site) ? site : null;
  const [state, setState] = useState<TourState>({ view: null, unread: false, tour: null, phase: 'ready', limit: false });
  const [etState, setEtState] = useState<EtState>({ view: null, unread: false, et: null, phase: 'ready', sent: null });
  const [ocsState, setOcsState] = useState<OcsState>({ view: null, unread: false, ocs: null, phase: 'ready', note: null });
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
  /** The address last told the sessions as loaded (the LET's page script tells a move the web view may have told as loading). */
  const loadedAt = useRef<string | null>(null);
  const tr = translator(lang);

  /** Made with the window and closed with it (a remount, as React's strict mode does, gets a session of its own). */
  const [session, setSession] = useState<TourSession | null>(null);
  const [etSession, setEtSession] = useState<EtSession | null>(null);
  const [ocsSession, setOcsSession] = useState<OcsSession | null>(null);

  useEffect(() => {
    let live = true;
    /** Ask the page script for a read of the page shown; one at a time, no answer in time taken as none. */
    const read = (who: string | null) =>
      new Promise<TourAnswer | null>((resolve) => {
        if (ask.current) {
          resolve(null); // one read at a time
          return;
        }
        const id = askId();
        const script = readScript(id, who, dayOf(new Date()));
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
      });
    const today = () => dayOf(new Date());
    let close: () => void;
    if (lets) {
      const made = new OcsSession({ site: lets, keeper: svc.ocs, pro: svc.pro, lastPage: svc.lastPage, read, today, onChange: (st) => live && setOcsState(st) });
      setOcsSession(made);
      setEtSession(null);
      setSession(null);
      void made.start();
      close = () => made.close();
    } else if (et) {
      const made = new EtSession({ keeper: svc.et, pro: svc.pro, lastPage: svc.lastPage, read: () => read(null), today, onChange: (st) => live && setEtState(st) });
      setEtSession(made);
      setOcsSession(null);
      setSession(null);
      void made.start();
      close = () => made.close();
    } else {
      const made = new TourSession({
        keeper: svc.tours,
        pro: svc.pro,
        lastPage: svc.lastPage,
        read,
        open: (to) => web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(to)}); true;`),
        today,
        onChange: (st) => live && setState(st),
      });
      setSession(made);
      setEtSession(null);
      setOcsSession(null);
      void made.start();
      close = () => void made.close();
    }
    // His page of this tour last sent from here, else the tour's list of players.
    void svc.lastPage.get().then(
      (last) => live && setStart(keptTourPage(last) && sameWindow(last, site) ? (last as string) : (info?.start ?? null)),
      () => live && setStart(info?.start ?? null),
    );
    return () => {
      live = false;
      if (ask.current) {
        clearTimeout(ask.current.timer);
        ask.current.resolve(null);
        ask.current = null;
      }
      close();
    };
  }, [svc, site, info, et, lets]);

  /** The window shows `to` (`loaded`: it has loaded): every session hears of a new address once. */
  function show(to: string, loaded: boolean) {
    if (shown.current !== to) {
      shown.current = to;
      setUrl(to);
      session?.moved();
      etSession?.moved(to);
      ocsSession?.moved(to);
    }
    // A page the run opened (the Pro Golf Tour), a page of his (europeantour.com, the LET's) is read once it has loaded.
    if (loaded) {
      loadedAt.current = to;
      void session?.loaded(to);
      void etSession?.loaded(to);
      void ocsSession?.loaded(to);
    }
  }

  function onMessage(e: WebViewMessageEvent) {
    // The LET's sites changed their address without loading a page: the window's address is a new page of theirs.
    if (ocsSession && readMovedMessage(e.nativeEvent.url, e.nativeEvent.data)) {
      if (loadedAt.current !== e.nativeEvent.url) show(e.nativeEvent.url, true);
      return;
    }
    // europeantour.com: he picked another season or tour in the page's own select - read it again a moment later.
    if (etSession && readPickMessage(e.nativeEvent.url, e.nativeEvent.data)) {
      etSession.picked(e.nativeEvent.url);
      return;
    }
    const open = ask.current;
    const got = readTourMessage(e.nativeEvent.url, e.nativeEvent.data, open?.id ?? null);
    if (!open || !got) return; // not an answer to the open ask, or not from the tour's page: nothing to take
    clearTimeout(open.timer);
    ask.current = null;
    open.resolve(got);
  }

  function onNavigation(nav: WebViewNavigation) {
    show(nav.url, !nav.loading);
  }

  // A new window of the page (target=_blank, window.open) opens in this one, where the window may go; else nowhere.
  function onOpenWindow(e: { nativeEvent: { targetUrl: string } }) {
    const to = openInTourWindow(e.nativeEvent.targetUrl);
    if (to) web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(to)}); true;`);
  }

  async function answer(yes: boolean) {
    const s = ocsSession ?? etSession ?? session;
    if (!s) return;
    setBusy(true);
    try {
      await s.answer(yes);
    } finally {
      setBusy(false);
    }
  }

  const bar = lets
    ? ocsBar(ocsState.view, ocsState.ocs, lets, url, ocsState.phase, ocsState.note, lang, (k) => t(k))
    : et
      ? etBar(etState.view, url, etState.phase, etState.sent, lang, (k) => t(k))
      : toursBar(state.view, state.tour, site, url, state.phase, state.limit, lang, (k) => t(k));
  const unread = lets ? ocsState.unread : et ? etState.unread : state.unread;
  const loadView = () => void (ocsSession ?? etSession ?? session)?.loadView();

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
          {unread && <Body warn>{t('error.generic')}</Body>}
          {!!bar.text && (bar.warn ? <Body warn>{bar.text}</Body> : <Small>{bar.text}</Small>)}
        </View>
        <View style={{ gap: 6 }}>
          {bar.ask && <Button label={tr('pro.yes')} busy={busy} onPress={() => void answer(true)} />}
          {bar.ask && <Button label={tr('pro.no')} kind="secondary" disabled={busy} onPress={() => void answer(false)} />}
          {bar.send && url && session && <Button label={tr('proLine.send')} onPress={() => void session.send(url)} />}
          {bar.send && url && etSession && <Button label={tr('proLine.send')} onPress={() => void etSession.send(url)} />}
          {bar.send && url && ocsSession && <Button label={tr('proLine.send')} onPress={() => void ocsSession.send(url)} />}
          {bar.fetchAll && url && session && <Button label={tr('line.fetchAll')} kind="secondary" onPress={() => void session.fetchAll(url)} />}
          {bar.stop && session && <Button label={tr('line.stop')} kind="secondary" onPress={() => void session.stop()} />}
          {unread && <Button label={t('rankings.reload')} kind="secondary" onPress={loadView} />}
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
