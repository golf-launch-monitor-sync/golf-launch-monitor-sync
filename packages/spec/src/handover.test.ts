// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import {
  HANDOVER_MAX_ANSWER, HANDOVER_RESULTS, newQuestion, openSealed, publicKey, readHandover, seal, signinLink, withAnswer,
  type HandedOver,
} from './handover.ts';
import { parseLink, universalLink } from './deepLinks.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: unknown; expected: unknown };
const file = readVectors<Case>('handover.json');

describe('the sealed handover answers the vectors (1.27.0)', () => {
  it.each(file.cases.map((c, i) => [`${i} ${c.rule} ${JSON.stringify(c.input)?.slice(0, 90)}`, c] as const))('%s', (_, c) => {
    const i = c.input as Record<string, unknown>;
    if (c.rule === 'public_key') expect(publicKey(c.input)).toEqual(c.expected);
    else if (c.rule === 'seal') expect(seal(i.message, i.key, i.nonce, i.secret)).toEqual(c.expected);
    else if (c.rule === 'open') expect(openSealed(i.box, i.from, i.nonce, i.secret)).toEqual(c.expected);
    else if (c.rule === 'with_answer') expect(withAnswer(i.url, i.answer)).toEqual(c.expected);
    else if (c.rule === 'read_answer') expect(readHandover(c.input)).toEqual(c.expected);
    else throw new Error(`unknown rule ${c.rule}`);
  });

  it('covers every rule', () => {
    expect(new Set(file.cases.map((c) => c.rule))).toEqual(new Set(['public_key', 'seal', 'open', 'with_answer', 'read_answer']));
  });

  it('has the spec’s constants', () => {
    expect(file.results).toEqual([...HANDOVER_RESULTS]);
    expect(file.max_answer).toBe(HANDOVER_MAX_ANSWER);
  });
});

describe('a question and its answer, end to end', () => {
  const message: HandedOver = {
    provider: 'trackman',
    token: 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.eA',
    account_ref: 'c3ludGhldGljLWFjY291bnQtcmVm',
    expires_at: '2026-12-05T08:12:00Z',
    user_agent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36',
  };

  it('opens only with the key and nonce of its own question', () => {
    const q = newQuestion();
    const other = newQuestion();
    const link = signinLink({ provider: 'trackman', key: q.key, nonce: q.nonce, back: 'exampleapp://signedin' });
    const parsed = parseLink(link);
    expect(parsed).toEqual({ ok: true, action: 'signin', provider: 'trackman', key: q.key, nonce: q.nonce, return: 'exampleapp://signedin' });
    expect(universalLink(link)?.includes('/link/signin#')).toBe(true);
    const sealed = seal(message, q.key, q.nonce);
    expect(sealed).not.toBeNull();
    const back = withAnswer('exampleapp://signedin', { signin: 'sealed', ...sealed! });
    const answer = readHandover(back);
    expect(answer?.signin).toBe('sealed');
    if (answer?.signin !== 'sealed') return;
    expect(openSealed(answer.box, answer.from, q.nonce, q.secret)).toEqual(message);
    expect(openSealed(answer.box, answer.from, other.nonce, q.secret)).toBeNull();
    expect(openSealed(answer.box, answer.from, q.nonce, other.secret)).toBeNull();
  });

  it('makes a new key and nonce for every question', () => {
    const a = newQuestion();
    const b = newQuestion();
    expect(a.key).not.toBe(b.key);
    expect(a.nonce).not.toBe(b.nonce);
    expect(publicKey(a.secret)).toBe(a.key);
  });
});
