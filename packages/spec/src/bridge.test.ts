// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { describe, expect, it } from 'vitest';
import { BRIDGE_FETCH_GAP_S, BRIDGE_FETCH_REASONS, BRIDGE_OUTCOMES, BRIDGE_VERSION, bridgeMessage, readBridgeReply, readBridgeRequest, readSignIn, SIGN_IN_STATES } from './bridge.ts';
import { readVectors } from './vectors.ts';

type Case = { rule: string; input: unknown; expected: unknown };

describe('the client’s sign-in answers the vectors', () => {
  const cases = readVectors<Case>('signin.json').cases;
  it.each(cases.map((c, i) => [`${i} ${JSON.stringify(c.input)}`, c] as const))('%s', (_, c) => {
    expect(readSignIn(c.input)).toEqual(c.expected);
  });
});

describe('the page bridge answers the vectors', () => {
  const file = readVectors<Case>('page-bridge.json');
  it.each(file.cases.map((c, i) => [`${i} ${c.rule} ${JSON.stringify(c.input)}`, c] as const))('%s', (_, c) => {
    if (c.rule === 'read_request') expect(readBridgeRequest(c.input)).toEqual(c.expected);
    else if (c.rule === 'read_reply') expect(readBridgeReply(c.input)).toEqual(c.expected);
    else throw new Error(`unknown rule ${c.rule}`);
  });

  it('has the protocol’s constants', () => {
    expect(file.protocol).toEqual({ version: BRIDGE_VERSION, fetch_gap_s: BRIDGE_FETCH_GAP_S, sign_in: [...SIGN_IN_STATES], outcomes: [...BRIDGE_OUTCOMES], fetch_reasons: [...BRIDGE_FETCH_REASONS] });
  });

  it('reads back every reply it writes', () => {
    const replies = [
      { id: 'a', answer: 'state', signin: 'confirm', fetching: false },
      { id: 'b', answer: 'started' },
      { id: 'c', answer: 'signin', signin: 'expired' },
      { id: 'd', answer: 'guard', until: '2026-11-18T22:30:00.000Z' },
      { id: 'e', answer: 'finished', outcome: 'guard', until: '2026-11-18T22:30:00Z' },
    ] as const;
    for (const r of replies) expect(readBridgeReply(bridgeMessage(r))).toEqual(r);
  });
});
