// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** The app's language, from the phone's first preference: German or English (lib/text.ts). */

import { getLocales } from 'expo-localization';
import { pickLanguage, translator, type Lang } from '../lib/text';
import de from './de.json';
import en from './en.json';

function phoneLanguage(): Lang {
  try {
    return pickLanguage(getLocales().map((l) => l.languageCode));
  } catch {
    return 'en';
  }
}

export const lang: Lang = phoneLanguage();
export const t = translator(lang === 'de' ? de : en);
