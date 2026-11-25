// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap record on the home page (shown once an app is connected for it, or one ended its connection): the
 * connected apps with what each last answered, what golf.de's pages showed and what is still to send, *Open golf.de*,
 * *Send now*, sending by itself, *Disconnect*. The same parts as the extension's popup, in the app's words where
 * those speak of the extension. Until the first results went out, connecting stands there as steps (the wizard): open
 * golf.de and sign in, *Is this your golf.de account?*, the first results - and no count before the yes.
 */

import type { HcpView } from '@glmsync/browser/hcp';
import { translator } from '@glmsync/browser/i18n';
import { factsOfHcp, hcpWhoLine, targetOf, wizardLines, wizardOf } from '@glmsync/browser/wizard';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import { lang, t } from '../i18n';
import { hcpEnded, hcpLast } from '../lib/hcpText';
import type { Services } from '../lib/services';
import { Body, Button, Card, colors, s, Small, Title } from './parts';
import { WizardFrame } from './WizardFrame';

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
  const facts = factsOfHcp(view);
  const wv = facts ? wizardOf(facts) : null;
  if (facts && wv && wv.step !== 'done') {
    const tr = translator(lang);
    const target = targetOf(view.pairings.map((p) => p.name));
    const lines = wizardLines(wv, facts, tr, { service: 'golf.de', target });
    return (
      <WizardFrame view={wv} lines={lines} spinning={facts.first === 'running'}>
        {wv.step === 'signin' && (
          <>
            {view.account === 'rejected' && <Body warn>{tr('wizard.hcpRejected')}</Body>}
            {view.account !== 'rejected' && view.signed_out && <Body warn>{t('hcp.signedOut')}</Body>}
            {view.account !== 'rejected' && view.waiting && <Body warn>{t('hcp.waiting')}</Body>}
            <Body muted>{t('hcp.what', { name: target ?? tr('wizard.yourApp') })}</Body>
            <Button label={t('hcp.open')} onPress={open} />
          </>
        )}
        {/* Step 3: only the account and yes or no (stepParts). */}
        {wv.step === 'account' && (
          <>
            <Body>{hcpWhoLine(view.index, tr, lang)}</Body>
            <Button
              label={tr('confirm.yes')}
              busy={busy === 'yes'}
              onPress={() =>
                void act('yes', async () => {
                  const v = await svc.hcp.confirm(true);
                  // What was seen goes right after the yes (the next step shows it coming).
                  setView(v);
                  return v.account === 'confirmed' ? svc.hcpSender.now() : v;
                })
              }
            />
            <Button label={tr('confirm.no')} kind="secondary" disabled={busy === 'yes'} onPress={() => void act('no', () => svc.hcp.confirm(false))} />
          </>
        )}
        {wv.step === 'load' && (
          <>
            {facts.first === 'waiting' && <Body muted>{tr('wizard.hcpWaiting', { target: target ?? tr('wizard.yourApp') })}</Body>}
            {facts.first === 'failed' && <Body warn>{view.pairings.map((p) => hcpLast(p, lang, now)).find((x) => !!x) ?? t('error.generic')}</Body>}
            <View style={s.row}>
              <Button label={t('hcp.open')} kind={view.fresh ? 'secondary' : 'primary'} onPress={open} />
              {view.fresh > 0 && <Button label={t('hcp.send')} busy={busy === 'send' || view.sending} onPress={() => void act('send', () => svc.hcpSender.now())} />}
            </View>
          </>
        )}
        {note && <Body warn>{note}</Body>}
        {view.pairings.map((p) => (
          <View key={p.id} style={[s.row, { alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderColor: colors.line, paddingTop: 6 }]}>
            <Small>{p.host}</Small>
            <Button label={t('hcp.disconnect')} kind="danger" busy={busy === `off-${p.id}`} onPress={() => disconnect(p.id, p.name)} />
          </View>
        ))}
      </WizardFrame>
    );
  }
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
