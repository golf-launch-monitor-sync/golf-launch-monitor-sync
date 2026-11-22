// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * *Connect new*, its first step before any app asked: a connection starts in the app that should get the data (its
 * pair link opens this app at the question). Without such an app, the demo shows how it works with made-up data.
 */

import { translator } from '@glmsync/browser/i18n';
import { factsOfOffer } from '@glmsync/browser/wizard';
import { ScrollView, View } from 'react-native';
import { lang, t } from '../i18n';
import { wizardText } from '../lib/wizard';
import type { Screen } from './App';
import { BackToList } from './Connections';
import { Body, Button, Card, s, Title } from './parts';
import { WizardFrame } from './WizardFrame';

export function NewView({ go }: { go: (s: Screen) => void }) {
  const tr = translator(lang);
  const w = wizardText(factsOfOffer('none', 'lm'), lang, { service: '', target: null });
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <BackToList onPress={() => go({ name: 'home' })} />
      <WizardFrame view={w.view} lines={w.lines}>
        <Body>{tr('wizard.pairStartHow')}</Body>
      </WizardFrame>
      <Card>
        <Title>{t('demo.title')}</Title>
        <Body muted>{t('demo.text')}</Body>
        <View style={s.row}>
          <Button label={t('demo.button')} kind="secondary" onPress={() => go({ name: 'signin', provider: 'demo' })} />
        </View>
      </Card>
    </ScrollView>
  );
}
