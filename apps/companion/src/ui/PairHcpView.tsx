// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Connect new* for the handicap record (a pair link with `kind=hcp`), its first two steps as in PairView: "Connect
 * with <host>?" - only ever a question, the address shown plainly, nothing without the player's yes - then what to
 * connect (golf.de). Once paired the golf.de window opens, where the player signs in and opens their record; a
 * handicap pairing names no address to jump back to, so the app stays.
 */

import { translator } from '@glmsync/browser/i18n';
import { factsOfOffer } from '@glmsync/browser/wizard';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { lang, t } from '../i18n';
import { pairErrorKey } from '../lib/hcpText';
import type { Incoming } from '../lib/links';
import type { Services } from '../lib/services';
import { wizardText } from '../lib/wizard';
import type { Screen } from './App';
import { Body, Button, s, Small } from './parts';
import { WizardFrame } from './WizardFrame';

export function PairHcpView({ svc, link, go }: { svc: Services; link: Extract<Incoming, { kind: 'pair-hcp' }>; go: (s: Screen) => void }) {
  const [step, setStep] = useState<'asking' | 'allowed' | 'working'>('asking');
  const [error, setError] = useState<string | null>(null);
  const [replaces, setReplaces] = useState(false);
  const tr = translator(lang);
  const w = wizardText(factsOfOffer(step, 'hcp'), lang, { service: 'golf.de', target: link.host });

  useEffect(() => {
    let live = true;
    const base = link.target.replace(/\/+$/, '');
    svc.hcp.view().then(
      (v) => {
        if (live) setReplaces(v.pairings.some((p) => p.base.replace(/\/+$/, '') === base));
      },
      () => undefined, // only the note "replaces" depends on it
    );
    return () => {
      live = false;
    };
  }, [svc, link.target]);

  async function choose() {
    setStep('working');
    setError(null);
    try {
      const out = await svc.hcp.offerPairing({ target: link.target, code: link.code, provider: link.provider });
      if (out.ok) {
        go({ name: 'golfde' });
        return;
      }
      setError(t(pairErrorKey(out.error)));
    } catch {
      setError(t('error.generic'));
    }
    setStep('allowed');
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <WizardFrame view={w.view} lines={w.lines} spinning={step === 'working'}>
        {step === 'asking' ? (
          <>
            <Body>{t('pairHcp.what', { host: link.host })}</Body>
            <Body muted>{t('pair.only')}</Body>
            {replaces && <Body warn>{t('pairHcp.replaces')}</Body>}
            <Small>{link.target}</Small>
            <Button label={tr('wizard.allow')} onPress={() => setStep('allowed')} />
            <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} />
          </>
        ) : (
          <>
            <Small>{tr('wizard.serviceHcp')}</Small>
            {error && <Body warn>{error}</Body>}
            <Button label="golf.de" onPress={() => void choose()} busy={step === 'working'} />
            <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} disabled={step === 'working'} />
          </>
        )}
      </WizardFrame>
    </ScrollView>
  );
}
