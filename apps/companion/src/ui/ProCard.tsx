// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A pro's world ranking and tour pages on the home page (shown once an app is connected for them, or one ended its
 * connection): where to open them (OWGR, Rolex Rankings, each tour the app reads) here in the app, the question whether a page is the player's when an app
 * asks, the connected apps with what each last answered, *Disconnect*. The same parts as the extension's page, in the
 * app's words where those speak of the extension.
 */

import type { ProView } from '@glmsync/browser/pro';
import { proLastText } from '@glmsync/browser/proView';
import { translator } from '@glmsync/browser/i18n';
import { TOUR_SITES, type TourSite } from '@glmsync/provider-tours';
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { lang, t } from '../i18n';
import { hcpEnded } from '../lib/hcpText';
import type { RankingSite } from '../lib/rankingsPage';
import { WINDOW_TOURS } from '../lib/toursPage';
import type { Services } from '../lib/services';
import { Body, Button, Card, colors, s, Small, Title } from './parts';

/** The view, loaded at once and whenever `refresh` is called. */
export function useProView(svc: Services) {
  const [view, setView] = useState<ProView | null>(null);
  const refresh = useCallback(async () => {
    try {
      setView(await svc.pro.view());
    } catch {
      // unreadable for a moment: the card stays as it was
    }
  }, [svc]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { view, setView, refresh };
}

export function ProCard({
  svc,
  view,
  setView,
  open,
  openTour,
}: {
  svc: Services;
  view: ProView;
  setView: (v: ProView) => void;
  open: (site: RankingSite) => void;
  openTour: (site: TourSite) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const tr = translator(lang);
  const now = Date.now();

  async function act(name: string, fn: () => Promise<ProView>) {
    setBusy(name);
    setNote(null);
    try {
      setView(await fn());
    } catch {
      setNote(t('error.generic'));
    } finally {
      setBusy(null);
    }
  }

  function disconnect(id: string, name: string) {
    Alert.alert(tr('pro.disconnect'), tr('pro.disconnectAsk', { name }), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: tr('pro.disconnect'),
        style: 'destructive',
        onPress: () =>
          void act(`off-${id}`, async () => {
            const v = await svc.pro.removePairing(id);
            // With the last app the page kept for the window goes too.
            if (!v.pairings.length) await svc.lastPage.clear().catch(() => undefined);
            return v;
          }),
      },
    ]);
  }

  const q = view.question;
  const names = [...new Set(view.pairings.map((p) => p.name))].join(', ');
  return (
    <Card>
      <Title>{t('pro.cardTitle')}</Title>
      <Small>{t('pro.unofficial')}</Small>
      {view.ended.map((e) => (
        <Body key={`${e.name}-${e.at}`} warn>
          {hcpEnded(e, lang)}
        </Body>
      ))}
      {view.ended.length > 0 && <Button label={t('action.ok')} kind="secondary" busy={busy === 'ended'} onPress={() => void act('ended', () => svc.pro.clearEnded())} />}
      {q && (
        <View style={{ gap: 6 }}>
          <Body warn>{tr('pro.question', { site: q.siteName, name: q.name, targets: q.targets.join(', ') || names })}</Body>
          <Small>{tr('pro.questionWhy')}</Small>
          <View style={s.row}>
            <Button label={tr('pro.yes')} busy={busy === 'yes'} disabled={!!busy} onPress={() => void act('yes', () => svc.pro.answer(true))} />
            <Button label={tr('pro.no')} kind="secondary" disabled={!!busy} onPress={() => void act('no', () => svc.pro.answer(false))} />
          </View>
        </View>
      )}
      {view.pairings.length > 0 && (
        <>
          <Body muted>{t('pro.how', { name: names })}</Body>
          <View style={s.row}>
            <Button label={tr('pro.openOwgr')} onPress={() => open('owgr')} />
            <Button label={tr('pro.openRolex')} kind="secondary" onPress={() => open('rolex')} />
          </View>
          <Body muted>{t('tours.how', { name: names })}</Body>
          <View style={s.row}>
            {WINDOW_TOURS.map((tour) => (
              <Button key={tour} label={t('tours.open', { tour: TOUR_SITES[tour]?.name ?? tour })} kind="secondary" onPress={() => openTour(tour)} />
            ))}
          </View>
        </>
      )}
      {note && <Body warn>{note}</Body>}
      {view.pairings.map((p) => (
        <View key={p.id} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }}>
          <Body>{tr('pro.connected', { name: p.name })}</Body>
          <Small>{p.host}</Small>
          <Small>{proLastText(p, tr, lang, now) ?? tr('pro.none')}</Small>
          <View style={s.row}>
            <Button label={tr('pro.disconnect')} kind="danger" busy={busy === `off-${p.id}`} onPress={() => disconnect(p.id, p.name)} />
          </View>
        </View>
      ))}
    </Card>
  );
}
