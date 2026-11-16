// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Signing in at a provider: Trackman's own portal in a window, then "Is this you?" before anything is
 * kept or synced. The key stays in memory until the player says yes; "no" opens the portal afresh,
 * without the session someone else may have left on this phone.
 *
 * The demo needs no window: its made-up player is asked "Is this you?" the same way, through the
 * guard, so counters and log behave as with a real account.
 */

import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { lang, t } from '../i18n';
import type { WhoAnswer } from '../lib/runner';
import { DEMO_CREDENTIAL, type ProviderId, type Services } from '../lib/services';
import { errorText, when } from '../lib/text';
import { Body, Button, Card, s, Small, Title } from './parts';
import { TrackmanLoginView } from './TrackmanLoginView';

type Step =
  | { name: 'window'; fresh: boolean; key: number }
  | { name: 'checking' }
  | { name: 'confirm'; token: string; who: WhoAnswer; others: string[] }
  | { name: 'error'; text: string; token: string | null };

export function SignInView({ svc, provider, done }: { svc: Services; provider: ProviderId; done: () => void }) {
  const [step, setStep] = useState<Step>(provider === 'demo' ? { name: 'checking' } : { name: 'window', fresh: false, key: 0 });
  const [saving, setSaving] = useState(false);
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
    // The first sync with this sign-in: each paired target's plan says what it wants.
    void svc.runner.syncAll('connect').catch(() => undefined);
    done();
  }

  const again = (fresh: boolean) => setStep({ name: 'window', fresh, key: Date.now() });

  if (step.name === 'window') {
    return (
      <View style={{ flex: 1 }}>
        <View style={[s.bar, { flexWrap: 'wrap', gap: 8 }]}>
          <View style={{ flex: 1, minWidth: 200 }}>
            <Title>{t('signin.title', { provider: p.name })}</Title>
            <Small>{t('provider.trackman.unofficial')}</Small>
          </View>
          <Button label={t('action.cancel')} kind="secondary" onPress={done} />
        </View>
        <TrackmanLoginView key={step.key} fresh={step.fresh} onToken={(token) => void check(token)} />
      </View>
    );
  }

  let content;
  if (step.name === 'checking') {
    content = (
      <Card>
        <Title>{t('signin.checking')}</Title>
        <Body muted>{t('signin.checkingWhy')}</Body>
      </Card>
    );
  } else if (step.name === 'confirm') {
    const a = step.who.activities;
    const now = Date.now();
    content = (
      <Card>
        <Title>{t('signin.isThisYou')}</Title>
        <Body>{step.who.player ?? t('signin.noName')}</Body>
        {a && (
          <Body muted>
            {a.count === 0
              ? t('signin.noActivities')
              : t('signin.activities', { count: a.count, last: a.last ? when(a.last, now, lang, t) : '–', place: a.place ?? '–' })}
          </Body>
        )}
        {provider === 'demo' && <Body muted>{t('provider.demo.notice')}</Body>}
        {step.others.length > 0 && <Body warn>{t('signin.otherAccount', { targets: step.others.join(', ') })}</Body>}
        <Button label={t('signin.yes')} onPress={() => void yes(step.token, step.who)} busy={saving} />
        {provider !== 'demo' && <Button label={t('signin.no')} kind="secondary" onPress={() => again(true)} disabled={saving} />}
        <Button label={t('action.cancel')} kind="secondary" onPress={done} disabled={saving} />
      </Card>
    );
  } else {
    content = (
      <Card>
        <Title>{t('signin.failed')}</Title>
        <Body warn>{step.text}</Body>
        {step.token && <Button label={t('action.retry')} onPress={() => void check(step.token as string)} />}
        {provider !== 'demo' && <Button label={t('signin.again')} kind="secondary" onPress={() => again(false)} />}
        <Button label={t('action.cancel')} kind="secondary" onPress={done} />
      </Card>
    );
  }
  return <ScrollView contentContainerStyle={s.scroll}>{content}</ScrollView>;
}
