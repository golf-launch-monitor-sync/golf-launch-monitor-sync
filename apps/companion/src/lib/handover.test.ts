// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
import { accountRefOf } from '@glmsync/core';
import { newQuestion, openSealed, readHandover } from '@glmsync/spec/handover';
import { describe, expect, it } from 'vitest';
import { answerSecret, answerUrl, nextStep, pickPairing, probeUserAgent, RENEW_WITHIN_MS, type Ask, type HandoverState, type TestHeld } from './handover';

const NOW = Date.parse('2026-11-28T09:00:00Z');
const DAY = 86_400_000;
const SALT = 'c2FsdC1vZi10aGUtdGFyZ2V0LTAx';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const held = (over: Partial<NonNullable<HandoverState['held']>> = {}) => ({ token: 'aaa.bbb.ccc', subject: 'sub-0001', userAgent: UA, expiresAt: NOW + 7 * DAY, ...over });
const state = (over: Partial<HandoverState> = {}): HandoverState => ({
  provider: 'trackman', salt: SALT, held: held(), now: NOW, renewTried: false, mayRenew: true, signedIn: false, ...over,
});

describe('what the companion app does when a target app asks for the sign-in (spec 1.27.0)', () => {
  it('hands over a key that lasts, with the account the target salts and the browser it came from', () => {
    expect(nextStep(state())).toEqual({
      do: 'answer',
      answer: {
        signin: 'sealed',
        message: { provider: 'trackman', token: 'aaa.bbb.ccc', account_ref: accountRefOf(SALT, 'trackman', 'sub-0001'), expires_at: '2026-12-05T09:00:00.000Z', user_agent: UA },
      },
    });
  });

  it('renews quietly first when the key runs out within three days or came without its browser, then asks the player', () => {
    const soon = state({ held: held({ expiresAt: NOW + RENEW_WITHIN_MS }) });
    expect(nextStep(soon)).toEqual({ do: 'renew' });
    expect(nextStep(state({ held: held({ userAgent: null }) }))).toEqual({ do: 'renew' });
    expect(nextStep({ ...soon, renewTried: true })).toEqual({ do: 'signin' });
    expect(nextStep({ ...soon, mayRenew: false })).toEqual({ do: 'signin' });
    // Signed in by hand and still the same key (the provider's page kept it): it is handed over as it is.
    expect(nextStep({ ...soon, renewTried: true, signedIn: true })).toMatchObject({ do: 'answer', answer: { signin: 'sealed' } });
  });

  it('asks the player to sign in when there is no key, and answers none or failed rather than going round', () => {
    expect(nextStep(state({ held: null }))).toEqual({ do: 'renew' });
    expect(nextStep(state({ held: null, renewTried: true }))).toEqual({ do: 'signin' });
    expect(nextStep(state({ held: null, renewTried: true, cancelled: true }))).toEqual({ do: 'answer', answer: { signin: 'none' } });
    // Signed in, but nothing that can be handed over (no browser to name, no account): failed, not another round.
    expect(nextStep(state({ held: held({ userAgent: null }), renewTried: true, signedIn: true }))).toEqual({ do: 'answer', answer: { signin: 'failed' } });
    expect(nextStep(state({ held: held({ subject: null }) }))).toEqual({ do: 'answer', answer: { signin: 'failed' } });
  });

  it('never hands over a key of another account than the one the target connected', () => {
    const bound = accountRefOf(SALT, 'trackman', 'sub-0002');
    expect(nextStep(state({ bound }))).toEqual({ do: 'answer', answer: { signin: 'other_account' } });
    expect(nextStep(state({ bound: accountRefOf(SALT, 'trackman', 'sub-0001') }))).toMatchObject({ answer: { signin: 'sealed' } });
  });

  it('leaves out a time it can’t name', () => {
    const r = nextStep(state({ held: held({ expiresAt: null }) }));
    expect(r).toMatchObject({ do: 'answer', answer: { signin: 'sealed' } });
    expect(r.do === 'answer' && r.answer.signin === 'sealed' && 'expires_at' in r.answer.message).toBe(false);
  });
});

describe('the way back', () => {
  const q = newQuestion();
  const ask: Ask = { key: q.key, nonce: q.nonce, back: 'exampleapp://signedin' };
  const message = { provider: 'trackman', token: 'aaa.bbb.ccc', account_ref: accountRefOf(SALT, 'trackman', 'sub-0001'), user_agent: UA };

  it('carries the sign-in sealed for the asking app alone', () => {
    const url = answerUrl(ask, { signin: 'sealed', message }, answerSecret({ importToken: 'glms_x', key: q.key, nonce: q.nonce, now: NOW }));
    const a = readHandover(url);
    expect(a?.signin).toBe('sealed');
    if (a?.signin !== 'sealed') return;
    expect(openSealed(a.box, a.from, q.nonce, q.secret)).toEqual(message);
    expect(url).not.toContain('aaa.bbb.ccc');
  });

  it('says failed where the sealed answer would not fit, and only goes back where the link asked without a key', () => {
    const long = { ...message, token: 'x'.repeat(4096), user_agent: 'y'.repeat(512) };
    const back = { ...ask, back: `https://app.example.org/${'p'.repeat(2000)}` };
    expect(readHandover(answerUrl(back, { signin: 'sealed', message: long }, answerSecret({ importToken: 't', key: q.key, nonce: q.nonce, now: NOW })))).toEqual({ signin: 'failed' });
    expect(answerUrl(ask, { signin: 'none' }, 'unused')).toBe('exampleapp://signedin#signin=none');
    expect(answerUrl({ back: 'exampleapp://paired' }, { signin: 'sealed', message }, 'unused')).toBe('exampleapp://paired');
  });

  it('makes a new secret for every question, from what only this phone holds', () => {
    const a = answerSecret({ importToken: 'glms_x', key: q.key, nonce: q.nonce, now: NOW });
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(answerSecret({ importToken: 'glms_x', key: q.key, nonce: newQuestion().nonce, now: NOW })).not.toBe(a);
    expect(answerSecret({ importToken: 'glms_y', key: q.key, nonce: q.nonce, now: NOW })).not.toBe(a);
  });
});

describe('which connection a signin link is for', () => {
  const pairing = (base: string, provider: string, prefixes: string[]) => ({ key: `${base}|${provider}`, base, provider, target: { name: 'App', return_prefixes: prefixes } });
  const caddie = pairing('https://app.example.org/lm/v1', 'trackman', ['exampleapp://']);
  const other = pairing('https://other.example.net/lm/v1', 'trackman', ['otherapp://']);
  const link = { provider: 'trackman', return: 'exampleapp://signedin' };

  it('takes the pairing of that provider whose app the way back belongs to', () => {
    expect(pickPairing(link, [other, caddie])).toBe(caddie);
    expect(pickPairing({ ...link, target: 'https://app.example.org/lm/v1/' }, [other, caddie])).toBe(caddie);
  });

  it('takes none for another provider, another target or a way back no paired app named', () => {
    expect(pickPairing({ ...link, provider: 'demo' }, [caddie])).toBeNull();
    expect(pickPairing({ ...link, target: 'https://other.example.net/lm/v1' }, [other, caddie])).toBeNull();
    expect(pickPairing({ ...link, return: 'evilapp://x' }, [other, caddie])).toBeNull();
    expect(pickPairing(link, [])).toBeNull();
  });
});

describe('a test sign-in (spec 1.28.0): the tester’s code instead of the provider’s sign-in', () => {
  const MIN = 60_000;
  const test = (over: Partial<TestHeld> = {}): TestHeld => ({
    code: 'K7MP-Q2RX', subject: 'caddie-test-T21-a-leon', userAgent: UA, validUntil: new Date(NOW + 7 * DAY).toISOString(), signinValidS: 600, ...over,
  });

  it('hands over the code as the sign-in, of the scenario’s made-up account, running out after signin_valid_s - before any real key held', () => {
    expect(nextStep(state({ test: test() }))).toEqual({
      do: 'answer',
      answer: {
        signin: 'sealed',
        message: {
          provider: 'trackman', token: 'K7MP-Q2RX', account_ref: accountRefOf(SALT, 'trackman', 'caddie-test-T21-a-leon'),
          expires_at: new Date(NOW + 10 * MIN).toISOString(), user_agent: UA, test: true,
        },
      },
    });
  });

  it('never past the test’s end; without signin_valid_s, to the test’s end', () => {
    const end = new Date(NOW + 5 * MIN).toISOString();
    expect(nextStep(state({ test: test({ validUntil: end }) }))).toMatchObject({ answer: { message: { expires_at: new Date(NOW + 5 * MIN).toISOString() } } });
    const { signinValidS: _, ...without } = test();
    expect(nextStep(state({ test: without }))).toMatchObject({ answer: { message: { expires_at: new Date(NOW + 7 * DAY).toISOString(), test: true } } });
  });

  it('renews by handing it over again with a new end, as long as the code lasts, without asking', () => {
    const later = nextStep(state({ test: test(), now: NOW + 3 * DAY, renewTried: false }));
    expect(later).toMatchObject({ do: 'answer', answer: { message: { expires_at: new Date(NOW + 3 * DAY + 10 * MIN).toISOString() } } });
  });

  it('a test that is over (or ends within the minute) is no sign-in any more: the question goes on as without it', () => {
    const over = test({ validUntil: new Date(NOW).toISOString() });
    expect(nextStep(state({ test: over }))).toMatchObject({ answer: { message: { token: 'aaa.bbb.ccc' } } });
    expect(nextStep(state({ test: test({ validUntil: new Date(NOW + 30_000).toISOString() }), held: null }))).toEqual({ do: 'renew' });
  });

  it('never for another account than the one the target connected', () => {
    expect(nextStep(state({ test: test(), bound: accountRefOf(SALT, 'trackman', 'someone-else') }))).toEqual({ do: 'answer', answer: { signin: 'other_account' } });
  });

  it('goes back sealed, and the asking app reads it as a test’s', () => {
    const q = newQuestion();
    const step = nextStep(state({ test: test() }));
    if (step.do !== 'answer') throw new Error('no answer');
    const url = answerUrl({ key: q.key, nonce: q.nonce, back: 'exampleapp://signedin' }, step.answer, answerSecret({ importToken: 'glms_x', key: q.key, nonce: q.nonce, now: NOW }));
    const a = readHandover(url);
    if (a?.signin !== 'sealed') throw new Error('not sealed');
    expect(openSealed(a.box, a.from, q.nonce, q.secret)).toMatchObject({ token: 'K7MP-Q2RX', test: true });
    expect(url).not.toContain('K7MP-Q2RX');
  });
});

describe('the browser of this phone, for a test sign-in (spec 1.28.0)', () => {
  it('takes what the empty web view says only as a header value', () => {
    expect(probeUserAgent(JSON.stringify({ ua: UA }))).toBe(UA);
    for (const junk of [null, 7, '', 'not json', JSON.stringify({ ua: 'Mozilla/5.0 ü' }), JSON.stringify({ ua: '' }), JSON.stringify({ ua: 'x'.repeat(513) }), JSON.stringify([UA])]) {
      expect(probeUserAgent(junk)).toBeNull();
    }
  });
});
