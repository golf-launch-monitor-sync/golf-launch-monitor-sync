// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * One HTTP exchange with a deadline that covers the whole answer, body included (a body that stalls
 * must not leave a sync marked busy). Used for both sides: the provider (through the guard) and the
 * target. Plain requests: no cookies, no User-Agent of anyone else - a request says who it is by
 * the token it carries.
 */

import { Cancelled } from './errors.ts';

export interface ResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export interface RequestInitLike {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  credentials?: 'omit';
}

export type FetchLike = (url: string, init: RequestInitLike) => Promise<ResponseLike>;

export interface Exchanged {
  status: number;
  retryAfterS: number | null;
  body: string;
}

/** No answer: none in time, none at all (offline, or a browser that wasn't allowed to ask), or too much. */
export class TransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'too_big',
    message: string,
  ) {
    super(message);
  }
}

export const TIMEOUT_MS = 30_000;
export const MAX_BODY = 32 * 1024 * 1024;

/** Seconds from a Retry-After header (seconds, or an HTTP date); null when there is none. */
export function retryAfterS(value: string | null, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[0-9]+(\.[0-9]+)?$/.test(v)) return Number(v);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, (at - now) / 1000) : null;
}

export function defaultFetch(): FetchLike {
  const f = (globalThis as { fetch?: unknown }).fetch;
  if (typeof f !== 'function') throw new Error('No fetch in this environment: pass one.');
  return f.bind(globalThis) as FetchLike;
}

export async function exchange(
  fetchImpl: FetchLike,
  url: string,
  init: Omit<RequestInitLike, 'signal' | 'credentials'>,
  opts: { signal?: AbortSignal | undefined; timeoutMs?: number; now?: () => number } = {},
): Promise<Exchanged> {
  const { signal } = opts;
  if (signal?.aborted) throw new Cancelled();
  const ctrl = new AbortController();
  let late = false;
  const timer = setTimeout(() => {
    late = true;
    ctrl.abort();
  }, opts.timeoutMs ?? TIMEOUT_MS);
  const onStop = () => ctrl.abort();
  signal?.addEventListener('abort', onStop);
  const fail = (e: unknown): never => {
    if (signal?.aborted) throw new Cancelled();
    if (late) throw new TransportError('timeout', 'No answer in time.');
    if (e instanceof TransportError) throw e;
    throw new TransportError('network', 'No answer (no network, or this page was not allowed to ask).');
  };
  try {
    let res: ResponseLike;
    try {
      res = await fetchImpl(url, { ...init, signal: ctrl.signal, credentials: 'omit' });
    } catch (e) {
      return fail(e);
    }
    const length = Number(res.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_BODY) {
      ctrl.abort();
      throw new TransportError('too_big', 'The answer is too large.');
    }
    let body: string;
    try {
      body = await res.text();
    } catch (e) {
      return fail(e);
    }
    if (body.length > MAX_BODY) throw new TransportError('too_big', 'The answer is too large.');
    const now = opts.now ?? Date.now;
    return { status: res.status, retryAfterS: retryAfterS(res.headers.get('Retry-After'), now()), body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onStop);
  }
}

/** JSON of a body, or undefined when it isn't JSON. */
export function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}
