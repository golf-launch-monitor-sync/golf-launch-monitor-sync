// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Test mode (spec/test-mode.md): the connected app's test code instead of the provider's sign-in - the wizard's step 2
 * (*Enter a test code*, small under the sign-in), typed here or brought by its link (a QR code on its test page opens
 * one), for one of this phone's pairings; a test code never pairs. The scenario comes from that app with the pairing's
 * import token; step 3, "Is this your account?", asks about its made-up account as about a sign-in, through the guard,
 * with only the account and yes or no; nothing is kept or synced before the yes. Then the first sync, as after signing
 * in. A wrong or expired code stays on step 2 with its sentence.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { TEST_CODE, type TestScenario } from '@glmsync/spec';
import { translator } from '@glmsync/browser/i18n';
import { stepParts, targetOf, whoLine } from '@glmsync/browser/wizard';
import { lang, t } from '../i18n';
import type { KeyedPairing, WhoAnswer } from '@glmsync/engine';
import type { Services } from '../lib/services';
import { testErrorText } from '../lib/text';
import { beforeYes, testAccount, wizardText } from '../lib/wizard';
import type { Screen } from './App';
import { Body, Button, colors, s, Small } from './parts';
import { WizardFrame } from './WizardFrame';

type Step =
  | { name: 'enter'; error?: string }
  | { name: 'fetching' }
  | { name: 'confirm'; pairing: KeyedPairing; scenario: TestScenario; who: WhoAnswer };

/** A code as typed: spaces a tester may copy or type along are taken out (a code has none). */
export const cleanCode = (typed: string) => typed.replace(/\s+/g, '');

export function TestView({ svc, keys, code: linked, back, go }: { svc: Services; keys: string[]; code?: string; back?: { url: string; name: string }; go: (s: Screen) => void }) {
  const pairings = keys.map((k) => svc.pairings.get(k)).filter((p): p is KeyedPairing => !!p);
  const [code, setCode] = useState(linked ?? '');
  const [chosen, setChosen] = useState<string | null>(pairings.length === 1 ? (pairings[0] as KeyedPairing).key : null);
  const [step, setStep] = useState<Step>({ name: 'enter' });
  const [saving, setSaving] = useState(false);
  const home = () => go({ name: 'home' });
  const service = svc.providers.trackman.name;
  const target = back?.name ?? targetOf(pairings.map((p) => p.target.name));

  const fetchTest = useCallback(
    async (key: string, typed: string) => {
      const c = cleanCode(typed);
      if (!TEST_CODE.test(c)) {
        setStep({ name: 'enter', error: t('test.codeWrong') });
        return;
      }
      const pairing = svc.pairings.get(key);
      if (!pairing) {
        setStep({ name: 'enter', error: t('test.pairFirst') });
        return;
      }
      setStep({ name: 'fetching' });
      try {
        const scenario = await svc.runner.testScenario(key, c);
        const who = await svc.runner.testWho(scenario);
        setStep({ name: 'confirm', pairing, scenario, who });
      } catch (e) {
        // Still step 2: the code's sentence where it was typed.
        setStep({ name: 'enter', error: testErrorText(e, Date.now(), lang, t) });
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
      setStep({ name: 'enter', error: t('test.notKept') });
      return;
    }
    // The first sync from the scenario now, while the app is in front; then the history a chunk at a time (App).
    go({ name: 'first', target: pairing.base, ...(back ? { back } : {}) });
  }

  let content;
  if (pairings.length === 0) {
    const w = wizardText(beforeYes(false), lang, { service, target: null });
    content = (
      <WizardFrame view={w.view} lines={w.lines} banner={false}>
        <Body warn>{t('test.pairFirst')}</Body>
        <Button label={t('action.back')} kind="secondary" onPress={home} />
      </WizardFrame>
    );
  } else if (step.name === 'enter') {
    // Step 2, the test code's field open in place of the sign-in.
    const w = wizardText(beforeYes(false), lang, { service, target });
    content = (
      <WizardFrame view={w.view} lines={{ ...w.lines, title: t('test.enter') }}>
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
          placeholder={t('test.codeLabel')}
          placeholderTextColor={colors.muted}
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
      </WizardFrame>
    );
  } else {
    // Step 3: only the account and yes or no (stepParts).
    const f = testAccount();
    const w = wizardText(f, lang, { service, target: step.name === 'confirm' ? step.pairing.target.name : target });
    const parts = stepParts('account', f, { confirming: saving });
    if (step.name === 'fetching') {
      content = <WizardFrame view={w.view} lines={{ ...w.lines, title: t('test.fetching') }} spinning />;
    } else {
      const { pairing, scenario, who } = step;
      const facts = whoLine(who.activities, translator(lang), lang);
      content = (
        <WizardFrame view={w.view} lines={w.lines}>
          {parts.includes('who') && (
            <>
              <Text style={s.badge}>{t('test.badge')}</Text>
              <Body>{who.player ?? t('signin.noName')}</Body>
              {/* The newest activity, no count (as for a real account: a number there read as data on its way). */}
              {facts && <Body muted>{facts}</Body>}
              <Small>{t('test.scenario', { name: scenario.name, target: pairing.target.name })}</Small>
            </>
          )}
          {parts.includes('answer') && (
            <>
              <Button label={t('signin.yes')} onPress={() => void yes(pairing, scenario, who)} busy={saving} />
              <Button label={translator(lang)('confirm.no')} kind="secondary" onPress={() => setStep({ name: 'enter' })} disabled={saving} />
            </>
          )}
        </WizardFrame>
      );
    }
  }
  return <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">{content}</ScrollView>;
}
