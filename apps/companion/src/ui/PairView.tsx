// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * "Pair with <host>?" - a pair link only ever asks. Any app or web page can open such a link, and a
 * pairing sends this player's launch monitor data to that address: so the address is shown plainly
 * and nothing happens without the player's yes.
 *
 * Once paired the app jumps back to the link's `return` (spec 1.2.0) - right away when it is signed in
 * already, else after the sign-in - but only to an address the target named as its own in its answer.
 */

import { useState } from 'react';
import { ScrollView } from 'react-native';
import { lang, t } from '../i18n';
import { backAfterPairing, type Incoming } from '../lib/links';
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
      const back = backAfterPairing(link, p);
      if (svc.signIns.credential(p.provider)) {
        // Signed in already: the first sync right away (the target's plan decides what it brings), and back only
        // once it is through (FirstSyncView: on the iPhone a sync left running behind the jump stops).
        go({ name: 'first', target: p.base, ...(back ? { back: { url: back, name: p.target.name } } : {}) });
      } else {
        go({ name: 'signin', provider: p.provider as 'trackman' | 'demo', ...(back ? { back: { url: back, name: p.target.name } } : {}) });
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
