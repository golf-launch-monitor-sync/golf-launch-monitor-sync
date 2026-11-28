// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Connecting as steps on the phone: the frame and the words are the browser clients' (`@glmsync/browser`'s wizard,
 * the same for every service); here only what the app knows turned into its facts. Pure, so it is tested without a
 * phone.
 *
 * The app keeps a sign-in only after the player's yes, so before that there is nothing to count: no number shows
 * until the account is confirmed.
 */

import { translator } from '@glmsync/browser/i18n';
import { wizardLines, wizardOf, type WizardFacts, type WizardLines, type WizardView, type WizardWords } from '@glmsync/browser/wizard';
import type { LastRun } from '@glmsync/engine';
import type { Lang } from './text.ts';

/** The steps before the yes: not signed in yet (2), or the account named and waiting for the answer (3). */
export function beforeYes(asking: boolean): WizardFacts {
  return { kind: 'lm', signedIn: asking, asking, confirmed: false, first: 'waiting', brought: null, more: null };
}

/** Step 3 about a target's made-up account (test mode, spec/test-mode.md): its test code stood in for the sign-in. */
export function testAccount(): WizardFacts {
  return { ...beforeYes(true), test: true };
}

/**
 * The pairings a test code can be for, where a provider's sign-in is asked for (small, *Enter a test code*, under it):
 * that provider's, not in test mode already. None: no test code there.
 */
export function testKeys(pairings: readonly { key: string; provider: string }[], provider: string, testing: (key: string) => boolean): string[] {
  return pairings.filter((p) => p.provider === provider && !testing(p.key)).map((p) => p.key);
}

/**
 * Steps 4 and 5: the first sync under way or through, and what the pairings' runs brought (the one that brought most
 * speaks for all - each gets the same account's data).
 */
export function firstLoad(runs: readonly (LastRun | null)[], phase: 'running' | 'through'): WizardFacts {
  let best: LastRun | null = null;
  for (const r of runs) {
    const n = (r?.total?.sessions ?? 0) + (r?.total?.rounds ?? 0);
    if (r && (!best || n > (best.total?.sessions ?? 0) + (best.total?.rounds ?? 0))) best = r;
  }
  const failed = phase === 'through' && runs.length > 0 && runs.every((r) => !r || r.status === 'failed');
  return {
    kind: 'lm',
    signedIn: true,
    asking: false,
    confirmed: true,
    first: failed ? 'failed' : phase,
    brought: best?.total ? { sessions: best.total.sessions, rounds: best.total.rounds } : null,
    more: best?.older === false ? false : typeof best?.left === 'number' ? best.left : best?.more ? true : null,
  };
}

/** The step and its words, in the phone's language. */
export function wizardText(f: WizardFacts, lang: Lang, words: WizardWords): { view: WizardView; lines: WizardLines } {
  const view = wizardOf(f);
  return { view, lines: wizardLines(view, f, translator(lang), words) };
}
