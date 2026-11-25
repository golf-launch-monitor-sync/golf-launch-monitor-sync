// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Connect new*'s first step, from a pair link: "Connect with <host>" - a pair link only ever asks. Any app or web page
 * can open such a link, and a pairing sends this player's launch monitor data to that address: so the address is shown
 * plainly and nothing happens without the player's yes, which is the tap on what to connect (the link's provider, one
 * button *Connect launch monitor*; later more launch monitors) - only then the pairing is made.
 *
 * Then connecting goes on as steps (the wizard): the sign-in when there is none yet, then the first sync, and
 * *Back to …* the link's `return` (spec 1.2.0) - only to an address the target named as its own in its answer.
 */

import { translator } from '@glmsync/browser/i18n';
import { factsOfOffer, serviceChoices } from '@glmsync/browser/wizard';
import { useState } from 'react';
import { ScrollView } from 'react-native';
import { lang, t } from '../i18n';
import { backAfterPairing, type Incoming } from '../lib/links';
import type { Services } from '../lib/services';
import { errorText } from '../lib/text';
import { wizardText } from '../lib/wizard';
import type { Screen } from './App';
import { Body, Button, s, Small } from './parts';
import { WizardFrame } from './WizardFrame';

export function PairView({ svc, link, go }: { svc: Services; link: Extract<Incoming, { kind: 'pair' }>; go: (s: Screen) => void }) {
  const [step, setStep] = useState<'asking' | 'working'>('asking');
  const [error, setError] = useState<string | null>(null);
  const provider = svc.providers[link.provider as keyof typeof svc.providers];
  const tr = translator(lang);
  const w = wizardText(factsOfOffer(step, 'lm'), lang, { service: provider?.name ?? link.provider, target: link.host });

  async function choose() {
    setStep('working');
    setError(null);
    try {
      const p = await svc.runner.pair(link);
      const back = backAfterPairing(link, p);
      if (svc.signIns.credential(p.provider)) {
        // Signed in already: the first sync right away (the target's plan decides what it brings), shown as the
        // wizard's steps 4 and 5 with *Back to …* (FirstSyncView: on the iPhone a sync left running behind a jump stops).
        go({ name: 'first', target: p.base, ...(back ? { back: { url: back, name: p.target.name } } : {}) });
      } else {
        go({ name: 'signin', provider: p.provider as 'trackman' | 'demo', ...(back ? { back: { url: back, name: p.target.name } } : {}) });
      }
    } catch (e) {
      setError(errorText(e, Date.now(), lang, t));
      setStep('asking');
    }
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <WizardFrame view={w.view} lines={w.lines} spinning={step === 'working'}>
        <Body>{tr('wizard.pairWhat', { host: link.host })}</Body>
        <Body muted>{t('pair.only')}</Body>
        {link.replaces && <Body warn>{t('pair.replaces')}</Body>}
        <Small>{link.target}</Small>
        {error && <Body warn>{error}</Body>}
        {serviceChoices('lm', [{ id: link.provider, name: provider?.name ?? link.provider }], tr).map((c) => (
          <Button key={c.id} label={c.label} onPress={() => void choose()} busy={step === 'working'} />
        ))}
        <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} disabled={step === 'working'} />
      </WizardFrame>
    </ScrollView>
  );
}
