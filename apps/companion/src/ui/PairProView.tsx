// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Connect new* for a pro's world ranking pages (a pair link with `kind=pro`), its first step as in PairView: "Connect
 * with <host>" - only ever a question, the address shown plainly, nothing without the player's yes, which is the tap on
 * *Connect world ranking*. Once paired the world ranking window opens, where the player opens their page and taps
 * *Send*; a pairing of this kind names no address to jump back to, so the app stays.
 */

import { translator } from '@glmsync/browser/i18n';
import { factsOfOffer, serviceChoices } from '@glmsync/browser/wizard';
import { PRO_PROVIDER } from '@glmsync/spec';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { lang, t } from '../i18n';
import { pairErrorKey } from '../lib/hcpText';
import { backAfterPairing, type Incoming } from '../lib/links';
import type { Services } from '../lib/services';
import { wizardText } from '../lib/wizard';
import type { Screen } from './App';
import { Body, Button, s, Small } from './parts';
import { WizardFrame } from './WizardFrame';

export function PairProView({ svc, link, go }: { svc: Services; link: Extract<Incoming, { kind: 'pair-pro' }>; go: (s: Screen) => void }) {
  const [step, setStep] = useState<'asking' | 'working'>('asking');
  const [error, setError] = useState<string | null>(null);
  const [replaces, setReplaces] = useState(false);
  const tr = translator(lang);
  const service = tr('pro.service');
  const w = wizardText(factsOfOffer(step, 'pro'), lang, { service, target: link.host });

  useEffect(() => {
    let live = true;
    const base = link.target.replace(/\/+$/, '');
    svc.pro.view().then(
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
      const out = await svc.pro.offerPairing({ target: link.target, code: link.code, provider: link.provider });
      if (out.ok) {
        // Its *Done* jumps back where the target named the link's `return` as its own (spec 1.18.0), else this card.
        const back = backAfterPairing(link, { target: { return_prefixes: out.return_prefixes ?? [] } });
        go({ name: 'rankings', linked: true, ...(back ? { back: { url: back, name: out.name } } : {}) });
        return;
      }
      setError(t(pairErrorKey(out.error)));
    } catch {
      setError(t('error.generic'));
    }
    setStep('asking');
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <WizardFrame view={w.view} lines={w.lines} spinning={step === 'working'}>
        <Body>{t('pairPro.what', { host: link.host })}</Body>
        <Body muted>{t('pair.only')}</Body>
        {replaces && <Body warn>{t('pairPro.replaces')}</Body>}
        <Small>{link.target}</Small>
        <Small>{t('pro.unofficial')}</Small>
        {error && <Body warn>{error}</Body>}
        {serviceChoices('pro', [{ id: PRO_PROVIDER, name: service }], tr).map((c) => (
          <Button key={c.id} label={c.label} onPress={() => void choose()} busy={step === 'working'} />
        ))}
        <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} disabled={step === 'working'} />
      </WizardFrame>
    </ScrollView>
  );
}
