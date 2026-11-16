// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { accountRef } from './accountRef.ts';
import { readVectors } from './vectors.ts';

type Case = { salt: string; provider: string; subject: string; expected: string };

describe('account_ref', () => {
  it.each(readVectors<Case>('account-ref.json').cases.map((c) => [`${c.salt}|${c.provider}|${c.subject}`, c] as const))(
    '%s',
    async (_, c) => {
      expect(await accountRef(c.salt, c.provider, c.subject)).toBe(c.expected);
    },
  );

  it('is 43 characters of base64url', async () => {
    expect(await accountRef('s', 'trackman', 'x')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
