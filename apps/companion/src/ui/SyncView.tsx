// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * `glmsync://sync?return=…`: a target app asks to fetch now (on iOS an app can start another only by
 * a visible switch). The plans are asked like for any manual sync - nothing is fetched that the plan
 * doesn't want - and then the app jumps back, but only to an address the paired target named as its
 * own; otherwise it stays here and says what it did.
 */

import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { lang, t } from '../i18n';
import { backTo } from '../lib/links';
import type { LastRun } from '../lib/runner';
import type { Services } from '../lib/services';
import { runText } from '../lib/text';
import type { Screen } from './App';
import { Body, Button, Card, s, Title } from './parts';

/** A link that waits to jump back gives a quiet renewal less time than an opening does. */
const RENEW_FOR_LINK_MS = 20_000;

export function SyncView({
  svc,
  link,
  renew,
  go,
}: {
  svc: Services;
  link: { target?: string; return?: string };
  renew: (maxMs: number) => Promise<void>;
  go: (s: Screen) => void;
}) {
  const [runs, setRuns] = useState<{ name: string; run: LastRun }[] | null>(null);
  const [stayed, setStayed] = useState(false);
  const started = useRef(false);
  const of = link.target ? svc.pairings.ofTarget(link.target) : svc.pairings.list();

  useEffect(() => {
    if (started.current || !of.length) return;
    started.current = true;
    // Where to go back to is decided before the sync: a target that disconnects meanwhile still gets
    // the player back, and shows the disconnect itself.
    const back = backTo(link, svc.pairings.list());
    const names = new Map(svc.pairings.list().map((p) => [p.key, p.target.name]));
    void (async () => {
      await renew(RENEW_FOR_LINK_MS);
      const out = await svc.runner.syncAll('manual', link.target ? { target: link.target } : {}).catch(() => []);
      setRuns(out.map((o) => ({ name: names.get(o.key) ?? '?', run: o.run })));
      if (back) {
        try {
          await Linking.openURL(back);
          go({ name: 'home' });
          return;
        } catch {
          // the app to go back to is gone: stay
        }
      }
      setStayed(!!link.return);
    })();
  }, [of.length, link, svc, renew, go]);

  if (!of.length) {
    return (
      <ScrollView contentContainerStyle={s.scroll}>
        <Card>
          <Title>{t('sync.notPaired')}</Title>
          <Body muted>{t('sync.notPairedHow')}</Body>
          <Button label={t('action.ok')} onPress={() => go({ name: 'home' })} />
        </Card>
      </ScrollView>
    );
  }

  const now = Date.now();
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Card>
        <Title>{runs ? t('sync.done') : t('sync.running')}</Title>
        {!runs && <Body muted>{t('sync.back')}</Body>}
        {runs?.map((r) => (
          <Body key={r.name}>
            {r.name}: {runText(r.run, now, lang, t)}
          </Body>
        ))}
        {stayed && <Body warn>{t('sync.stayed')}</Body>}
        {runs && <Button label={t('action.ok')} onPress={() => go({ name: 'home' })} />}
      </Card>
    </ScrollView>
  );
}
