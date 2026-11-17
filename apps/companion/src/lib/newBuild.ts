// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Whether a new build of this app is out (LMS-W3-N-b, 17 Nov: updates without anyone having to say so).
 *
 * The JavaScript part arrives over the air by itself (companion-update.yml). A change to the native part needs a new
 * build, which an update can't bring: then this app says so when it starts. Android downloads the newest APK with
 * one tap (the GitHub pre-release `companion-android`, until the app is in Google Play); the iPhone gets it from
 * TestFlight, which updates by itself where automatic updates are on, else a tap opens it.
 *
 * How it knows: `latest.json` beside the APK (written by scripts/release.sh with each build) names the runtime - the
 * fingerprint of the native part - of the newest build per platform. A build of another runtime than this one's
 * is a newer one: builds come from the workflow only. Everything read from there is data: only the runtime string
 * is used, and the address to go to is this app's own, never one from the file. A fork changes RELEASES.
 */

export const RELEASES = 'https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases/download/companion-android/';
export const LATEST_URL = `${RELEASES}latest.json`;
/** The same address the target apps' *Install* uses. */
export const APK_URL = `${RELEASES}golf-launch-monitor-sync-companion.apk`;
/** TestFlight's own scheme: opens the app's page there. */
export const TESTFLIGHT_URL = 'itms-beta://';
/** The file is a few hundred bytes; more is not ours. */
const MAX_CHARS = 20_000;
const TIMEOUT_MS = 10_000;

export type Platform = 'android' | 'ios';
export type NewBuild = { platform: 'android'; url: string } | { platform: 'ios'; url: string };

/** `latest.json`'s runtime for `platform`, or null when the file says nothing usable about it. */
export function latestRuntime(latest: unknown, platform: Platform): string | null {
  if (!latest || typeof latest !== 'object') return null;
  const entry = (latest as Record<string, unknown>)[platform];
  if (!entry || typeof entry !== 'object') return null;
  const runtime = (entry as Record<string, unknown>).runtime;
  return typeof runtime === 'string' && /^[\w.:-]{1,200}$/.test(runtime) ? runtime : null;
}

/**
 * A new build for this phone, or null: not when the running app has no runtime (a development build, Expo Go), not
 * on another platform, not when the file names none, not when it names this one.
 */
export function newBuild(platform: string, ownRuntime: string | null | undefined, latest: unknown): NewBuild | null {
  if (platform !== 'android' && platform !== 'ios') return null;
  if (!ownRuntime) return null;
  const newest = latestRuntime(latest, platform);
  if (!newest || newest === ownRuntime) return null;
  return platform === 'android' ? { platform, url: APK_URL } : { platform, url: TESTFLIGHT_URL };
}

/**
 * Reads `latest.json` and answers `newBuild`. Never throws: no network, an error page, a slow answer or junk mean
 * "nothing to say" - this is a hint, and the app works as before without it.
 */
export async function checkNewBuild(
  platform: string,
  ownRuntime: string | null | undefined,
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = TIMEOUT_MS,
): Promise<NewBuild | null> {
  if (!ownRuntime || (platform !== 'android' && platform !== 'ios')) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(LATEST_URL, { signal: abort.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_CHARS) return null;
    return newBuild(platform, ownRuntime, JSON.parse(text));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
