// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Signing in for an app that fetches itself (spec 1.27.0, lib/handover.ts): a signin link, or a pair link with
 * `mode=signin`, from an app paired here. The sign-in is renewed quietly where it runs out soon, else the player signs in
 * (the provider's own page, then "Is this you?"), and the app goes back - with the sign-in sealed for the asking app's key
 * when the link asked with one. Every way this ends goes back with an answer the app can act on (`none`, `other_account`,
 * `failed`), or - where the app can't be opened - stays here and says so.
 *
 * Test mode (spec 1.28.0): small under the sign-in, *Enter a test code* (or the test page's QR, scanned meanwhile: its
 * link brings the code here, `code`). The scenario comes from the asking app with this app's pairing, "Is this your
 * account?" as always (TestView), then the code goes over as a test sign-in with this phone's browser (UserAgentProbe)
 * - and again with a new end at each later question while the test lasts, without asking.
 */

import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { t } from '../i18n';
import type { TestScenario } from '@glmsync/spec';
import { answerSecret, answerUrl, nextStep, RENEW_FOR_ASK_MS, RENEW_WITHIN_MS, type Ask, type HandoverOutcome } from '../lib/handover';
import { goBack } from '../lib/firstSync';
import type { ProviderId, Services } from '../lib/services';
import type { Screen } from './App';
import { Body, Button, Card, s, Title } from './parts';
import { SignInView } from './SignInView';
import { TestView } from './TestView';
import { UserAgentProbe } from './UserAgentProbe';

type Phase =
  | { name: 'working' }
  | { name: 'signin' }
  /** Test mode: the code's step (`code`: one a test link brought). */
  | { name: 'test'; code?: string }
  /** The tester said yes: this phone's browser is read, then the test sign-in kept. */
  | { name: 'testKeep'; scenario: TestScenario; code: string; done: { ok: () => void; fail: (e: unknown) => void } }
  | { name: 'stayed' | 'unpaired' }
  | { name: 'said'; text: string };

export function HandoverView({
  svc,
  provider,
  pairing,
  name,
  ask,
  code,
  renew,
  go,
}: {
  svc: Services;
  provider: ProviderId;
  /** The pairing of the asking app (its key). */
  pairing: string;
  /** The asking app's name. */
  name: string;
  ask: Ask;
  /** A test code a test link brought while this question is open (spec 1.28.0; the QR of the test page). */
  code?: string;
  /** The quiet renewal (App): `early`, renew a key that runs out within this long too. */
  renew: (maxMs: number, early?: number) => Promise<void>;
  go: (s: Screen) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: 'working' });
  const [flags, setFlags] = useState({ renewTried: false, signedIn: false, cancelled: false });
  const [renewing, setRenewing] = useState(false);
  const busy = useRef(false);
  const p = svc.pairings.get(pairing);
  const words = { name, provider: svc.providers[provider]?.name ?? provider };

  // A test link while the question is open: its code goes to the test step (a new code, a fresh step).
  const testKey = useRef('');
  useEffect(() => {
    if (!code) return;
    testKey.current = code;
    setPhase({ name: 'test', code });
  }, [code]);

  useEffect(() => {
    if (busy.current || phase.name !== 'working') return;
    const now = Date.now();
    if (!p) {
      setPhase({ name: 'unpaired' });
      return;
    }
    const signIn = svc.signIns.get(provider);
    const step = nextStep({
      provider,
      salt: p.account_salt,
      ...(p.account_ref ? { bound: p.account_ref } : {}),
      held: signIn && svc.signIns.valid(provider, now) ? { token: signIn.token, subject: signIn.subject, userAgent: signIn.userAgent, expiresAt: svc.signIns.expiresAt(provider) } : null,
      now,
      renewTried: flags.renewTried,
      mayRenew: provider === 'trackman' && svc.signIns.mayRenewEarly(provider, RENEW_WITHIN_MS, now),
      signedIn: flags.signedIn,
      cancelled: flags.cancelled,
      test: svc.testSignIns.get(pairing),
    });
    busy.current = true;
    void (async () => {
      try {
        if (step.do === 'renew') {
          setRenewing(true);
          await renew(RENEW_FOR_ASK_MS, RENEW_WITHIN_MS).catch(() => undefined);
          setRenewing(false);
          setFlags((f) => ({ ...f, renewTried: true }));
        } else if (step.do === 'signin') {
          setPhase({ name: 'signin' });
        } else {
          await answer(step.answer);
        }
      } finally {
        busy.current = false;
      }
    })();
  }, [phase.name, flags, p, pairing, provider, svc, renew]);

  async function answer(outcome: HandoverOutcome) {
    if (!p) return setPhase({ name: 'unpaired' });
    let url: string;
    try {
      url = answerUrl(ask, outcome, answerSecret({ importToken: p.token, key: ask.key ?? '', nonce: ask.nonce ?? '', now: Date.now() }));
    } catch {
      // Sealing failed (it shouldn't): the asking app still hears that nothing came.
      url = answerUrl(ask, { signin: 'failed' }, '');
    }
    const how = await goBack(url, (u) => Linking.openURL(u));
    if (how === 'back') return go({ name: 'home', focus: `lm:${provider}`, linked: true });
    // The app couldn't be opened: say what came of it here instead.
    if (outcome.signin === 'other_account') return setPhase({ name: 'said', text: t('handover.other', words) });
    if (outcome.signin === 'failed') return setPhase({ name: 'said', text: t('handover.failed', words) });
    setPhase({ name: 'stayed' });
  }

  if (phase.name === 'signin') {
    return (
      <SignInView
        svc={svc}
        provider={provider}
        target={name}
        backTo={name}
        test={() => setPhase({ name: 'test' })}
        done={(signedIn) => {
          setFlags((f) => ({ ...f, signedIn: f.signedIn || signedIn, cancelled: !signedIn }));
          setPhase({ name: 'working' });
        }}
      />
    );
  }

  if (phase.name === 'test' || phase.name === 'testKeep') {
    // The code's step and "Is this your account?" as in test mode; after the yes, the code goes over (no sync here).
    const keep = phase.name === 'testKeep' ? phase : null;
    return (
      <>
        <TestView
          key={testKey.current}
          svc={svc}
          keys={[pairing]}
          {...(phase.name === 'test' && phase.code ? { code: phase.code } : {})}
          back={{ url: ask.back, name }}
          go={go}
          cancel={() => setPhase({ name: 'signin' })}
          taken={(_, scenario, c) => new Promise<void>((ok, fail) => setPhase({ name: 'testKeep', scenario, code: c, done: { ok, fail } }))}
        />
        {keep && (
          <UserAgentProbe
            done={(probed) =>
              void (async () => {
                // The browser as at a real sign-in; where the web view said nothing, the one kept with a real sign-in here.
                const userAgent = probed ?? svc.signIns.get(provider)?.userAgent ?? null;
                if (!userAgent) throw new Error('no browser');
                await svc.testSignIns.set(pairing, {
                  code: keep.code,
                  subject: keep.scenario.subject,
                  userAgent,
                  validUntil: keep.scenario.valid_until,
                  ...(keep.scenario.signin_valid_s !== undefined ? { signinValidS: keep.scenario.signin_valid_s } : {}),
                });
              })().then(
                () => {
                  keep.done.ok();
                  setPhase({ name: 'working' });
                },
                (e: unknown) => {
                  keep.done.fail(e);
                  setPhase({ name: 'test' });
                },
              )
            }
          />
        )}
      </>
    );
  }

  let text: string;
  if (phase.name === 'unpaired') text = t('handover.unpaired');
  else if (phase.name === 'stayed') text = t('handover.stayed', words);
  else if (phase.name === 'said') text = phase.text;
  else text = renewing ? t('handover.renewing', words) : t('handover.going', words);
  return (
    <ScrollView contentContainerStyle={s.scroll}>
      <Card>
        <Title>{t('handover.title', words)}</Title>
        <Body muted>{t('handover.what', words)}</Body>
        <Body warn={phase.name !== 'working'}>{text}</Body>
        {phase.name !== 'working' && <Button label={t('action.ok')} onPress={() => go(p ? { name: 'home', focus: `lm:${provider}`, linked: true } : { name: 'home' })} />}
      </Card>
    </ScrollView>
  );
}
