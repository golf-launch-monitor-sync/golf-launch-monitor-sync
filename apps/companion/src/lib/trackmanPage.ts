// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Which pages the sign-in window trusts (TrackmanLoginView): pure, so the rules are tested.
 */

/** Trackman's own sites: the only pages the window takes a key from. */
const TRACKMAN_HOST = /(^|\.)trackman(golf)?\.com$/;
/**
 * Where Trackman's sign-in page sends a player who picks Apple or Google: shown in the window so that
 * sign-in can finish there, but never trusted with a key.
 */
const SIGN_IN_HOST = /^(appleid\.apple\.com|idmsa\.apple\.com|accounts\.google\.com)$/;
const KEY = /^[\w-]+\.[\w-]+\.[\w-]+$/;

function host(url: string | undefined, pattern: RegExp): boolean {
  try {
    const u = new URL(url ?? '');
    return u.protocol === 'https:' && pattern.test(u.hostname);
  } catch {
    return false;
  }
}

export const fromTrackman = (url: string | undefined) => host(url, TRACKMAN_HOST);
export const isSignInPage = (url: string | undefined) => host(url, SIGN_IN_HOST);

/** The key a message from the page carries - only from a Trackman page, and only something shaped like one. */
export function readCapturedToken(pageUrl: string | undefined, data: unknown): string | null {
  if (!fromTrackman(pageUrl) || typeof data !== 'string' || data.length > 20_000) return null;
  try {
    const { token } = JSON.parse(data) as { token?: unknown };
    return typeof token === 'string' && KEY.test(token) ? token : null;
  } catch {
    return null;
  }
}
