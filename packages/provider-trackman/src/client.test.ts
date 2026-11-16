// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { Guard, guardAccount, MemoryStorage, ProviderAuthError, ProviderError, ProviderUnavailableError, providerContext } from '@glmsync/core';
import { VirtualClock } from '@glmsync/core/testing';
import { describe, expect, it } from 'vitest';
import { query } from './client.ts';
import { respond } from './testing.ts';
import type { FetchLike } from '@glmsync/core';

function ctxWith(answer: () => ReturnType<typeof respond>) {
  const clock = new VirtualClock();
  const f: FetchLike = async () => answer();
  const guard = new Guard({ storage: new MemoryStorage(), now: clock.now, sleep: clock.sleep });
  return providerContext({ guard, account: guardAccount('trackman', 'x'), fetch: f, now: clock.now });
}

describe('one call to Trackman', () => {
  it('answers with the data', async () => {
    await expect(query(ctxWith(() => respond(200, { data: { me: { a: 1 } } })), 'k', 't', 'query X {}')).resolves.toEqual({ me: { a: 1 } });
  });

  it.each([
    [401, ProviderAuthError],
    [403, ProviderUnavailableError],
    [429, ProviderUnavailableError],
    [500, ProviderUnavailableError],
    [400, ProviderUnavailableError],
  ])('reads HTTP %i as the connection’s trouble', async (status, kind) => {
    await expect(query(ctxWith(() => respond(status, '{}')), 'k', 't', 'query X {}')).rejects.toBeInstanceOf(kind);
  });

  it('takes a page that is no JSON (a maintenance page) for Trackman having a moment', async () => {
    await expect(query(ctxWith(() => respond(200, '<html>')), 'k', 't', 'query X {}')).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('takes partial data as data, unless asked for complete answers; errors alone as one item’s trouble', async () => {
    const partial = () => respond(200, { data: { me: { a: 1 }, other: null }, errors: [{ message: 'one field' }] });
    await expect(query(ctxWith(partial), 'k', 't', 'q')).resolves.toEqual({ me: { a: 1 }, other: null });
    const strict = await query(ctxWith(partial), 'k', 't', 'q', {}, { partialOk: false }).catch((e: unknown) => e);
    expect(strict).toBeInstanceOf(ProviderError);
    expect(strict).not.toBeInstanceOf(ProviderUnavailableError);
    await expect(query(ctxWith(() => respond(200, { errors: [{ message: 'no' }] })), 'k', 't', 'q')).rejects.toThrow('Trackman: no');
  });

  it('asks nothing without a sign-in', async () => {
    let asked = false;
    const ctx = ctxWith(() => {
      asked = true;
      return respond(200, {});
    });
    await expect(query(ctx, 'k', '', 'q')).rejects.toBeInstanceOf(ProviderAuthError);
    expect(asked).toBe(false);
  });
});
