// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * After signing in (and saying yes to the account): the wizard's steps 3 and 4. The first sync runs while this app is
 * in front (lib/firstSync.ts says why), shown plainly - "10 sessions, 6 rounds fetched", then how much of the older
 * history is still to come, which follows a chunk at a time while the app stays open. Then *Back to …* where the target
 * named a way back, else the sentence that the player can go back and the rest comes by itself. The app never jumps by
 * itself; the player may go back sooner, the sync then goes on for as long as the phone lets it.
 */

import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { translator } from '@glmsync/browser/i18n';
import { lang, t } from '../i18n';
import { firstSync, goBack } from '../lib/firstSync';
import type { Services } from '../lib/services';
import { firstLoad, wizardText } from '../lib/wizard';
import { Body, Button, s } from './parts';
import { WizardFrame } from './WizardFrame';

export function FirstSyncView({
  svc,
  back,
  target,
  sync,
  through,
  done,
}: {
  svc: Services;
  back?: { url: string; name: string };
  /** The app the data goes to (null: several). */
  target: string | null;
  /** The first sync (reason `connect`); never rejects. */
  sync: () => Promise<unknown>;
  /** The first sync is through: the older history may start (while the app is in front). */
  through: () => void;
  /** `back`: went back to the app; `stayed`: the app to go back to is gone; `here`: no way back, the player is done. */
  done: (how: 'back' | 'stayed' | 'here') => void;
}) {
  const started = useRef(false);
  const [phase, setPhase] = useState<'running' | 'through'>('running');
  const [, redraw] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void firstSync({ sync }).then(() => {
      setPhase('through');
      through();
    });
  }, [sync, through]);

  // What each run brought shows as it comes (the older history's chunks too).
  useEffect(() => svc.runner.subscribe(() => redraw((x) => x + 1)), [svc]);

  const runs = svc.pairings.list().map((p) => svc.runner.lastRun(p.key));
  const facts = firstLoad(runs, phase);
  const name = back?.name ?? target;
  const w = wizardText(facts, lang, { service: svc.providers.trackman.name, target: name });
  const go = () => {
    if (!back) return done('here');
    void goBack(back.url, (url) => Linking.openURL(url)).then(done);
  };
  const tr = translator(lang);
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <WizardFrame view={w.view} lines={w.lines} spinning={w.view.step === 'load' && facts.first !== 'failed'}>
        {facts.first === 'failed' && <Body warn>{t('first.failed')}</Body>}
        {w.view.step === 'load' && back && <Body muted>{t('first.why', { name: back.name })}</Body>}
        {w.view.step === 'done' && <Body muted>{tr('wizard.backHint', { target: name ?? tr('wizard.yourApp') })}</Body>}
        {back ? (
          <Button label={w.view.step === 'load' ? t('first.backNow', { name: back.name }) : tr('wizard.back', { target: back.name })} kind={w.view.step === 'load' ? 'secondary' : 'primary'} onPress={go} />
        ) : (
          <Button label={t('action.ok')} kind={w.view.step === 'load' ? 'secondary' : 'primary'} onPress={go} />
        )}
      </WizardFrame>
    </ScrollView>
  );
}
