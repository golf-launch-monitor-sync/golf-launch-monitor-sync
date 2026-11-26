// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Connect new* for the handicap record (a pair link with `kind=hcp`), its first step as in PairView: "Connect with
 * <host>" - only ever a question, the address shown plainly, nothing without the player's yes, which is the tap on
 * *Connect handicap record* (golf.de). Once paired the golf.de window opens, where the player signs in and opens their
 * record; its *Done* jumps back to the link's `return` where the target named it as its own (spec 1.18.0), else shows
 * this connection's card (lib/done.ts).
 */

import { translator } from '@glmsync/browser/i18n';
import { factsOfOffer, serviceChoices } from '@glmsync/browser/wizard';
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

export function PairHcpView({ svc, link, go }: { svc: Services; link: Extract<Incoming, { kind: 'pair-hcp' }>; go: (s: Screen) => void }) {
  const [step, setStep] = useState<'asking' | 'working'>('asking');
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
        const back = backAfterPairing(link, { target: { return_prefixes: out.return_prefixes ?? [] } });
        go({ name: 'golfde', linked: true, ...(back ? { back: { url: back, name: out.name } } : {}) });
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
        <Body>{t('pairHcp.what', { host: link.host })}</Body>
        <Body muted>{t('pair.only')}</Body>
        {replaces && <Body warn>{t('pairHcp.replaces')}</Body>}
        <Small>{link.target}</Small>
        {error && <Body warn>{error}</Body>}
        {serviceChoices('hcp', [{ id: link.provider, name: 'golf.de' }], tr).map((c) => (
          <Button key={c.id} label={c.label} onPress={() => void choose()} busy={step === 'working'} />
        ))}
        <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} disabled={step === 'working'} />
      </WizardFrame>
    </ScrollView>
  );
}
