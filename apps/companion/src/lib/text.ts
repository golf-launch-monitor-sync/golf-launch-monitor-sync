// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The app's words: German and English (src/i18n), picked by the phone's language, and what a run's
 * outcome says to the player. Pure, so the wording of every outcome is tested.
 */

import {
  GuardLimitError,
  GuardStorageError,
  ProviderAuthError,
  ProviderBlockedError,
  ProviderUnavailableError,
  TargetError,
  type GuardCounts,
  type Holder,
} from '@glmsync/core';
import { type LastRun, TestModeError } from '@glmsync/engine';

export type Dict = Record<string, string>;
export type T = (key: string, vars?: Record<string, string | number>) => string;
export type Lang = 'de' | 'en';

/** German for a phone set to German (first preference), English otherwise. */
export function pickLanguage(codes: readonly (string | null | undefined)[]): Lang {
  return (codes.find((c) => !!c) ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** `{name}` placeholders filled in; a key the dictionary lacks shows as itself (a test keeps that from happening). */
export function translator(dict: Dict): T {
  return (key, vars) => {
    const text = dict[key] ?? key;
    return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
  };
}

/** A time the way the phone shows times: "today 14:05", or the date for an older one. */
export function when(at: number | string, now: number, lang: Lang, t: T): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const locale = lang === 'de' ? 'de-DE' : 'en-GB';
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => x.toDateString();
  if (day(d) === day(new Date(now))) return t('time.today', { time });
  if (day(d) === day(new Date(now - 86_400_000))) return t('time.yesterday', { time });
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) + `, ${time}`;
}

/** Who holds the lease, as the plan named it (spec 1.13.0): never "another device" when the target says which. */
function busyText(at: string, holder: Holder | undefined, lang: Lang, t: T): string {
  const kind = holder?.kind;
  if (kind !== 'extension' && kind !== 'web' && kind !== 'companion' && kind !== 'embedded') return t('run.busy', { at });
  const who = t(`run.who.${kind}`);
  const d = holder?.since ? new Date(holder.since) : null;
  if (!d || Number.isNaN(d.getTime())) return t('run.busyBy', { at, who });
  const since = d.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
  return t('run.busyBySince', { at, who, since });
}

/** What the last run of a pairing says, in a line: a later one that fetched nothing beside it (SY-5). */
export function runText(run: LastRun | null, now: number, lang: Lang, t: T): string {
  if (!run) return t('run.never');
  const line = realText(run, now, lang, t);
  if (!run.aside) return line;
  const at = when(run.aside.at, now, lang, t);
  return `${line} · ${run.aside.status === 'busy' ? busyText(at, run.aside.holder, lang, t) : t('run.notDue', { at })}`;
}

function realText(run: LastRun, now: number, lang: Lang, t: T): string {
  const at = when(run.at, now, lang, t);
  const until = run.until ? when(run.until, now, lang, t) : '';
  if (run.status === 'synced') {
    let line: string;
    const r = run.result;
    const fresh = r ? r.sessions + r.rounds : 0;
    if (!r || fresh === 0) line = t('run.nothingNew', { at });
    else line = t('run.synced', { at, sessions: r.sessions, rounds: r.rounds });
    if (run.notice === 'guard_limit') return `${line} · ${until ? t('notice.guardUntil', { until }) : t('notice.guard')}`;
    if (run.notice === 'auth_expired') return `${line} · ${t('notice.authExpired')}`;
    if (run.notice === 'provider_unavailable') return `${line} · ${t('notice.unavailable')}`;
    if (run.notice === 'provider_blocked') return `${line} · ${t('notice.blocked')}`;
    if (run.notice === 'partial') return `${line} · ${t('notice.partial')}`;
    if (run.more) return `${line} · ${t('run.more')}`;
    return line;
  }
  if (run.status === 'not_due') return t('run.notDue', { at });
  if (run.status === 'busy') return busyText(at, run.holder, lang, t);
  if (run.status === 'signed_out') return t('run.signedOut', { at });
  if (run.status === 'other_account') return t('run.otherAccount', { at });
  if (run.status === 'disconnected' || run.status === 'unpaired') return t('run.disconnected', { at });
  if (run.status === 'cancelled') return t('run.cancelled', { at });
  if (run.error === 'test_data') return t('run.testData', { at });
  return t('run.failed', { at, error: run.error ?? '?' });
}

/** "Today 14 of 300 requests …" for the provider card. */
export function countsText(c: GuardCounts | null, now: number, lang: Lang, t: T): string | null {
  if (!c) return null;
  const line = t('counts.line', { day: c.day, perDay: c.limits.per_day, hour: c.hour, perHour: c.limits.per_hour });
  return c.blocked_until ? `${line} · ${t('counts.pausedUntil', { until: when(c.blocked_until, now, lang, t) })}` : line;
}

/** What went wrong, for the player: never the raw message of a target or provider (data from outside). */
export function errorText(e: unknown, now: number, lang: Lang, t: T): string {
  if (e instanceof TestModeError) return t(e.code === 'unpaired' ? 'test.pairFirst' : 'test.provider');
  if (e instanceof TargetError) {
    if (e.code === 'code_invalid') return t('error.codeInvalid');
    if (e.code === 'code_expired') return t('error.codeExpired');
    if (e.code === 'test_unavailable') return t('error.testUnavailable');
    if (e.code === 'not_test_account') return t('error.notTestAccount');
    if (e.code === 'test_data') return t('error.testData');
    if (e.code === 'token_invalid' || e.code === 'disconnected') return t('error.tokenInvalid');
    if (e.code === 'unreachable' || e.code === 'unavailable') return t('error.targetUnreachable');
    if (e.code === 'provider_unknown') return t('error.providerUnknown');
    if (e.code === 'rate_limited') return t('error.targetBusy');
    if (e.code === 'bad_answer' || e.code === 'bad_request') return t('error.targetOdd');
    return t('error.target', { code: e.code });
  }
  if (e instanceof GuardLimitError) {
    return e.until !== null && e.until > now ? t('error.guardUntil', { until: when(e.until, now, lang, t) }) : t('error.guard');
  }
  if (e instanceof GuardStorageError) return t('error.guardStorage');
  if (e instanceof ProviderAuthError) return t('error.authRejected');
  if (e instanceof ProviderBlockedError) return t('error.providerBlocked');
  if (e instanceof ProviderUnavailableError) return t('error.providerUnavailable');
  return t('error.generic');
}

/** What went wrong getting a test (spec/test-mode.md): a code the target doesn't know, or none at all, is a wrong code. */
export function testErrorText(e: unknown, now: number, lang: Lang, t: T): string {
  if (e instanceof TargetError && (e.code === 'code_invalid' || e.code === 'bad_request')) return t('test.codeWrong');
  return errorText(e, now, lang, t);
}
