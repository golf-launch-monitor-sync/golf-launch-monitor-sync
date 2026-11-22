// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The main view's list (as in the extension and the web app): *Connect new*, then one row per connection with where it
 * stands; a row opens its details. The rows' words are `@glmsync/browser`'s (connections.ts).
 */

import { connectionLine, type Connection } from '@glmsync/browser/connections';
import { translator } from '@glmsync/browser/i18n';
import { Pressable, Text, View } from 'react-native';
import { lang } from '../i18n';
import { Body, Button, colors, s, Small, Title } from './parts';

const tr = translator(lang);

export function Connections({ list, add, open }: { list: readonly Connection[]; add: () => void; open: (id: string) => void }) {
  return (
    <View style={{ gap: 10 }}>
      <Button label={tr('connections.new')} onPress={add} />
      <Title>{tr('connections.title')}</Title>
      {list.length === 0 && <Body muted>{tr('connections.none')}</Body>}
      {list.map((c) => {
        const l = connectionLine(c, tr);
        const warn = l.tone === 'warn' || l.tone === 'test';
        return (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={`${l.title}, ${l.targets}, ${l.state}`}
            onPress={() => open(c.id)}
            style={({ pressed }) => [s.card, { flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed && s.pressed]}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[s.body, { fontWeight: '700' }]}>{l.title}</Text>
              <Small>{l.targets}</Small>
            </View>
            <Text style={{ color: warn ? colors.warn : l.tone === 'busy' ? colors.muted : colors.accent, fontSize: 13, fontWeight: '700' }}>{l.state}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Back from a connection's details (or from *Connect new*) to the list. */
export function BackToList({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress}>
      <Text style={s.link}>‹ {tr('connections.back')}</Text>
    </Pressable>
  );
}
