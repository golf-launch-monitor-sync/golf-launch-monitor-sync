// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode (spec/test-mode.md): the connected app's test code, typed here or brought by its link (a QR code on its
 * test page opens one), for one of this phone's pairings - a test code never pairs. The scenario comes from that
 * app with the pairing's import token; "Is this your account?" asks about it as about a sign-in, through the guard,
 * and nothing is kept or synced before the yes. Then the first sync, as after signing in.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { TEST_CODE, type TestScenario } from '@glmsync/spec';
import { translator } from '@glmsync/browser/i18n';
import { whoLine } from '@glmsync/browser/wizard';
import { lang, t } from '../i18n';
import type { KeyedPairing } from '../lib/pairings';
import type { WhoAnswer } from '../lib/runner';
import type { Services } from '../lib/services';
import { testErrorText, when } from '../lib/text';
import type { Screen } from './App';
import { Body, Button, Card, colors, s, Small, Title } from './parts';

type Step =
  | { name: 'enter'; error?: string }
  | { name: 'fetching' }
  | { name: 'confirm'; pairing: KeyedPairing; scenario: TestScenario; who: WhoAnswer }
  | { name: 'error'; text: string };

/** A code as typed: spaces a tester may copy or type along are taken out (a code has none). */
export const cleanCode = (typed: string) => typed.replace(/\s+/g, '');

export function TestView({ svc, keys, code: linked, go }: { svc: Services; keys: string[]; code?: string; go: (s: Screen) => void }) {
  const pairings = keys.map((k) => svc.pairings.get(k)).filter((p): p is KeyedPairing => !!p);
  const [code, setCode] = useState(linked ?? '');
  const [chosen, setChosen] = useState<string | null>(pairings.length === 1 ? (pairings[0] as KeyedPairing).key : null);
  const [step, setStep] = useState<Step>({ name: 'enter' });
  const [saving, setSaving] = useState(false);
  const home = () => go({ name: 'home' });

  const fetchTest = useCallback(
    async (key: string, typed: string) => {
      const c = cleanCode(typed);
      if (!TEST_CODE.test(c)) {
        setStep({ name: 'enter', error: t('test.codeWrong') });
        return;
      }
      const pairing = svc.pairings.get(key);
      if (!pairing) {
        setStep({ name: 'error', text: t('test.pairFirst') });
        return;
      }
      setStep({ name: 'fetching' });
      try {
        const scenario = await svc.runner.testScenario(key, c);
        const who = await svc.runner.testWho(scenario);
        setStep({ name: 'confirm', pairing, scenario, who });
      } catch (e) {
        setStep({ name: 'error', text: testErrorText(e, Date.now(), lang, t) });
      }
    },
    [svc],
  );

  // A link with a code, for one pairing: the test is fetched at once (a request to that app only, nothing kept yet).
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !linked || pairings.length !== 1) return;
    started.current = true;
    void fetchTest((pairings[0] as KeyedPairing).key, linked);
  }, [linked, pairings, fetchTest]);

  async function yes(pairing: KeyedPairing, scenario: TestScenario, who: WhoAnswer) {
    setSaving(true);
    try {
      await svc.runner.startTest(pairing.key, scenario, who.player);
    } catch {
      setSaving(false);
      setStep({ name: 'error', text: t('test.notKept') });
      return;
    }
    // The first sync from the scenario now, while the app is in front; then the history a chunk at a time (App).
    go({ name: 'first', target: pairing.base });
  }

  let content;
  if (pairings.length === 0) {
    content = (
      <Card>
        <Title>{t('test.title')}</Title>
        <Body warn>{t('test.pairFirst')}</Body>
        <Button label={t('action.back')} kind="secondary" onPress={home} />
      </Card>
    );
  } else if (step.name === 'enter') {
    content = (
      <Card>
        <Title>{t('test.title')}</Title>
        <Body muted>{t('test.what')}</Body>
        <Small>{t('test.codeLabel')}</Small>
        <TextInput
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          maxLength={80}
          returnKeyType="go"
          accessibilityLabel={t('test.codeLabel')}
          onSubmitEditing={() => chosen && void fetchTest(chosen, code)}
          style={{ color: colors.text, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 12, fontSize: 18, letterSpacing: 2 }}
        />
        {pairings.length > 1 && (
          <View style={{ gap: 6 }}>
            <Small>{t('test.forWhich')}</Small>
            {pairings.map((p) => (
              <Button key={p.key} label={p.target.name} kind={chosen === p.key ? 'primary' : 'secondary'} onPress={() => setChosen(p.key)} />
            ))}
          </View>
        )}
        {step.error && <Body warn>{step.error}</Body>}
        <Button label={t('test.fetch')} onPress={() => chosen && void fetchTest(chosen, code)} disabled={!chosen || !cleanCode(code)} />
        <Button label={t('action.cancel')} kind="secondary" onPress={home} />
      </Card>
    );
  } else if (step.name === 'fetching') {
    content = (
      <Card>
        <Title>{t('test.fetching')}</Title>
        <Body muted>{t('signin.checkingWhy')}</Body>
      </Card>
    );
  } else if (step.name === 'confirm') {
    const now = Date.now();
    const { pairing, scenario, who } = step;
    const facts = whoLine(who.activities, translator(lang), lang);
    content = (
      <Card>
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
          <Title>{t('signin.isThisYou')}</Title>
          <Text style={s.badge}>{t('test.badge')}</Text>
        </View>
        <Body>{who.player ?? t('signin.noName')}</Body>
        {/* The newest activity, no count (as for a real account: a number there read as data on its way). */}
        {facts && <Body muted>{facts}</Body>}
        <Body muted>{t('test.scenario', { name: scenario.name, target: pairing.target.name })}</Body>
        <Small>{t('test.notice', { target: pairing.target.name })}</Small>
        <Small>{t('test.until', { until: when(scenario.valid_until, now, lang, t) })}</Small>
        <Button label={t('signin.yes')} onPress={() => void yes(pairing, scenario, who)} busy={saving} />
        <Button label={t('action.cancel')} kind="secondary" onPress={home} disabled={saving} />
      </Card>
    );
  } else {
    content = (
      <Card>
        <Title>{t('signin.failed')}</Title>
        <Body warn>{step.text}</Body>
        <Button label={t('action.retry')} onPress={() => setStep({ name: 'enter' })} />
        <Button label={t('action.cancel')} kind="secondary" onPress={home} />
      </Card>
    );
  }
  return <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">{content}</ScrollView>;
}
