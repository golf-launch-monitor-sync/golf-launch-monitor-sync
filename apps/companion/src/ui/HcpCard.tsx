// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap record on the home page (shown once an app is connected for it, or one ended its connection): the
 * connected apps with what each last answered, what golf.de's pages showed and what is still to send, *Open golf.de*,
 * *Send now*, sending by itself, *Disconnect*. The same parts as the extension's popup, in the app's words where
 * those speak of the extension.
 */

import type { HcpView } from '@glmsync/browser/hcp';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { lang, t } from '../i18n';
import { hcpEnded, hcpLast } from '../lib/hcpText';
import type { Services } from '../lib/services';
import { Body, Button, Card, colors, s, Small, Title } from './parts';

/** The view, kept current: loaded at once, after each send of the sender and whenever `refresh` is called. */
export function useHcpView(svc: Services) {
  const [view, setView] = useState<HcpView | null>(null);
  const refresh = useCallback(async () => {
    try {
      setView(await svc.hcp.view());
    } catch {
      // unreadable for a moment: the card stays as it was
    }
  }, [svc]);
  useEffect(() => {
    void refresh();
    return svc.hcpSender.subscribe(setView);
  }, [svc, refresh]);
  return { view, setView, refresh };
}

export function HcpCard({ svc, view, setView, open }: { svc: Services; view: HcpView; setView: (v: HcpView) => void; open: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = Date.now();

  async function act(name: string, fn: () => Promise<HcpView | null>) {
    setBusy(name);
    setNote(null);
    try {
      const v = await fn();
      if (v) setView(v);
    } catch {
      setNote(t('error.generic'));
    } finally {
      setBusy(null);
    }
  }

  function disconnect(id: string, name: string) {
    Alert.alert(t('hcp.disconnectTitle', { name }), t('hcp.disconnectText'), [
      { text: t('action.cancel'), style: 'cancel' },
      { text: t('hcp.disconnect'), style: 'destructive', onPress: () => void act(`off-${id}`, () => svc.hcp.removePairing(id)) },
    ]);
  }

  const live = view.pairings.filter((p) => !p.other_account);
  const notes = [view.waiting ? t('hcp.waiting') : null, view.signed_out ? t('hcp.signedOut') : null, view.changed_page ? t('hcp.changed') : null].filter(
    (x): x is string => !!x,
  );
  return (
    <Card>
      <Title>{t('hcp.title')}</Title>
      {view.ended.map((e) => (
        <Body key={`${e.name}-${e.at}`} warn>
          {hcpEnded(e, lang)}
        </Body>
      ))}
      {view.ended.length > 0 && <Button label={t('action.ok')} kind="secondary" busy={busy === 'ended'} onPress={() => void act('ended', () => svc.hcp.clearEnded())} />}
      {view.pairings.map((p) => {
        const last = hcpLast(p, lang, now);
        return (
          <View key={p.id} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }}>
            <Body>{t('hcp.connected', { name: p.name })}</Body>
            <Small>{p.host}</Small>
            {p.other_account && <Body warn>{t('hcp.other', { name: p.name })}</Body>}
            {last && <Small>{last}</Small>}
            <View style={s.row}>
              <Button label={t('hcp.disconnect')} kind="danger" busy={busy === `off-${p.id}`} onPress={() => disconnect(p.id, p.name)} />
            </View>
          </View>
        );
      })}
      {view.pairings.length > 0 && (
        <>
          <Body muted>{t('hcp.what', { name: (live[0] ?? view.pairings[0])?.name ?? '' })}</Body>
          <Body>{view.seen ? t('hcp.seen', { seen: view.seen, fresh: view.fresh }) : t('hcp.seenNone')}</Body>
          {notes.map((n) => (
            <Body key={n} warn>
              {n}
            </Body>
          ))}
          {note && <Body warn>{note}</Body>}
          <View style={s.row}>
            <Button label={t('hcp.open')} onPress={open} />
            {view.fresh > 0 && live.length > 0 && (
              <Button label={t('hcp.send')} kind="secondary" busy={busy === 'send' || view.sending} onPress={() => void act('send', () => svc.hcpSender.now())} />
            )}
          </View>
          <View style={[s.row, { alignItems: 'center' }]}>
            <Switch
              value={view.auto}
              onValueChange={(auto) => void act('auto', () => svc.hcp.setAuto(auto))}
              disabled={busy === 'auto'}
              accessibilityLabel={t('hcp.auto')}
            />
            <Text style={s.body}>{t('hcp.auto')}</Text>
          </View>
          <Small>{t('hcp.limits')}</Small>
        </>
      )}
    </Card>
  );
}
