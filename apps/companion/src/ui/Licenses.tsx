// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The licences of what the app is made of (src/licenses.json, written by scripts/licenses.mjs). */

import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { t } from '../i18n';
import data from '../licenses.json';
import { Body, Button, colors, s, Small, Title } from './parts';

type Entry = { name: string; version: string; license: string; text: number | null };
const packages = data.packages as Entry[];
const texts = data.texts as string[];

export function Licenses({ back }: { back: () => void }) {
  const [open, setOpen] = useState<Entry | null>(null);
  if (open) {
    return (
      <View style={{ flex: 1 }}>
        <View style={s.bar}>
          <Title>
            {open.name} {open.version}
          </Title>
          <Button label={t('action.back')} kind="secondary" onPress={() => setOpen(null)} />
        </View>
        <ScrollView contentContainerStyle={s.scroll}>
          <Small>{open.license}</Small>
          <Text selectable style={{ color: colors.text, fontFamily: 'monospace', fontSize: 12 }}>
            {open.text !== null ? texts[open.text] : t('licenses.noText', { license: open.license })}
          </Text>
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <View style={s.bar}>
        <Title>{t('licenses.title')}</Title>
        <Button label={t('action.back')} kind="secondary" onPress={back} />
      </View>
      <FlatList
        data={packages}
        keyExtractor={(p) => `${p.name}@${p.version}`}
        contentContainerStyle={{ padding: 20, gap: 2 }}
        ListHeaderComponent={<Body muted>{t('licenses.intro', { count: packages.length })}</Body>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => setOpen(item)} style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.line }}>
            <Body>
              {item.name} {item.version}
            </Body>
            <Small>{item.license}</Small>
          </Pressable>
        )}
      />
    </View>
  );
}
