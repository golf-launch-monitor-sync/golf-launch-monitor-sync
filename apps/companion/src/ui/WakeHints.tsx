// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * On the iPhone: why iOS won't wake the app (background refresh off or restricted, Low Power Mode), with the way to
 * the settings; and once, after the first pairing, not to swipe the app away. Each closes with × (src/lib/wakeHints.ts).
 * Read again whenever the app comes to the front - the player may just be back from the settings.
 */

import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useEffect, useState, type ReactNode } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { WakeHints as Hints, wakeHintKey, type Block, type WakeHintView } from '../lib/wakeHints';
import { storage } from '../platform';
import { powerState } from '../power';
import { Body, Card, colors, s } from './parts';

const hints = new Hints(storage);
const NONE: WakeHintView = { block: null, swipe: false };
/** The name iOS lists the app under in the settings. */
const APP = Constants.expoConfig?.name ?? 'Golf Launch Monitor Sync';

export function WakeHints({ paired }: { paired: boolean }) {
  const [view, setView] = useState<WakeHintView>(NONE);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let live = true;
    const look = () =>
      void powerState()
        .then((state) => hints.view(Platform.OS, paired, state))
        .then((v) => {
          if (live) setView(v);
        })
        .catch(() => undefined); // a hint: without it the app works as before
    look();
    const front = AppState.addEventListener('change', (state) => {
      if (state === 'active') look();
    });
    return () => {
      live = false;
      front.remove();
    };
  }, [paired]);

  const closeBlock = (block: Block) => {
    setView((v) => ({ ...v, block: null }));
    void hints.closeBlock(block);
  };
  const closeSwipe = () => {
    setView((v) => ({ ...v, swipe: false }));
    void hints.closeSwipe();
  };

  return (
    <>
      {view.block && (
        <Card>
          <Line onClose={() => closeBlock(view.block as Block)}>
            <Body warn>{t(wakeHintKey(view.block), { app: APP })}</Body>
          </Line>
          {view.block !== 'low_power' && (
            <Pressable accessibilityRole="link" onPress={() => void Linking.openSettings().then(() => setFailed(false), () => setFailed(true))}>
              <Text style={s.link}>{t('wakeHint.settings')}</Text>
            </Pressable>
          )}
          {failed && <Body muted>{t('newBuild.failed')}</Body>}
        </Card>
      )}
      {view.swipe && (
        <Card>
          <Line onClose={closeSwipe}>
            <Body>{t('wakeHint.swipe')}</Body>
          </Line>
        </Card>
      )}
    </>
  );
}

function Line({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
      <View style={{ flex: 1 }}>{children}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('wakeHint.close')} hitSlop={12} onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end' }}>
        <Text style={{ color: colors.muted, fontSize: 20, lineHeight: 22 }}>×</Text>
      </Pressable>
    </View>
  );
}
