// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The main view: *Connect new* and the list of connections (Connections.tsx; one per provider account, per pairing in
 * test mode, and golf.de's record), each with where it stands. A row opens its details (`focus`): the provider's
 * sign-in (with how much was asked of the provider today), the apps it goes to and how their last sync went, fetching
 * now, the request log to export - or the handicap record read along on golf.de (HcpCard), a pro's world ranking
 * pages (ProCard), a test's card, or a pairing its app ended (pair again there, or take it off the list). Under
 * Trackman's sign-in, small, *Enter a test code* instead; a connection in test mode never asks for the sign-in.
 *
 * `linked` (spec 1.18.0, lib/done.ts): a link brought the player here for this one connection and there was no way back
 * to its app - its card alone, *Done* instead of the way to the list, nothing of the other connections.
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
import { targetOf } from '@glmsync/browser/wizard';
import { beforeYes, testKeys, wizardText } from '../lib/wizard';
import { connectionsOfApp } from '../lib/connections';
import { BackToList, Connections } from './Connections';
import { HcpCard, useHcpView } from './HcpCard';
import { ProCard, useProView } from './ProCard';
import { translator } from '@glmsync/browser/i18n';
import { Body, Button, Card, colors, s, Small, Title } from './parts';
import { WakeHints } from './WakeHints';
import { WizardFrame } from './WizardFrame';

const REPO = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync';

export function Home({
  svc,
  focus,
  linked,
  message,
  dismiss,
  go,
  renewing,
}: {
  svc: Services;
  /** The connection whose details are open (`lm:<provider>`, `test:<key>`, `hcp`, `pro`); none: the list. */
  focus?: string;
  /** A link's focus: this card alone, no way to the list but *Done*. */
  linked?: boolean;
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
  const hcp = useHcpView(svc);
  const pro = useProView(svc);

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
  const hcpShown = !!hcp.view && (hcp.view.pairings.length > 0 || hcp.view.ended.length > 0);
  const proShown = !!pro.view && (pro.view.pairings.length > 0 || pro.view.ended.length > 0);
  // Only the handicap record (or a pro's pages) connected, and no launch monitor sign-in ever: its cards would only be
  // in the way.
  const otherKind = (!!hcp.view && hcp.view.pairings.length > 0) || (!!pro.view && pro.view.pairings.length > 0);
  const hcpOnly = otherKind && pairings.length === 0 && !svc.signIns.get('trackman') && !svc.signIns.had('trackman');
  const shown = PROVIDERS.filter((p) => (p === 'trackman' && !hcpOnly) || svc.signIns.get(p) || svc.signIns.had(p) || pairings.some((x) => x.provider === p));
  // Paired, but never signed in here (or the account not confirmed): the wizard's first step, said big - not a card
  // that looks as if things were running.
  const lmPairings = pairings.filter((p) => p.provider === 'trackman' && !svc.tests.of(p.key));
  const setup = lmPairings.length > 0 && !svc.signIns.valid('trackman') && !svc.signIns.had('trackman');
  const list = connectionsOfApp({
    providers: PROVIDERS.map((id) => ({ id, name: svc.providers[id].name })),
    pairings,
    tests: tests.map((m) => ({ key: m.key, player: m.player })),
    signIn: (id) => ({ valid: svc.signIns.valid(id), had: !!svc.signIns.had(id), player: svc.signIns.get(id)?.player ?? null }),
    lastRun: (key) => svc.runner.lastRun(key),
    ended: svc.pairings.ended(),
    hcp: hcp.view,
    pro: { view: pro.view, service: translator(lang)('pro.service') },
  });
  const lmFocus = focus?.startsWith('lm:') ? focus.slice(3) : null;
  const testFocus = focus?.startsWith('test:') ? focus.slice(5) : null;
  const endedFocus = focus?.startsWith('ended:') ? svc.pairings.ended().find((e) => e.key === focus.slice(6)) ?? null : null;
  const toList = () => go({ name: 'home' });
  // The details' apps: the provider's pairings (its test pairings too), or the one in test mode.
  const focused = pairings.filter((p) => (lmFocus ? p.provider === lmFocus : p.key === testFocus));
  // Under Trackman's sign-in, small, a test code instead (for its pairings not in test mode); nowhere else.
  const testable = testKeys(pairings, 'trackman', (k) => !!svc.tests.of(k));
  const setupText = setup ? wizardText(beforeYes(false), lang, { service: svc.providers.trackman.name, target: targetOf(lmPairings.map((p) => p.target.name)) }) : null;

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <View style={{ gap: 4 }}>
        <Text style={s.heading} accessibilityRole="header">
          {t('app.name')}
        </Text>
        {!focus && <Body muted>{t('app.what')}</Body>}
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
      {build && !focus && (
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

      {(!focus || linked) && <WakeHints paired={pairings.length > 0} />}

      {!focus && <Connections list={list} add={() => go({ name: 'new' })} open={(id) => go({ name: 'home', focus: id })} />}
      {focus && !linked && <BackToList onPress={toList} />}

      {lmFocus === 'trackman' && setupText && (
        <WizardFrame view={setupText.view} lines={setupText.lines}>
          <Small>{t('provider.trackman.unofficial')}</Small>
          <Button label={t('provider.signIn')} onPress={() => go({ name: 'signin', provider: 'trackman' })} />
          {testable.length > 0 && <TestLink onPress={() => go({ name: 'test', keys: testable })} />}
        </WizardFrame>
      )}

      {endedFocus && (
        <Card>
          <Title>{svc.providers[endedFocus.provider as ProviderId]?.name ?? endedFocus.provider}</Title>
          <Body warn>{translator(lang)('connections.state.ended', { target: endedFocus.target.name })}</Body>
          <View style={s.row}>
            <Button
              label={t('ended.remove')}
              kind="secondary"
              busy={busy === `ended-${endedFocus.key}`}
              onPress={() =>
                void act(`ended-${endedFocus.key}`, async () => {
                  await svc.pairings.forgetEnded(endedFocus.key);
                  toList();
                })
              }
            />
          </View>
        </Card>
      )}

      {focus === 'hcp' && hcpShown && hcp.view && <HcpCard svc={svc} view={hcp.view} setView={hcp.setView} open={() => go({ name: 'golfde' })} />}

      {focus === 'pro' && proShown && pro.view && <ProCard svc={svc} view={pro.view} setView={pro.setView} open={(site) => go({ name: 'rankings', site })} openTour={(site) => go({ name: 'tours', site })} />}

      {tests
        .filter((m) => testFocus === m.key)
        .map((m) => {
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

      {shown
        .filter((id) => lmFocus === id && !(id === 'trackman' && setupText))
        .map((id) => {
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
              {id === 'trackman' && (!valid || !signIn) && testable.length > 0 && <TestLink onPress={() => go({ name: 'test', keys: testable })} />}
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

      {(lmFocus || testFocus) && (
        <Card>
          <Title>{t('targets.title')}</Title>
          {focused.length === 0 ? (
            <Body muted>{t('targets.none')}</Body>
          ) : (
            focused.map((p) => (
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
          {focused.length > 0 && (
            <Button
              label={t('sync.now')}
              busy={busy === 'sync'}
              // A tap waits for a sync under way rather than fetching the same again (SY-5): it says which it does.
              busyLabel={svc.runner.syncing()?.reason === 'manual' ? t('sync.running') : t('sync.joining')}
              onPress={() => void act('sync', () => svc.runner.syncAll('manual'))}
            />
          )}
          <Small>{t('targets.plan')}</Small>
        </Card>
      )}

      {lmFocus && (
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
      )}

      {/* The link's card: *Done* ends its focus; the list is what the player then opens. */}
      {focus && linked && <Button label={translator(lang)('wizard.title.done')} onPress={toList} />}

      <View style={{ gap: 8, paddingBottom: 24 }}>
        {!focus && (
          <>
            <Pressable accessibilityRole="link" onPress={() => go({ name: 'licenses' })}>
              <Text style={s.link}>{t('licenses.title')}</Text>
            </Pressable>
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(REPO).catch(() => undefined)}>
              <Text style={s.link}>{t('about.source')}</Text>
            </Pressable>
            <Small>{t('about.line', { version })}</Small>
          </>
        )}
      </View>
    </ScrollView>
  );
}

/** Small, under the sign-in: *Enter a test code* instead of it (test mode). */
function TestLink({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      <Text style={[s.link, { fontSize: 13 }]}>{t('test.enter')}</Text>
    </Pressable>
  );
}
