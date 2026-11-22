// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Connecting, as steps with their progress: the same frame for every service the project reads (a launch monitor's
 * account, golf.de's handicap record, those to come), in the extension, the web app and the companion app alike.
 *
 * 1. the player's yes that an app gets the data (the pairing), 2. what to connect (Trackman, golf.de, those to come),
 * 3. the service's own steps (sign in), 4. the account the service names, and the player's yes, 5. the first data,
 * shown plainly, 6. done: back to the app. One button per step, little text.
 *
 * Until the player said yes to the account nothing here looks as if it were running: no count of sessions, results or
 * requests, only what is missing ("Not yet connected with … – confirm your account"). A count in the question itself
 * would read like data already on its way (a player once saw "150 activities" in the question, took it for synced,
 * and never said yes).
 *
 * Pure, so it is tested without a browser: each client turns its own state into `WizardFacts` (`factsOfStatus`,
 * `factsOfHcp`, the companion app its own), `wizardOf` decides the step, `wizardLines` says it.
 */

import type { ClientStatus } from './client.ts';
import type { HcpView } from './hcp.ts';
import { formatDate, type Lang, type T } from './i18n.ts';

export type WizardStep = 'pair' | 'service' | 'signin' | 'account' | 'load' | 'done';
export const WIZARD_STEPS: readonly WizardStep[] = ['pair', 'service', 'signin', 'account', 'load', 'done'];

/** The services a pairing of a kind can connect: today one each, later more launch monitors. */
export type ServiceKind = 'lm' | 'hcp';

export interface WizardFacts {
  /** `lm`: a launch monitor's account (sessions, rounds, an older history); `hcp`: a handicap record (results). */
  kind: ServiceKind;
  /**
   * The player allowed an app to get the data (its pairing follows once the service is chosen). Absent: yes - every connection that has a client
   * state behind it is paired; only a new connection's first two steps say no.
   */
  paired?: boolean;
  /** What to connect is chosen (absent: yes, as above). */
  chosen?: boolean;
  /** Signed in at the service on this device, with an account it named. */
  signedIn: boolean;
  /** The account named waits for the player's yes. */
  asking: boolean;
  /** The player said it is theirs (or an app already has this very account connected). */
  confirmed: boolean;
  /** The first data after the yes: nothing yet, under way, through, or it failed. */
  first: 'waiting' | 'running' | 'through' | 'failed';
  /** What came since connecting (null: nothing to say yet). */
  brought: { sessions: number; rounds: number } | { results: number } | null;
  /** The older history: how many sessions still to come, `true` when that isn't known, `false` when complete. */
  more: number | boolean | null;
}

export interface WizardView {
  step: WizardStep;
  /** 1-based, of `total`. */
  index: number;
  total: number;
  steps: { id: WizardStep; state: 'done' | 'current' | 'todo' }[];
  /** Before the yes: what is missing, said big - and nothing that looks like data on its way. */
  unconfirmed: 'sign_in' | 'confirm' | null;
}

export function wizardOf(f: WizardFacts): WizardView {
  const step: WizardStep =
    f.paired === false ? 'pair' : f.chosen === false ? 'service' : !f.confirmed ? (f.signedIn && f.asking ? 'account' : 'signin') : f.first === 'through' ? 'done' : 'load';
  const at = WIZARD_STEPS.indexOf(step);
  return {
    step,
    index: at + 1,
    total: WIZARD_STEPS.length,
    // The last step is done once it is reached: nothing is left to do there.
    steps: WIZARD_STEPS.map((id, i) => ({ id, state: i < at || (step === 'done' && i === at) ? 'done' : i === at ? 'current' : 'todo' })),
    // Before the pairing there is no app to be "not yet connected" with.
    unconfirmed: f.confirmed || step === 'pair' || step === 'service' ? null : step === 'account' ? 'confirm' : 'sign_in',
  };
}

export interface WizardWords {
  /** The service's name ("Trackman", "golf.de"). */
  service: string;
  /** The app the data goes to; null when there are several or none is named. */
  target: string | null;
}

export interface WizardLines {
  progress: string;
  labels: string[];
  title: string;
  /** The big line before the yes. */
  unconfirmed: string | null;
  /** Steps 3 and 4: what came. Never before the yes. */
  brought: string | null;
  /** Steps 3 and 4: what is still to come. */
  more: string | null;
}

export function wizardLines(v: WizardView, f: WizardFacts, t: T, w: WizardWords): WizardLines {
  const target = w.target ?? t('wizard.yourApp');
  const vars = { service: w.service, target };
  const titles: Record<WizardStep, () => string> = {
    pair: () => (w.target ? t('wizard.title.pair', vars) : t('wizard.title.pairStart')),
    service: () => t('wizard.title.service'),
    signin: () => t('wizard.title.signin', vars),
    account: () => t('wizard.title.account', vars),
    load: () => t(f.kind === 'hcp' ? 'wizard.title.loadHcp' : 'wizard.title.load'),
    done: () => t('wizard.title.done'),
  };
  const title = titles[v.step]();
  const after = v.step === 'load' || v.step === 'done';
  let brought: string | null = null;
  if (after && f.brought) {
    if ('results' in f.brought) brought = t('wizard.broughtResults', { results: f.brought.results, target });
    else if (f.brought.sessions + f.brought.rounds > 0) brought = t('wizard.brought', { sessions: f.brought.sessions, rounds: f.brought.rounds });
    else if (f.first === 'through') brought = t('wizard.broughtNone');
  } else if (after && f.first === 'through' && f.kind === 'lm') brought = t('wizard.broughtNone');
  let more: string | null = null;
  if (after && f.first === 'through') {
    if (f.kind === 'hcp') more = t('wizard.hcpMore');
    else if (typeof f.more === 'number' && f.more > 0) more = t('wizard.more', { left: f.more });
    else if (f.more === true || f.more === 0) more = t('wizard.moreSoon');
    else if (f.more === false) more = t('wizard.complete');
  }
  return {
    progress: t('wizard.progress', { index: v.index, total: v.total }),
    labels: v.steps.map((s) => t(`wizard.label.${s.id}`)),
    title,
    unconfirmed: v.unconfirmed ? t(`wizard.unconfirmed.${v.unconfirmed}`, vars) : null,
    brought,
    more,
  };
}

/** The app's name for the big line: the one app, or none named when there are several. */
export function targetOf(names: readonly string[]): string | null {
  const distinct = [...new Set(names)];
  return distinct.length === 1 ? (distinct[0] as string) : null;
}

/**
 * What the question "Is this your account?" says of a launch monitor account besides its name: its newest activity
 * (and where). No count: a number there read like data already fetched.
 */
export function whoLine(activities: { count: number; last: string | null; place?: string | null } | null | undefined, t: T, lang: Lang): string | null {
  if (!activities) return null;
  if (activities.count === 0) return t('confirm.noActivities');
  const at = activities.last ? Date.parse(activities.last) : NaN;
  if (!Number.isFinite(at)) return null;
  const date = formatDate(at, lang);
  return activities.place ? t('wizard.newestAt', { date, place: activities.place }) : t('wizard.newest', { date });
}

/** golf.de's account in the question: its handicap index as the page showed it (no name ever leaves golf.de's page). */
export function hcpWhoLine(index: { value: number; as_of: string } | null, t: T, lang: Lang): string {
  if (!index || !Number.isFinite(index.value)) return t('wizard.hcpNamed');
  const value = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(index.value);
  const day = Date.parse(`${index.as_of}T12:00:00`);
  return t('wizard.hcpIndex', { index: value, date: Number.isFinite(day) ? formatDate(day, lang) : index.as_of });
}

type Pairing = ClientStatus['pairings'][number];

/** A pairing whose first data is through: something was imported, or its plan answered (nothing was due). */
const through = (p: Pairing) => !!p.last_synced_at || p.last?.status === 'not_due' || p.last?.status === 'busy';

/**
 * A launch monitor client's state as the wizard's facts; null when there is nothing to set up: no app connected
 * (apps in test mode need no sign-in), or a connection that has brought data before and only needs a new sign-in
 * (the overview says "sign in again" - the wizard is for connecting, not for every week's renewal).
 */
export function factsOfStatus(s: Pick<ClientStatus, 'key' | 'pairings' | 'running'>, busy: ReadonlySet<string> = new Set()): WizardFacts | null {
  const real = s.pairings.filter((p) => !p.test);
  if (!real.length) return null;
  const done = real.some(through);
  const k = s.key.state;
  if (done && k !== 'ready' && k !== 'confirm') return null;
  const running = real.some((p) => busy.has(p.id) || s.running.includes(p.id));
  // The pairing that brought the most speaks for all: each gets the same account's data.
  const best = real.reduce((a, b) => ((b.brought?.sessions ?? 0) + (b.brought?.rounds ?? 0) > (a.brought?.sessions ?? 0) + (a.brought?.rounds ?? 0) ? b : a));
  const failed = !done && real.some((p) => p.last?.status === 'failed');
  return {
    kind: 'lm',
    signedIn: k === 'confirm' || k === 'ready',
    asking: k === 'confirm',
    confirmed: k === 'ready',
    first: done ? 'through' : running ? 'running' : failed ? 'failed' : 'waiting',
    brought: best.brought ? { sessions: best.brought.sessions, rounds: best.brought.rounds } : null,
    more: best.history?.done === true ? false : best.history?.done === false ? (typeof best.left === 'number' ? best.left : true) : null,
  };
}

/** The handicap record's state as the wizard's facts; null without a connection, or once established (as above). */
export function factsOfHcp(v: Pick<HcpView, 'pairings' | 'account' | 'sending'>): WizardFacts | null {
  if (!v.pairings.length) return null;
  const done = v.pairings.some((p) => p.last?.status === 'sent' || p.last?.status === 'not_due');
  if (done && v.account !== 'confirmed' && v.account !== 'asking') return null;
  const failed = !done && v.pairings.some((p) => p.last?.status === 'failed');
  const total = Math.max(0, ...v.pairings.map((p) => p.total ?? 0));
  return {
    kind: 'hcp',
    signedIn: v.account === 'asking' || v.account === 'confirmed',
    asking: v.account === 'asking',
    confirmed: v.account === 'confirmed',
    first: done ? 'through' : v.sending ? 'running' : failed ? 'failed' : 'waiting',
    brought: done || total ? { results: total } : null,
    more: null,
  };
}

/**
 * A new connection before its pairing stands (the extension's connect window, the web app's pairing page, the companion
 * app's pair link): `none` - no app has asked yet (the player starts in the app); `asking` - an app asks, waiting for
 * the yes; `allowed` - allowed, what to connect is next; `working` - pairing now.
 */
export function factsOfOffer(state: 'none' | 'asking' | 'allowed' | 'working', kind: ServiceKind): WizardFacts {
  return { kind, paired: state === 'allowed' || state === 'working', chosen: false, signedIn: false, asking: false, confirmed: false, first: 'waiting', brought: null, more: null };
}
