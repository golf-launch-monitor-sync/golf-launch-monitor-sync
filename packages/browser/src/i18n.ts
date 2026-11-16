// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** English or German by the browser's language; dates and times in the browser's own way. */

import { de, en, type MessageKey } from './messages.ts';

export type Lang = 'en' | 'de';
export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function pickLang(languages: readonly string[] | undefined): Lang {
  for (const l of languages ?? []) {
    const base = l.toLowerCase().split('-')[0];
    if (base === 'de') return 'de';
    if (base === 'en') return 'en';
  }
  return 'en';
}

/** Placeholders are filled as text: a value never becomes markup (the pages set textContent only). */
export function translator(lang: Lang): T {
  const dict: Record<MessageKey, string> = lang === 'de' ? de : en;
  return (key, vars = {}) => (dict[key] ?? en[key] ?? key).replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

const locale = (lang: Lang) => (lang === 'de' ? 'de-DE' : 'en-GB');

export function formatDate(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', year: 'numeric' }).format(ms);
}

export function formatDateTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
}

export function formatTime(ms: number, lang: Lang): string {
  return new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit' }).format(ms);
}

/** "14:05" today, else day and time. */
export function formatWhen(ms: number, now: number, lang: Lang): string {
  const a = new Date(ms);
  const b = new Date(now);
  const sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  return sameDay ? formatTime(ms, lang) : formatDateTime(ms, lang);
}
