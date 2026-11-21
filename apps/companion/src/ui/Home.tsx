// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The one page: the provider sign-ins (with how much was asked of the provider today), the apps this
 * phone is paired with and how their last sync went, fetching now, the request log to export, the
 * demo, the licences.
 */

import type { GuardCounts } from '@glmsync/core';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { lang, t } from '../i18n';
import type { KeyedPairing } from '../lib/pairings';
import type { TestMode } from '../lib/tests';
import { hostOf } from '../lib/links';
import { checkNewBuild, type NewBuild } from '../lib/newBuild';
import { PROVIDERS, type ProviderId, type Services } from '../lib/services';
import { countsText, errorText, runText, when } from '../lib/text';
import { shareFile, version } from '../platform';
import type { Screen } from './App';
import { Body, Button, Card, colors, s, Small, Title } from './parts';

const REPO = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync';

export function Home({
  svc,
  message,
  dismiss,
  go,
  renewing,
}: {
  svc: Services;
  message: string | null;
  dismiss: () => void;
  go: (s: Screen) => void;
  renewing: boolean;
}) {
  const [counts, setCounts] = useState<Partial<Record<ProviderId, GuardCounts | null>>>({});
  const [testCounts, setTestCounts] = useState<Record<string, GuardCounts | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [build, setBuild] = useState<NewBuild | null>(null);
  const pairings = svc.pairings.list();
  const now = Date.now();

  const refreshCounts = useCallback(async () => {
    const out: Partial<Record<ProviderId, GuardCounts | null>> = {};
    for (const p of PROVIDERS) out[p] = await svc.runner.counts(p);
    setCounts(out);
    const tests: Record<string, GuardCounts | null> = {};
    for (const m of svc.tests.list()) tests[m.key] = await svc.runner.testCounts(m.key);
    setTestCounts(tests);
  }, [svc]);

  // The counts follow every run and sign-in.
  useEffect(() => {
    void refreshCounts();
    const offs = [
      svc.runner.subscribe(() => void refreshCounts()),
      svc.signIns.subscribe(() => void refreshCounts()),
      svc.tests.subscribe(() => void refreshCounts()),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [svc, refreshCounts]);

  // A new build (its native part changed, so no update can bring it): said once, when the app starts.
  useEffect(() => {
    let live = true;
    void checkNewBuild(Platform.OS, Updates.runtimeVersion).then((b) => {
      if (live) setBuild(b);
    });
    return () => {
      live = false;
    };
  }, []);

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name);
    setNote(null);
    try {
      await fn();
    } catch (e) {
      setNote(errorText(e, Date.now(), lang, t));
    } finally {
      setBusy(null);
    }
  }

  function signOut(provider: ProviderId) {
    Alert.alert(t('signout.title', { provider: svc.providers[provider].name }), t('signout.text'), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('signout.yes'),
        style: 'destructive',
        onPress: () =>
          void act(`out-${provider}`, async () => {
            svc.runner.stop(); // a run under way with this sign-in stops
            await svc.signIns.forget(provider);
          }),
      },
    ]);
  }

  function unpair(p: KeyedPairing) {
    Alert.alert(t('unpair.title', { target: p.target.name }), t('unpair.text', { target: p.target.name }), [
      { text: t('action.cancel'), style: 'cancel' },
      { text: t('unpair.yes'), style: 'destructive', onPress: () => void act(`unpair-${p.key}`, () => svc.runner.unpair(p.key)) },
    ]);
  }

  function endTest(m: TestMode, target: string) {
    Alert.alert(t('test.endTitle'), t('test.endText', { target }), [
      { text: t('action.cancel'), style: 'cancel' },
      { text: t('test.end'), style: 'destructive', onPress: () => void act(`test-${m.key}`, () => svc.runner.endTest(m.key)) },
    ]);
  }

  const tests = svc.tests.list();
  const shown = PROVIDERS.filter((p) => p === 'trackman' || svc.signIns.get(p) || svc.signIns.had(p) || pairings.some((x) => x.provider === p));

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={{ gap: 4 }}>
        <Text style={s.heading} accessibilityRole="header">
          {t('app.name')}
        </Text>
        <Body muted>{t('app.what')}</Body>
      </View>

      {message && (
        <Card>
          <Body warn>{message}</Body>
          <Button label={t('action.ok')} kind="secondary" onPress={dismiss} />
        </Card>
      )}
      {note && (
        <Card>
          <Body warn>{note}</Body>
        </Card>
      )}
      {build && (
        <Card>
          <Title>{t('newBuild.title')}</Title>
          <Body>{t(build.platform === 'android' ? 'newBuild.android' : 'newBuild.ios')}</Body>
          <View style={s.row}>
            <Button
              label={t(build.platform === 'android' ? 'newBuild.download' : 'newBuild.testflight')}
              onPress={() => void Linking.openURL(build.url).catch(() => setNote(t('newBuild.failed')))}
            />
            <Button label={t('newBuild.later')} kind="secondary" onPress={() => setBuild(null)} />
          </View>
        </Card>
      )}

      {tests.map((m) => {
        const target = svc.pairings.get(m.key)?.target.name ?? '?';
        const line = countsText(testCounts[m.key] ?? null, now, lang, t);
        return (
          <Card key={`test-${m.key}`}>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Title>{t('test.title')}</Title>
              <Text style={s.badge}>{t('test.badge')}</Text>
            </View>
            <Body>{t('test.scenario', { name: m.name, target })}</Body>
            <Body>{t('test.active', { player: m.player ?? t('signin.noName'), since: when(m.at, now, lang, t) })}</Body>
            <Small>{t('test.notice', { target })}</Small>
            <Small>{t('test.until', { until: when(m.valid_until, now, lang, t) })}</Small>
            {line && <Small>{line}</Small>}
            <View style={s.row}>
              <Button label={t('test.end')} kind="secondary" busy={busy === `test-${m.key}`} onPress={() => endTest(m, target)} />
            </View>
          </Card>
        );
      })}

      {shown.map((id) => {
        const p = svc.providers[id];
        const signIn = svc.signIns.get(id);
        const valid = svc.signIns.valid(id);
        const had = svc.signIns.had(id);
        const line = countsText(counts[id] ?? null, now, lang, t);
        return (
          <Card key={id}>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
              <Title>{p.name}</Title>
              <Text style={s.badge}>{id === 'demo' ? t('provider.demo.badge') : t('provider.unofficial')}</Text>
            </View>
            <Small>{id === 'demo' ? t('provider.demo.notice') : t('provider.trackman.unofficial')}</Small>
            {valid && signIn ? (
              <Body>{t('provider.signedIn', { player: signIn.player ?? t('signin.noName'), since: when(signIn.at, now, lang, t) })}</Body>
            ) : had ? (
              <Body warn>{renewing && id === 'trackman' ? t('provider.renewing') : t('provider.expired')}</Body>
            ) : (
              <Body muted>{t('provider.signedOut')}</Body>
            )}
            {line && <Small>{line}</Small>}
            <View style={s.row}>
              {(!valid || !signIn) && <Button label={had ? t('provider.signInAgain') : t('provider.signIn')} onPress={() => go({ name: 'signin', provider: id })} />}
              {valid && (
                <Button
                  label={t('file.save')}
                  kind="secondary"
                  busy={busy === `file-${id}`}
                  onPress={() =>
                    void act(`file-${id}`, async () => {
                      const run = await svc.runner.toFile(id);
                      setNote(run.status === 'synced' ? null : runText(run, Date.now(), lang, t));
                    })
                  }
                />
              )}
              {(signIn || had) && <Button label={t('provider.signOut')} kind="secondary" busy={busy === `out-${id}`} onPress={() => signOut(id)} />}
            </View>
          </Card>
        );
      })}

      <Card>
        <Title>{t('targets.title')}</Title>
        {pairings.length === 0 ? (
          <Body muted>{t('targets.none')}</Body>
        ) : (
          pairings.map((p) => (
            <View key={p.key} style={{ gap: 4, paddingVertical: 6, borderTopWidth: 1, borderColor: colors.line }}>
              <Body>{p.target.name}</Body>
              <Small>
                {hostOf(p.base)} · {svc.providers[p.provider as ProviderId]?.name ?? p.provider}
              </Small>
              {svc.tests.of(p.key) && <Small>{t('test.pairingLine', { name: svc.tests.of(p.key)?.name ?? '' })}</Small>}
              <Small>{runText(svc.runner.lastRun(p.key), now, lang, t)}</Small>
              <View style={s.row}>
                <Button label={t('unpair.button')} kind="danger" busy={busy === `unpair-${p.key}`} onPress={() => unpair(p)} />
              </View>
            </View>
          ))
        )}
        {pairings.length > 0 && (
          <Button label={t('sync.now')} busy={busy === 'sync'} onPress={() => void act('sync', () => svc.runner.syncAll('manual'))} />
        )}
        <Small>{t('targets.plan')}</Small>
      </Card>

      {!shown.includes('demo') && (
        <Card>
          <Title>{t('demo.title')}</Title>
          <Body muted>{t('demo.text')}</Body>
          <Button label={t('demo.button')} kind="secondary" onPress={() => go({ name: 'signin', provider: 'demo' })} />
        </Card>
      )}

      <Card>
        <Title>{t('log.title')}</Title>
        <Body muted>{t('log.text')}</Body>
        <Button
          label={t('log.export')}
          kind="secondary"
          busy={busy === 'log'}
          onPress={() => void act('log', async () => shareFile(await svc.runner.logFile()))}
        />
      </Card>

      <View style={{ gap: 8, paddingBottom: 24 }}>
        <Pressable accessibilityRole="link" onPress={() => go({ name: 'test', keys: pairings.map((p) => p.key) })}>
          <Text style={s.link}>{t('test.enter')}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => go({ name: 'licenses' })}>
          <Text style={s.link}>{t('licenses.title')}</Text>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(REPO).catch(() => undefined)}>
          <Text style={s.link}>{t('about.source')}</Text>
        </Pressable>
        <Small>{t('about.line', { version })}</Small>
      </View>
    </ScrollView>
  );
}
