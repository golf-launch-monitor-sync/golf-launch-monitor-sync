// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Signing in at a provider: Trackman's own portal in a window, then "Is this you?" before anything is
 * kept or synced - the wizard's steps 2 and 3 (lib/wizard.ts). The key stays in memory until the player says yes;
 * "no" opens the portal afresh, without the session someone else may have left on this phone. The question names the
 * account and its newest activity, no count (a number there read as data already on its way).
 *
 * The demo needs no window: its made-up player is asked "Is this you?" the same way, through the
 * guard, so counters and log behave as with a real account.
 */

import { translator } from '@glmsync/browser/i18n';
import { whoLine } from '@glmsync/browser/wizard';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { lang, t } from '../i18n';
import type { WhoAnswer } from '../lib/runner';
import { DEMO_CREDENTIAL, type ProviderId, type Services } from '../lib/services';
import { errorText } from '../lib/text';
import { beforeYes, wizardText } from '../lib/wizard';
import { Body, Button, s, Small, Title } from './parts';
import { TrackmanLoginView } from './TrackmanLoginView';
import { WizardFrame } from './WizardFrame';

type Step =
  | { name: 'window'; fresh: boolean; key: number }
  | { name: 'checking' }
  | { name: 'confirm'; token: string; who: WhoAnswer; others: string[] }
  | { name: 'error'; text: string; token: string | null };

/**
 * `done(true)`: signed in and kept; `done(false)`: cancelled. `backTo`: the app it goes back to then. `target`: the app
 * the data goes to (null: several, or none paired yet - then no "not yet connected" line).
 */
export function SignInView({
  svc,
  provider,
  done,
  backTo,
  target,
  test,
}: {
  svc: Services;
  provider: ProviderId;
  done: (signedIn: boolean) => void;
  backTo?: string;
  target?: string | null;
  /** Small, under the sign-in: *Enter a test code* instead (test mode); absent where no pairing could take one. */
  test?: () => void;
}) {
  const cancel = () => done(false);
  const [step, setStep] = useState<Step>(provider === 'demo' ? { name: 'checking' } : { name: 'window', fresh: false, key: 0 });
  const [saving, setSaving] = useState(false);
  const [passkey, setPasskey] = useState(false);
  const p = svc.providers[provider];

  const check = useCallback(
    async (token: string) => {
      setStep({ name: 'checking' });
      try {
        const who = await svc.runner.who(provider, token);
        setStep({ name: 'confirm', token, who, others: svc.runner.otherAccountAt(provider, token) });
      } catch (e) {
        setStep({ name: 'error', text: errorText(e, Date.now(), lang, t), token });
      }
    },
    [svc, provider],
  );

  useEffect(() => {
    if (provider === 'demo') void check(DEMO_CREDENTIAL);
  }, [provider, check]);

  async function yes(token: string, who: WhoAnswer) {
    setSaving(true);
    try {
      await svc.signIns.set(provider, token, who.player);
    } catch {
      setSaving(false);
      setStep({ name: 'error', text: t('signin.notKept'), token });
      return;
    }
    // The first sync with this sign-in comes next (App: each paired target's plan says what it wants).
    done(true);
  }

  const again = (fresh: boolean) => setStep({ name: 'window', fresh, key: Date.now() });
  const paired = svc.pairings.list().some((x) => x.provider === provider);
  const words = { service: p.name, target: target ?? null };

  if (step.name === 'window') {
    const w = wizardText(beforeYes(false), lang, words);
    return (
      <View style={{ flex: 1 }}>
        <View style={[s.bar, { flexWrap: 'wrap', gap: 8 }]}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Small>{w.lines.progress}</Small>
            <Title>{t('signin.title', { provider: p.name })}</Title>
            <Small>{t('provider.trackman.unofficial')}</Small>
            {backTo && <Small>{t('signin.thenBack', { name: backTo })}</Small>}
            {passkey && <Body warn>{t('signin.passkey')}</Body>}
            {test && (
              <Pressable accessibilityRole="link" onPress={test}>
                <Text style={[s.link, { fontSize: 13 }]}>{t('test.enter')}</Text>
              </Pressable>
            )}
          </View>
          <Button label={t('action.cancel')} kind="secondary" onPress={cancel} />
        </View>
        <TrackmanLoginView key={step.key} fresh={step.fresh} onToken={(token) => void check(token)} onPasskey={() => setPasskey(true)} />
      </View>
    );
  }

  // Step 3: the account the provider named, and the player's answer.
  const w = wizardText(beforeYes(true), lang, words);
  let content;
  if (step.name === 'checking') {
    content = (
      <WizardFrame view={w.view} lines={{ ...w.lines, title: t('signin.checking') }} banner={paired} spinning>
        <Body muted>{t('signin.checkingWhy')}</Body>
      </WizardFrame>
    );
  } else if (step.name === 'confirm') {
    // Step 3: only the account and yes or no (the demo's made-up player has no "no": its way out is *Cancel*).
    const facts = whoLine(step.who.activities, translator(lang), lang);
    content = (
      <WizardFrame view={w.view} lines={w.lines} banner={paired}>
        <Body>{step.who.player ?? t('signin.noName')}</Body>
        {facts && <Body muted>{facts}</Body>}
        {provider === 'demo' && <Body muted>{t('provider.demo.notice')}</Body>}
        {step.others.length > 0 && <Body warn>{t('signin.otherAccount', { targets: step.others.join(', ') })}</Body>}
        <Button label={t('signin.yes')} onPress={() => void yes(step.token, step.who)} busy={saving} />
        {provider !== 'demo' ? (
          <Button label={t('signin.no')} kind="secondary" onPress={() => again(true)} disabled={saving} />
        ) : (
          <Button label={t('action.cancel')} kind="secondary" onPress={cancel} disabled={saving} />
        )}
      </WizardFrame>
    );
  } else {
    content = (
      <WizardFrame view={w.view} lines={{ ...w.lines, title: t('signin.failed') }} banner={paired}>
        <Body warn>{step.text}</Body>
        {step.token && <Button label={t('action.retry')} onPress={() => void check(step.token as string)} />}
        {provider !== 'demo' && <Button label={t('signin.again')} kind="secondary" onPress={() => again(false)} />}
        <Button label={t('action.cancel')} kind="secondary" onPress={cancel} />
      </WizardFrame>
    );
  }
  return <ScrollView contentContainerStyle={s.scroll}>{content}</ScrollView>;
}
