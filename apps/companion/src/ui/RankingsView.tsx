// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own page of a world ranking in the app's own window (spec/prores.md): the OWGR for men, the Rolex
 * Rankings for women. The player searches for their name there and opens their page; *Send* in the app's bar has the
 * page script (src/lib/rankingsPageScript.ts) read what the page shows - with the extension's very reading - and the
 * app sends it to the connected apps after their plans. Nothing is read before the tap.
 *
 * When an app finds another name on the page than the player's, it asks right here in the bar (the site's page can't
 * reach it). The page loads as this phone's web view is: its own engine and user agent, nothing added. The app sends the
 * sites nothing of its own, and nothing the page opens leaves the window (lib/rankingsPage.ts, `rankingsWindowRules`).
 *
 * The window opens on the page last sent from here, else on the chosen site's ranking (its search), else it asks which
 * ranking first.
 */

import type { ProView } from '@glmsync/browser/pro';
import { translator } from '@glmsync/browser/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import { lang, t } from '../i18n';
import {
  ANSWER_MS,
  askId,
  dayOf,
  openInRankingsWindow,
  playerPageOf,
  rankingsWindowRules,
  readRankingMessage,
  readScript,
  SITES,
  type RankingSite,
} from '../lib/rankingsPage';
import { RANKINGS_PAGE_SCRIPT } from '../lib/rankingsPageScript';
import { rankingsBar, type LinePhase } from '../lib/rankingsText';
import type { Services } from '../lib/services';
import { Body, Button, s, Small, Title } from './parts';

export function RankingsView({ svc, site, done }: { svc: Services; site?: RankingSite; done: () => void }) {
  const [view, setView] = useState<ProView | null>(null);
  /** Where the window opens: null while it is decided, '' to ask which ranking first. */
  const [start, setStart] = useState<string | null>(site ? SITES[site].start : null);
  const [url, setUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<LinePhase>('ready');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The connections couldn't be read: said, with *Load again*. */
  const [unread, setUnread] = useState(false);
  const [key, setKey] = useState(0);
  const web = useRef<WebView<object>>(null);
  /** The open ask of a *Send*: the page script's answer must name it. */
  const ask = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The page the window shows (also in `url`, for drawing). */
  const shown = useRef<string | null>(null);
  const tr = translator(lang);

  const stopWaiting = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    ask.current = null;
  }, []);

  const load = useCallback(() => {
    setUnread(false);
    svc.pro.view().then(setView, () => setUnread(true));
  }, [svc]);

  useEffect(() => {
    let live = true;
    load();
    if (!site) {
      void svc.lastPage.get().then((last) => {
        if (live) setStart(last ?? '');
      });
    }
    return () => {
      live = false;
      stopWaiting();
    };
  }, [svc, site, stopWaiting, load]);

  function open(s: RankingSite) {
    stopWaiting();
    setPhase('ready');
    setFailed(false);
    setStart(SITES[s].start);
    setKey((k) => k + 1);
  }

  function send() {
    if (ask.current || !playerPageOf(url)) return;
    const id = askId();
    const script = readScript(id, dayOf(new Date()));
    if (!script) return;
    ask.current = id;
    setPhase('reading');
    // No answer in time (the page went away, a script of the site in the way): said, and Send offered again.
    timer.current = setTimeout(() => {
      timer.current = null;
      ask.current = null;
      setPhase('error');
    }, ANSWER_MS);
    web.current?.injectJavaScript(script);
  }

  function onMessage(e: WebViewMessageEvent) {
    const got = readRankingMessage(e.nativeEvent.url, e.nativeEvent.data, ask.current);
    if (!got) return; // not an answer to the open ask, or not from the player's page: nothing to take
    stopWaiting();
    if (!got.ok) {
      setPhase(got.why === 'changed_page' ? 'changed_page' : 'ready');
      return;
    }
    const at = e.nativeEvent.url;
    svc.pro.send(got.page).then(
      (v) => {
        setView(v);
        setPhase('done');
        // Next time the window opens here (only a player's page is kept, only on this phone).
        void svc.lastPage.set(at).catch(() => undefined);
      },
      () => setPhase('error'), // the phone couldn't keep it: said, and Send is offered again
    );
  }

  function onNavigation(nav: WebViewNavigation) {
    if (shown.current === nav.url) return;
    // Another page: whatever the bar said of the last one is over.
    shown.current = nav.url;
    stopWaiting();
    setPhase('ready');
    setUrl(nav.url);
  }

  // A new window of the page (target=_blank, window.open) opens in this one, where the window may go; else nowhere.
  function onOpenWindow(e: { nativeEvent: { targetUrl: string } }) {
    const to = openInRankingsWindow(e.nativeEvent.targetUrl);
    if (to) web.current?.injectJavaScript(`window.location.assign(${JSON.stringify(to)}); true;`);
  }

  async function answer(yes: boolean) {
    setBusy(true);
    try {
      setView(await svc.pro.answer(yes));
      setPhase('done');
    } catch {
      setPhase('error');
    } finally {
      setBusy(false);
    }
  }

  const bar = rankingsBar(view, url, phase, lang, (k) => t(k));
  const here = playerPageOf(url)?.site ?? (url ? (Object.values(SITES).find((x) => url.startsWith(x.origin))?.site ?? null) : null);
  const other: RankingSite | null = here === 'owgr' ? 'rolex' : here === 'rolex' ? 'owgr' : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={[s.bar, { flexWrap: 'wrap', gap: 8 }]}>
        <View style={{ flex: 1, minWidth: 200, gap: 2 }}>
          <Title>{here ? SITES[here].name : tr('pro.service')}</Title>
          {unread && <Body warn>{t('error.generic')}</Body>}
          {start === '' ? <Body>{t('rankings.choose')}</Body> : start !== null && !!bar.text && (bar.warn ? <Body warn>{bar.text}</Body> : <Small>{bar.text}</Small>)}
        </View>
        <View style={{ gap: 6 }}>
          {start === '' && <Button label={tr('pro.openOwgr')} onPress={() => open('owgr')} />}
          {start === '' && <Button label={tr('pro.openRolex')} onPress={() => open('rolex')} />}
          {start !== '' && bar.ask && <Button label={tr('pro.yes')} busy={busy} onPress={() => void answer(true)} />}
          {start !== '' && bar.ask && <Button label={tr('pro.no')} kind="secondary" disabled={busy} onPress={() => void answer(false)} />}
          {start !== '' && bar.send && <Button label={tr('proLine.send')} onPress={send} />}
          {start !== '' && !bar.send && !bar.ask && other && !playerPageOf(url) && (
            <Button label={t('rankings.other')} kind="secondary" onPress={() => open(other)} />
          )}
          {unread && <Button label={t('rankings.reload')} kind="secondary" onPress={load} />}
          <Button label={t('rankings.done')} kind="secondary" onPress={done} />
        </View>
      </View>
      {start === null || start === '' ? null : failed ? (
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
          injectedJavaScriptBeforeContentLoaded={RANKINGS_PAGE_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          onMessage={onMessage}
          onNavigationStateChange={onNavigation}
          onOpenWindow={onOpenWindow}
          onError={() => setFailed(true)}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          originWhitelist={rankingsWindowRules.originWhitelist}
          onShouldStartLoadWithRequest={rankingsWindowRules.onShouldStartLoadWithRequest}
          style={{ flex: 1 }}
        />
      )}
    </View>
  );
}
