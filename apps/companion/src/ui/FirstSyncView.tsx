// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * After signing in (and saying yes to the account): the wizard's steps 4 and 5. With the yes the player is done here,
 * and the step says so at once (LMS-AS-4): *Done – fetching your data …*, *Back to …* where the target named a way
 * back (else *OK*), and the sentence that the rest comes by itself - not only once the data is in. The first sync runs
 * while this app is in front (lib/firstSync.ts says why), shown plainly - "10 sessions, 6 rounds fetched", then how
 * much of the older history is still to come, which follows a chunk at a time while the app stays open. The app never
 * jumps by itself; a player who goes back sooner leaves the sync to go on for as long as the phone lets it, and the
 * target's wake brings the rest. A first sync that failed says so; its way out stays the quieter button.
 */

import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { translator } from '@glmsync/browser/i18n';
import { lang, t } from '../i18n';
import { firstSync, goBack } from '../lib/firstSync';
import type { Services } from '../lib/services';
import { stepParts } from '@glmsync/browser/wizard';
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
  // What the step shows is the browser clients' rule: *Back to …* on the first data already, not when it failed.
  const parts = stepParts(w.view.step, facts);
  const finished = parts.includes('back');
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <WizardFrame view={w.view} lines={w.lines} spinning={w.view.step === 'load' && facts.first !== 'failed'}>
        {parts.includes('failed') && <Body warn>{t('first.failed')}</Body>}
        {back ? (
          <Button label={finished ? tr('wizard.back', { target: back.name }) : t('first.backNow', { name: back.name })} kind={finished ? 'primary' : 'secondary'} onPress={go} />
        ) : (
          <Button label={t('action.ok')} kind={finished ? 'primary' : 'secondary'} onPress={go} />
        )}
        {finished && <Body muted>{tr('wizard.backHint', { target: name ?? tr('wizard.yourApp') })}</Body>}
      </WizardFrame>
    </ScrollView>
  );
}
