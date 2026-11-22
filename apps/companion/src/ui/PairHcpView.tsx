// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * "Connect with <host>?" for the handicap record (a pair link with `kind=hcp`): like PairView, only ever a question,
 * the address shown plainly, nothing without the player's yes. Once paired the golf.de window opens, where the
 * player signs in and opens their record; a handicap pairing names no address to jump back to, so the app stays.
 */

import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { t } from '../i18n';
import { pairErrorKey } from '../lib/hcpText';
import type { Incoming } from '../lib/links';
import type { Services } from '../lib/services';
import type { Screen } from './App';
import { Body, Button, Card, s, Small, Title } from './parts';

export function PairHcpView({ svc, link, go }: { svc: Services; link: Extract<Incoming, { kind: 'pair-hcp' }>; go: (s: Screen) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replaces, setReplaces] = useState(false);

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

  async function yes() {
    setBusy(true);
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
    setBusy(false);
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Card>
        <Title>{t('pair.title', { host: link.host })}</Title>
        <Body>{t('pairHcp.what', { host: link.host })}</Body>
        <Body muted>{t('pair.only')}</Body>
        {replaces && <Body warn>{t('pairHcp.replaces')}</Body>}
        <Small>{link.target}</Small>
        {error && <Body warn>{error}</Body>}
        <Button label={t('pair.yes')} onPress={() => void yes()} busy={busy} />
        <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} disabled={busy} />
      </Card>
    </ScrollView>
  );
}
