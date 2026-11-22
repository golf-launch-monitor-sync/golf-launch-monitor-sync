// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Connecting as steps, the phone's frame for them (the steps and their words are `@glmsync/browser`'s wizard, the same
 * in the extension and the web app): the big line before the yes, the steps with their progress, the step's title, and
 * the step's own content below.
 */

import type { WizardLines, WizardView } from '@glmsync/browser/wizard';
import type { ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { Card, colors, s, Small, Title } from './parts';

export function WizardFrame({ view, lines, banner = true, spinning, children }: { view: WizardView; lines: WizardLines; banner?: boolean; spinning?: boolean; children?: ReactNode }) {
  return (
    <Card>
      {banner && lines.unconfirmed && (
        <Text style={{ color: colors.warn, fontSize: 17, fontWeight: '800' }} accessibilityRole="alert">
          {lines.unconfirmed}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 6 }} accessible accessibilityLabel={lines.progress}>
        {view.steps.map((st, i) => (
          <View key={st.id} style={{ flex: 1, gap: 3 }}>
            <View style={{ height: 3, borderRadius: 2, backgroundColor: st.state === 'todo' ? colors.line : colors.accent }} />
            <Text style={{ color: st.state === 'current' ? colors.text : colors.muted, fontSize: 11, fontWeight: st.state === 'current' ? '700' : '400' }}>{lines.labels[i]}</Text>
          </View>
        ))}
      </View>
      <Small>{lines.progress}</Small>
      <View style={[s.row, { alignItems: 'center' }]}>
        {spinning && <ActivityIndicator color={colors.accent} />}
        <Title>{lines.title}</Title>
      </View>
      {lines.brought && <Text style={[s.body, { fontWeight: '700', fontSize: 16 }]}>{lines.brought}</Text>}
      {lines.more && <Text style={[s.body, s.muted]}>{lines.more}</Text>}
      {children}
    </Card>
  );
}
