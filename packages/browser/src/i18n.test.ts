// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { pickLang, translator } from './i18n.ts';
import { de, en } from './messages.ts';
import { badge, lastText, noticeText, resultText } from './view.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('texts', () => {
  it('English and German have the same keys and placeholders', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect({ k, p: placeholders(de[k]) }).toEqual({ k, p: placeholders(en[k]) });
    for (const v of [...Object.values(en), ...Object.values(de)]) expect(v.trim()).not.toBe('');
  });

  it('follow the browser, English otherwise', () => {
    expect(pickLang(['de-AT', 'en'])).toBe('de');
    expect(pickLang(['fr-FR', 'en-US'])).toBe('en');
    expect(pickLang(['fr'])).toBe('en');
    expect(pickLang(undefined)).toBe('en');
  });

  it('fill placeholders as text only', () => {
    const t = translator('en');
    expect(t('pairing.connected', { name: '<b>App</b>' })).toBe('Connected with <b>App</b>');
    expect(t('pairing.connected')).toBe('Connected with {name}');
  });
});

describe('what a state says', () => {
  const t = translator('en');
  const now = Date.parse('2026-11-16T12:00:00Z');

  it('sums up an import', () => {
    expect(resultText({ sessions: 2, shots: 30, rounds: 1, round_shots: 1, duplicates: 0 }, t)).toBe('2 new sessions, 30 shots, 1 new rounds');
    expect(resultText({ sessions: 0, shots: 0, rounds: 0, round_shots: 0, duplicates: 3 }, t)).toBe('nothing new (3 there already)');
  });

  it('says what a target last answered', () => {
    const base = { id: 'x', base: 'https://a.example/lm/v1', name: 'App', provider: 'trackman', paired_at: '' };
    expect(lastText(base, t, 'en', now)).toBeNull();
    expect(lastText({ ...base, last: { at: '2026-11-16T11:00:00Z', reason: 'timer', status: 'failed', error: 'weird' } }, t, 'en', now)).toMatch(/: Didn’t work: an unexpected error$/);
    expect(noticeText({ code: 'guard_limit', until: '2026-11-16T13:30:00Z' }, t, 'en')).toMatch(/from \d\d:\d\d\.$/);
    expect(noticeText({ code: 'auth_expired' }, translator('de'), 'de')).toMatch(/abgelaufen/);
  });

  it('puts the right mark on the icon', () => {
    expect(badge({ attention: 'sign_in' }).text).toBe('!');
    expect(badge({ attention: 'confirm' }).text).toBe('?');
    expect(badge({ attention: null }).text).toBe('');
  });
});
