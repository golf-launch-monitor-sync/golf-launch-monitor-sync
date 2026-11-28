// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GuardLimitError, ProviderAuthError, TargetError, type GuardCounts } from '@glmsync/core';
import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json' with { type: 'json' };
import en from '../i18n/en.json' with { type: 'json' };
import { type LastRun, TestModeError } from '@glmsync/engine';
import { countsText, errorText, pickLanguage, runText, testErrorText, translator, when } from './text.ts';
import { fromTrackman, isSignInPage, readCapturedToken } from './trackmanPage.ts';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const NOW = Date.parse('2026-11-16T15:00:00Z');
const t = translator(en);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(n) && !n.endsWith('.test.ts') ? [p] : [];
  });
}

describe('the two languages', () => {
  const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('have the same keys and the same placeholders', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(placeholders(de[k]), k).toEqual(placeholders(en[k]));
  });

  it('have every key the app uses', () => {
    const used = new Set<string>();
    for (const f of sources(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z.]+)'/g)) used.add(m[1] as string);
    expect(used.size).toBeGreaterThan(50);
    expect([...used].filter((k) => !(k in en))).toEqual([]);
  });

  it('say "unofficial" next to the provider, and never put its name in the app name', () => {
    expect(en['provider.trackman.unofficial']).toMatch(/not affiliated with, endorsed by or supported by Trackman/);
    expect(de['provider.trackman.unofficial']).toMatch(/nicht mit Trackman verbunden/);
    expect(en['app.name']).not.toMatch(/trackman/i);
  });

  it('German for a phone set to German, else English', () => {
    expect(pickLanguage(['de', 'en'])).toBe('de');
    expect(pickLanguage(['de-AT'])).toBe('de');
    expect(pickLanguage([null, 'fr'])).toBe('en');
    expect(pickLanguage([])).toBe('en');
  });
});

describe('what a run says', () => {
  const run = (r: Partial<LastRun>): LastRun => ({ at: NOW - 60_000, reason: 'timer', status: 'synced', ...r });

  it('new data, nothing new, and why a sync stopped', () => {
    expect(runText(run({ result: { sessions: 3, shots: 40, rounds: 1, round_shots: 1, duplicates: 0 } }), NOW, 'en', t)).toMatch(/: 3 new sessions, 1 rounds$/);
    expect(runText(run({ result: { sessions: 0, shots: 0, rounds: 0, round_shots: 0, duplicates: 2 } }), NOW, 'en', t)).toMatch(/nothing new$/);
    expect(runText(run({ notice: 'guard_limit', until: new Date(NOW + 3600_000).toISOString() }), NOW, 'en', t)).toMatch(/goes on today/);
    expect(runText(run({ notice: 'auth_expired' }), NOW, 'en', t)).toMatch(/sign-in ran out/);
    expect(runText(run({ more: true, result: { sessions: 40, shots: 400, rounds: 0, round_shots: 0, duplicates: 0 } }), NOW, 'en', t)).toMatch(/more comes/);
  });

  it('every status has words, none shows a key', () => {
    for (const status of ['not_due', 'busy', 'signed_out', 'other_account', 'disconnected', 'unpaired', 'cancelled', 'failed'] as const) {
      const text = runText(run({ status, error: 'unreachable' }), NOW, 'de', translator(de));
      expect(text).not.toMatch(/run\.|notice\./);
    }
    expect(runText(null, NOW, 'en', t)).toBe('Not synced yet.');
  });

  it('times: today, yesterday, or the date', () => {
    expect(when(NOW - 3600_000, NOW, 'en', t)).toMatch(/^today /);
    expect(when(NOW - 86_400_000, NOW, 'en', t)).toMatch(/^yesterday /);
    expect(when(NOW - 5 * 86_400_000, NOW, 'en', t)).not.toMatch(/today|yesterday/);
    expect(when('not a time', NOW, 'en', t)).toBe('');
  });

  it('the counters, and a pause', () => {
    const c: GuardCounts = { run: 2, hour: 5, day: 14, limits: { per_run: 40, per_hour: 60, per_day: 300 }, blocked_until: null };
    expect(countsText(c, NOW, 'en', t)).toBe('Requests today 14 of 300, this hour 5 of 60');
    expect(countsText({ ...c, blocked_until: new Date(NOW + 600_000).toISOString() }, NOW, 'en', t)).toMatch(/paused until today/);
    expect(countsText(null, NOW, 'en', t)).toBeNull();
  });
});

describe('what went wrong', () => {
  it('in the player\'s words, never the message from outside', () => {
    expect(errorText(new TargetError('code_invalid', 'evil <b>text</b>'), NOW, 'en', t)).toBe(en['error.codeInvalid']);
    expect(errorText(new TargetError('too_large', 'evil'), NOW, 'en', t)).toBe('The app\'s server refused (too_large).');
    expect(errorText(new TargetError('token_invalid', 'evil'), NOW, 'en', t)).toBe(en['error.tokenInvalid']);
    expect(errorText(new ProviderAuthError('x'), NOW, 'en', t)).toBe(en['error.authRejected']);
    expect(errorText(new GuardLimitError(['per_day'], NOW + 3600_000), NOW, 'en', t)).toMatch(/goes on today/);
    expect(errorText(new Error('boom'), NOW, 'en', t)).toBe(en['error.generic']);
  });
});

describe('what went wrong in test mode (spec 1.8.0)', () => {
  it('a sentence for each of its codes, in both languages', () => {
    const tDe = translator(de);
    for (const [code, key] of [
      ['test_data', 'error.testData'],
      ['test_unavailable', 'error.testUnavailable'],
      ['not_test_account', 'error.notTestAccount'],
      ['code_expired', 'error.codeExpired'],
    ] as const) {
      expect(errorText(new TargetError(code, 'evil'), NOW, 'en', t)).toBe(en[key]);
      expect(errorText(new TargetError(code, 'evil'), NOW, 'de', tDe)).toBe(de[key]);
      expect(de[key]).not.toBe(en[key]);
    }
  });

  it('a wrong or malformed code is a wrong test code; pairing first, and a provider this app lacks, say so', () => {
    expect(testErrorText(new TargetError('code_invalid', 'x'), NOW, 'en', t)).toBe(en['test.codeWrong']);
    expect(testErrorText(new TargetError('bad_request', 'x'), NOW, 'en', t)).toBe(en['test.codeWrong']);
    expect(testErrorText(new TargetError('code_expired', 'x'), NOW, 'en', t)).toBe(en['error.codeExpired']);
    expect(testErrorText(new TargetError('unreachable', 'x'), NOW, 'en', t)).toBe(en['error.targetUnreachable']);
    expect(errorText(new TestModeError('unpaired'), NOW, 'en', t)).toBe(en['test.pairFirst']);
    expect(errorText(new TestModeError('provider'), NOW, 'en', t)).toBe(en['test.provider']);
  });

  it('a run a real account refused as test data says so', () => {
    expect(runText({ at: NOW, reason: 'timer', status: 'failed', error: 'test_data' }, NOW, 'en', t)).toMatch(/no test data for a real account/);
  });
});

describe('the sign-in window', () => {
  const key = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.sig';

  it('takes a key only from a Trackman page, and only one shaped like a key', () => {
    expect(readCapturedToken('https://portal.trackmangolf.com/x', JSON.stringify({ token: key }))).toBe(key);
    expect(readCapturedToken('https://evil.example/', JSON.stringify({ token: key }))).toBeNull();
    expect(readCapturedToken('https://trackmangolf.com.evil.example/', JSON.stringify({ token: key }))).toBeNull();
    expect(readCapturedToken('http://portal.trackmangolf.com/', JSON.stringify({ token: key }))).toBeNull();
    expect(readCapturedToken('https://appleid.apple.com/', JSON.stringify({ token: key }))).toBeNull();
    expect(readCapturedToken('https://portal.trackmangolf.com/', JSON.stringify({ token: 'not a key' }))).toBeNull();
    expect(readCapturedToken('https://portal.trackmangolf.com/', '{broken')).toBeNull();
  });

  it('opens Trackman\'s pages and the sign-in providers its page offers, nothing else', () => {
    expect(fromTrackman('https://login.trackmangolf.com/')).toBe(true);
    expect(fromTrackman('https://trackman.com/')).toBe(true);
    expect(isSignInPage('https://accounts.google.com/o/oauth2')).toBe(true);
    expect(fromTrackman('https://example.com/?u=trackmangolf.com')).toBe(false);
    expect(isSignInPage('https://accounts.google.com.evil.example/')).toBe(false);
  });
});

describe('a run beside the last real one (SY-5)', () => {
  const at = Date.parse('2026-11-25T10:16:00Z');
  const later = Date.parse('2026-11-25T10:18:00Z');
  const now = Date.parse('2026-11-25T10:20:00Z');
  const synced: LastRun = { at, reason: 'open', status: 'synced', result: { sessions: 8, shots: 400, rounds: 0, round_shots: 0, duplicates: 0 } };
  const tde = translator(de);

  it('keeps what came, and says who is fetching beside it', () => {
    const run: LastRun = { ...synced, aside: { at: later, status: 'busy', holder: { kind: 'extension', since: '2026-11-25T10:17:00Z' } } };
    const line = runText(run, now, 'de', tde);
    expect(line).toContain('8 neue Sessions');
    expect(line).toMatch(/Browser-Erweiterung am Computer holt gerade, seit \d{2}:\d{2}/);
    expect(runText({ ...synced, aside: { at: later, status: 'not_due' } }, now, 'en', t)).toMatch(/8 new sessions.*nothing due/);
  });

  it('names the kind that holds the lease, never "another device" when it knows', () => {
    const busy = (kind: 'extension' | 'web' | 'companion' | 'embedded' | 'other'): LastRun => ({ at: later, reason: 'timer', status: 'busy', holder: { kind } });
    expect(runText(busy('companion'), now, 'de', tde)).toMatch(/Golf Stats Sync auf einem anderen Handy/);
    // Spec 1.27.0: the target's own app fetching with the engine built in.
    expect(runText(busy('embedded'), now, 'de', tde)).toMatch(/die App selbst/);
    expect(runText(busy('web'), now, 'de', tde)).toMatch(/Web-App/);
    expect(runText(busy('other'), now, 'en', t)).toMatch(/another device of yours/);
    expect(runText({ at: later, reason: 'timer', status: 'busy' }, now, 'en', t)).toMatch(/another device of yours/);
  });
});
