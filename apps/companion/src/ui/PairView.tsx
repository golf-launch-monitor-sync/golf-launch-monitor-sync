// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * "Pair with <host>?" - a pair link only ever asks. Any app or web page can open such a link, and a
 * pairing sends this player's launch monitor data to that address: so the address is shown plainly
 * and nothing happens without the player's yes.
 */

import { useState } from 'react';
import { ScrollView } from 'react-native';
import { lang, t } from '../i18n';
import type { Incoming } from '../lib/links';
import type { Services } from '../lib/services';
import { errorText } from '../lib/text';
import type { Screen } from './App';
import { Body, Button, Card, s, Small, Title } from './parts';

export function PairView({ svc, link, go }: { svc: Services; link: Extract<Incoming, { kind: 'pair' }>; go: (s: Screen) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const provider = svc.providers[link.provider as keyof typeof svc.providers];

  async function yes() {
    setBusy(true);
    setError(null);
    try {
      const p = await svc.runner.pair(link);
      if (svc.signIns.credential(p.provider)) {
        // Signed in already: the first sync right away (the target's plan decides what it brings).
        void svc.runner.syncAll('connect', { target: p.base }).catch(() => undefined);
        go({ name: 'home' });
      } else {
        go({ name: 'signin', provider: p.provider as 'trackman' | 'demo' });
      }
    } catch (e) {
      setError(errorText(e, Date.now(), lang, t));
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Card>
        <Title>{t('pair.title', { host: link.host })}</Title>
        <Body>{t('pair.what', { host: link.host, provider: provider?.name ?? link.provider })}</Body>
        <Body muted>{t('pair.only')}</Body>
        {link.replaces && <Body warn>{t('pair.replaces')}</Body>}
        <Small>{link.target}</Small>
        {error && <Body warn>{error}</Body>}
        <Button label={t('pair.yes')} onPress={() => void yes()} busy={busy} />
        <Button label={t('pair.no')} kind="secondary" onPress={() => go({ name: 'home' })} disabled={busy} />
      </Card>
    </ScrollView>
  );
}
