// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * After pairing or signing in from a target's link with a way back: the first sync while this app is in front, then
 * back to the target (lib/firstSync.ts says why it waits). The player can go back sooner; the sync then goes on for as
 * long as the phone lets it.
 */

import * as Linking from 'expo-linking';
import { useEffect, useRef } from 'react';
import { ScrollView } from 'react-native';
import { t } from '../i18n';
import { firstSyncThenBack } from '../lib/firstSync';
import { Body, Button, Card, s, Title } from './parts';

export function FirstSyncView({
  back,
  sync,
  done,
}: {
  back: { url: string; name: string };
  /** The first sync (reason `connect`); never rejects. */
  sync: () => Promise<unknown>;
  /** `stayed`: the app to go back to is gone, so the player stays here. */
  done: (how: 'back' | 'stayed' | 'here') => void;
}) {
  const started = useRef(false);
  const skip = useRef<() => void>(() => undefined);
  const skipped = useRef(new Promise<void>((go) => (skip.current = go)));

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void firstSyncThenBack({
      sync,
      back: back.url,
      open: (url) => Linking.openURL(url),
      skip: skipped.current,
    }).then(done, () => done('stayed'));
  }, [back.url, sync, done]);

  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Card>
        <Title>{t('first.title')}</Title>
        <Body muted>{t('first.why', { name: back.name })}</Body>
        <Button label={t('first.backNow', { name: back.name })} kind="secondary" onPress={() => skip.current()} />
      </Card>
    </ScrollView>
  );
}
