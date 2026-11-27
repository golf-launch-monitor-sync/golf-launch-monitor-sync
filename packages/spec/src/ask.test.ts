// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import {
  ANSWER_ACCEPT_S, ANSWER_BLOCKED, ANSWER_FAILED, ANSWER_FINAL_S, ANSWER_STATES, ANSWER_V, ASK_CAUSES, ENV_MAX, ENV_VALUES,
  envParam, mayAsk, OWN_MAX_S, ownAskAt, readAnswer, readCause, readEnv, readVersion,
} from './ask.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: unknown; expected: unknown };
const file = readVectors<Case>('ask.json');

describe('the question and the answer answer the vectors (1.22.0)', () => {
  it.each(file.cases.map((c, i) => [`${i} ${c.rule} ${JSON.stringify(c.input)?.slice(0, 90)}`, c] as const))('%s', (_, c) => {
    const i = c.input as Record<string, unknown>;
    if (c.rule === 'read_cause') expect(readCause(c.input)).toEqual(c.expected);
    else if (c.rule === 'read_version') expect(readVersion(c.input)).toEqual(c.expected);
    else if (c.rule === 'read_env') expect(readEnv(c.input)).toEqual(c.expected);
    else if (c.rule === 'read_answer') expect(readAnswer(c.input)).toEqual(c.expected);
    else if (c.rule === 'own_ask_at') expect(ownAskAt(i.own_at, i.next_at, i.received_at)).toEqual(c.expected);
    else if (c.rule === 'may_ask') expect(mayAsk(i.reason, i.cause, i.now, i.next_at, i.received_at)).toBe(c.expected);
    else throw new Error(`unknown rule ${c.rule}`);
  });

  it('covers every rule', () => {
    expect(new Set(file.cases.map((c) => c.rule))).toEqual(new Set(['read_cause', 'read_version', 'read_env', 'read_answer', 'own_ask_at', 'may_ask']));
  });

  it('has the spec’s constants', () => {
    expect(file.ask).toEqual({
      causes: [...ASK_CAUSES], env: ENV_VALUES, env_max: ENV_MAX, answer_v: ANSWER_V, states: [...ANSWER_STATES],
      blocked: [...ANSWER_BLOCKED], failed: [...ANSWER_FAILED], accept_s: ANSWER_ACCEPT_S, answer_s: ANSWER_FINAL_S, own_max_s: OWN_MAX_S,
    });
  });
});

describe('env as a client sends it', () => {
  it('reads back as what went in, in the spec’s order and without what it doesn’t know', () => {
    const value = envParam({ push: 'off', os: 'android', battery: 'optimized', background: 'available' });
    expect(value).toBe('os:android,background:available,battery:optimized,push:off');
    expect(readEnv([value])).toEqual({ os: 'android', background: 'available', battery: 'optimized', push: 'off' });
    expect(envParam({ os: 'ios', battery: 'sometimes' } as never)).toBe('os:ios');
    expect(envParam({})).toBe('');
  });
});
