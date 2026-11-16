// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The few building blocks of the screens: colours, a card, a button, a line of small print. */

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const colors = {
  bg: '#0F2A1F',
  surface: '#16382A',
  line: '#24503D',
  text: '#F5F7F4',
  muted: '#A9BDB2',
  accent: '#7DD6A0',
  accentText: '#0F2A1F',
  warn: '#F2C66D',
  danger: '#F08A7E',
};

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text style={s.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

export function Body({ children, muted, warn }: { children: ReactNode; muted?: boolean; warn?: boolean }) {
  return <Text style={[s.body, muted && s.muted, warn && s.warn]}>{children}</Text>;
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={s.small}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  busy,
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [s.button, kind === 'primary' ? s.primary : s.secondary, kind === 'danger' && s.danger, (pressed || off) && s.pressed]}
    >
      {busy ? (
        <ActivityIndicator color={kind === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text style={[s.buttonText, kind === 'primary' ? s.primaryText : s.secondaryText, kind === 'danger' && s.dangerText]}>{label}</Text>
      )}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, gap: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: colors.line },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  heading: { color: colors.text, fontSize: 24, fontWeight: '800' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  muted: { color: colors.muted },
  warn: { color: colors.warn },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minHeight: 46 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  danger: { borderColor: colors.danger },
  pressed: { opacity: 0.6 },
  buttonText: { fontSize: 15, fontWeight: '700' },
  primaryText: { color: colors.accentText },
  secondaryText: { color: colors.text },
  dangerText: { color: colors.danger },
  badge: { color: colors.warn, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.line },
  link: { color: colors.accent, fontSize: 15, fontWeight: '600' },
});
