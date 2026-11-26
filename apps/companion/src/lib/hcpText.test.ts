// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import type { HcpView } from '@glmsync/browser/hcp';
import { lineOf } from '@glmsync/browser/hcpView';
import { translator } from '@glmsync/browser/i18n';
import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json' with { type: 'json' };
import { hcpEnded, hcpLast, hcpLine, pairErrorKey } from './hcpText.ts';

const view = (over: Partial<HcpView> = {}): HcpView => ({
  pairings: [{ id: 'a', base: 'https://app.example.org/hcp/v1', name: 'Example App', paired_at: '2026-11-22T12:00:00Z', host: 'app.example.org' }],
  auto: true,
  seen: 12,
  fresh: 3,
  waiting: false,
  signed_out: false,
  changed_page: false,
  sending: false,
  ended: [],
  account: 'confirmed',
  index: null,
  fetch_all: 'no',
  run: null,
  auto_fetch: true,
  ...over,
});

describe('the handicap record’s words on the phone', () => {
  it('the line is the extension’s line, in the phone’s language', () => {
    expect(hcpLine(view(), 'de')).toEqual(lineOf(view(), translator('de')));
    expect(hcpLine(view(), 'de')?.text).toMatch(/12 Ergebnisse gesehen · 3 neu – gehen gleich an Example App/);
    expect(hcpLine(view({ auto: false }), 'en')).toMatchObject({ send: true });
    expect(hcpLine(view({ pairings: [] }), 'en')).toBeNull();
    // Before the yes to the account: no count, only what is missing (the app's bar asks right there).
    expect(hcpLine(view({ account: 'asking' }), 'de')).toMatchObject({ text: 'Golf Stats Sync: noch nicht mit Example App verbunden – Konto bestätigen', confirm: true, send: false });
    expect(hcpLine(view({ account: 'rejected' }), 'en')).toMatchObject({ text: 'Golf Stats Sync: not your account – nothing goes to Example App', warn: true });
  });

  it('what a target last answered, and a connection it ended', () => {
    const now = Date.parse('2026-11-22T12:05:00Z');
    expect(hcpLast(view().pairings[0]!, 'en', now)).toBeNull();
    const sent = { ...view().pairings[0]!, last: { at: '2026-11-22T12:01:00Z', status: 'sent' as const, brought: 2 } };
    expect(hcpLast(sent, 'en', now)).toMatch(/2 new or completed/);
    expect(hcpEnded({ name: 'Example App', at: '2026-11-21T10:00:00Z', why: 'revoked' }, 'de')).toMatch(/Example App nimmt von hier keine Daten mehr an/);
    expect(hcpEnded({ name: 'Example App', at: 'nonsense', why: 'disconnected' }, 'en')).toMatch(/–/);
  });

  it('every way a pairing can fail has the app’s own words', () => {
    for (const e of ['link', 'code', 'provider', 'unreachable', 'rate_limited', 'answer', 'refused', 'anything else']) expect(pairErrorKey(e) in en, e).toBe(true);
    expect(pairErrorKey('code')).toBe('error.codeInvalid');
    expect(pairErrorKey('refused')).toBe('error.generic');
  });
});
