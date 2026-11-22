// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The status panel on a page - the extension's popup and the web app alike. Text goes in as text,
 * never as markup: names and messages come from targets and providers, which are untrusted.
 */

import { PORTAL_URL } from '@glmsync/provider-trackman/portal';
import type { ClientStatus, TestError, TestOutcome } from './client.ts';
import type { HcpView } from './hcp.ts';
import { hcpLastText } from './hcpView.ts';
import { formatDate, formatDateTime, formatTime, type Lang, type T } from './i18n.ts';
import { historyText, lastText, noticeText } from './view.ts';
import { connectionLine, type Connection } from './connections.ts';
import { factsOfHcp, factsOfOffer, factsOfStatus, hcpWhoLine, targetOf, whoLine, wizardLines, wizardOf, type ServiceKind, type WizardFacts, type WizardLines, type WizardView } from './wizard.ts';

type Child = Node | string | null | undefined | false;

export function h(tag: string, attrs: Record<string, string> = {}, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Replace an element's children, leaving out the ones not there (null, false): never the text "null". */
export function fill(el: Element, ...children: Child[]): void {
  el.replaceChildren(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
}

export function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const b = h('button', { type: 'button', ...attrs }, label) as HTMLButtonElement;
  b.addEventListener('click', onClick);
  return b;
}

export interface Actions {
  confirm(yes: boolean): void;
  retryWho(): void;
  fetchNow(id: string): void;
  /** Ask first (`id`), or stop asking (null): the panel then shows the question in place. */
  askDisconnect(id: string | null): void;
  disconnect(id: string): void;
  exportLog(): void;
  clearEnded(): void;
  forgetKey(): void;
  /** Opens the provider's portal (a new tab). */
  openPortal(): void;
  /** Opens the provider's sign-out (a new tab), for signing in with another account. Extension only. */
  switchAccount?(): void;
  /** The tester's answer to "Is this your account?" for a test (spec/test-mode.md). */
  confirmTest(yes: boolean): void;
  /** Ask first (`id`), or stop asking (null), before a pairing's test ends. */
  askEndTest(id: string | null): void;
  endTest(id: string): void;
  /** The wizard's last step: back to the app (the extension's connect window closes its tab). None: a sentence says so. */
  back?(): void;
}

export interface RenderContext {
  t: T;
  lang: Lang;
  now: number;
  /** Pairings fetching right now (their button says so). */
  busy: ReadonlySet<string>;
  /** The extension finds the key by itself; the web app asks for it (its own section). */
  client: 'extension' | 'web';
  /** The pairing whose disconnecting is being asked about. */
  asking?: string | null;
  /** The player's answer to "Is this you?" is on its way (its buttons wait, it says so). */
  confirming?: boolean;
  /** The player just said yes: the panel says the connection stands and the data is on its way. */
  confirmed?: boolean;
  /** The pairing whose test ending is being asked about. */
  askingEnd?: string | null;
  /** The tester's answer to a test's "Is this your account?" is on its way. */
  testConfirming?: boolean;
  /**
   * Kept by the page across redraws: once it showed a step before "done" it shows "done" too (with the overview
   * below). Without it the page shows the overview as soon as the first data is through.
   */
  memory?: WizardMemory;
}

/** What a page remembers of the wizard while it is open. */
export interface WizardMemory {
  walked: boolean;
}

export function renderStatus(root: HTMLElement, s: ClientStatus, c: RenderContext, a: Actions): void {
  const { t, lang, now } = c;
  const parts: Child[] = [];

  parts.push(...endedNotes(s.ended, t, lang, a.clearEnded));

  // A test code fetched: "Is this your account?" about its made-up account, before anything is synced.
  const ta = s.testAsking;
  if (ta) {
    const w = ta.who;
    const facts = whoLine(w.activities, t, lang);
    const wait = c.testConfirming ? { disabled: '' } : {};
    parts.push(
      h(
        'div',
        { class: 'confirm test', 'data-test': 'test-confirm' },
        h('h3', {}, t('test.confirmTitle'), ' ', h('span', { class: 'badge' }, t('test.badge'))),
        h('p', { class: 'who' }, w.player ?? t('confirm.noName')),
        facts ? h('p', { class: 'muted' }, facts) : null,
        h('p', { class: 'muted' }, t('test.scenario', { name: ta.name, target: ta.target })),
        h('p', { class: 'muted small' }, t('test.notice', { target: ta.target })),
        h('p', { class: 'muted small' }, t('test.until', { date: formatDateTime(Date.parse(ta.valid_until), lang) })),
        h(
          'div',
          { class: 'row' },
          button(t('confirm.yes'), () => a.confirmTest(true), { class: 'primary', 'data-test': 'test-yes', ...wait }),
          button(t('confirm.no'), () => a.confirmTest(false), { 'data-test': 'test-no', ...wait }),
        ),
        c.testConfirming ? h('p', { class: 'muted', role: 'status' }, t('confirm.checking')) : null,
      ),
    );
  }

  // Connecting, as steps (wizard.ts): until the first data is through it stands in place of the overview - which
  // shows nothing that looks like data on its way before the yes. A page that walked the steps shows "done" with the
  // overview below; one opened afterwards just the overview.
  const facts = factsOfStatus(s, c.busy);
  const view = facts ? wizardOf(facts) : null;
  if (view && view.step !== 'done' && c.memory) c.memory.walked = true;
  const wizard = view && facts && (view.step !== 'done' || c.memory?.walked) ? { view, facts } : null;
  if (wizard) parts.push(statusWizard(s, wizard.view, wizard.facts, c, a));
  if (wizard && wizard.view.step !== 'done') {
    parts.push(h('p', { class: 'muted small unofficial' }, t('app.unofficial.trackman')));
    fill(root, ...parts);
    return;
  }

  // The sign-in.
  const k = s.key;
  const key: Child[] = [h('h2', {}, t('key.title'))];
  if (k.state === 'confirm') {
    key.push(confirmPart(s, c, a));
  } else if (k.state === 'ready') {
    if (c.confirmed) key.push(h('p', { class: 'note', 'data-test': 'confirmed', role: 'status' }, t('confirm.done')));
    key.push(h('p', { 'data-test': 'key-ready' }, t('key.ready', { date: formatDateTime(k.until, lang) })));
    key.push(h('div', { class: 'row' }, button(t('key.forget'), a.forgetKey, { class: 'link' })));
  } else {
    key.push(...signInPart(s, c, a));
  }
  parts.push(h('section', { class: 'key' }, ...key));

  // The targets.
  const targets: Child[] = [h('h2', {}, t('pairings.title'))];
  if (!s.pairings.length) targets.push(h('p', { class: 'muted', 'data-test': 'no-pairings' }, t('pairings.none')));
  for (const p of s.pairings) {
    const fetching = c.busy.has(p.id) || s.running.includes(p.id);
    const last = lastText(p, t, lang, now);
    const notice = p.last?.notice ? noticeText(p.last.notice, t, lang) : null;
    const history = historyText(p, t);
    targets.push(
      h(
        'div',
        { class: 'pairing', 'data-test': 'pairing', 'data-id': p.id },
        h('h3', {}, t('pairing.connected', { name: p.name }), ' ', h('span', { class: 'muted small' }, p.host)),
        h('p', { 'data-test': 'last' }, last ?? t('pairing.never')),
        notice ? h('p', { class: 'note warn', 'data-test': 'notice' }, notice) : null,
        p.other_account ? h('p', { class: 'note warn' }, t('last.other_account', { name: p.name })) : null,
        history ? h('p', { class: 'muted small', 'data-test': 'history' }, history) : null,
        p.test ? testCard(p.id, p.name, p.test, c, a) : null,
        c.asking === p.id
          ? h(
              'div',
              { class: 'note warn' },
              t('pairing.disconnectAsk', { name: p.name }),
              h(
                'div',
                { class: 'row' },
                button(t('pairing.disconnect'), () => a.disconnect(p.id), { class: 'primary', 'data-test': 'disconnect-yes' }),
                button(t('connect.cancel'), () => a.askDisconnect(null)),
              ),
            )
          : h(
              'div',
              { class: 'row' },
              button(fetching ? t('pairing.fetching') : t('pairing.fetchNow'), () => a.fetchNow(p.id), {
                class: 'primary',
                'data-test': 'fetch-now',
                // A pairing in test mode fetches from its scenario, with or without a sign-in.
                ...(fetching || (s.key.state !== 'ready' && !p.test) ? { disabled: '' } : {}),
              }),
              button(t('pairing.disconnect'), () => a.askDisconnect(p.id), { class: 'link', 'data-test': 'disconnect' }),
            ),
      ),
    );
  }
  parts.push(h('section', { class: 'targets' }, ...targets));

  // The guard.
  if (s.counts) {
    const g = s.counts;
    const blocked = g.blocked_until ? Date.parse(g.blocked_until) : NaN;
    parts.push(
      h(
        'section',
        { class: 'guard' },
        h('h2', {}, t('guard.title')),
        h('p', { 'data-test': 'counts' }, t('guard.counts', { hour: g.hour, perHour: g.limits.per_hour, day: g.day, perDay: g.limits.per_day })),
        Number.isFinite(blocked) ? h('p', { class: 'note' }, t('guard.blocked', { time: formatTime(blocked, lang) })) : null,
        h('p', { class: 'muted small' }, t('guard.why')),
        h('div', { class: 'row' }, button(t('guard.export'), a.exportLog, { class: 'link', 'data-test': 'export-log' })),
      ),
    );
  }

  parts.push(h('p', { class: 'muted small unofficial' }, t('app.unofficial.trackman')));
  fill(root, ...parts);
}

/** Connections an app ended since the player last looked: one line each, with *OK* (the overview and the list). */
export function endedNotes(ended: readonly { name: string; at: string; why: string }[], t: T, lang: Lang, ok: () => void): HTMLElement[] {
  return ended.map((f) => {
    const at = Date.parse(f.at);
    return h(
      'div',
      { class: 'note warn', 'data-test': 'ended' },
      t(f.why === 'disconnected' ? 'ended.disconnected' : 'ended.revoked', { name: f.name, date: Number.isFinite(at) ? formatDate(at, lang) : '' }),
      ' ',
      button(t('ended.ok'), ok, { class: 'link' }),
    );
  });
}

/**
 * Not signed in, run out, or another account than the app's: what to do (the overview's and the wizard's sign-in step).
 * In the wizard a first sign-in says one line and has one button; what went wrong (run out, another account, said no)
 * is said as in the overview.
 */
function signInPart(s: ClientStatus, c: RenderContext, a: Actions, inWizard = false): Child[] {
  const { t } = c;
  const k = s.key;
  const out: Child[] = [];
  if (inWizard && k.state === 'none' && !s.rejected) {
    // The web app puts its own key box (the bookmark) into the step.
    if (c.client === 'extension') out.push(h('p', { 'data-test': 'key-none' }, t('wizard.signinHow')), h('div', { class: 'row' }, button(t('key.openPortal'), a.openPortal, { class: 'primary', 'data-test': 'open-portal' })));
    return out;
  }
  const [line, hint] =
    k.state === 'expired' ? (['key.expired', 'key.expiredHint'] as const) : k.state === 'other' ? (['key.other', 'key.otherHint'] as const) : (['key.none', 'key.noneHint'] as const);
  // The player said no to the account signed in to the portal here, or the target has another one: the way
  // to their own goes through Trackman's sign-out first (18 Nov: the portal opened with someone else's).
  const switching = c.client === 'extension' && !!a.switchAccount && (k.state === 'other' || (k.state === 'none' && s.rejected));
  out.push(h('p', { class: k.state === 'none' ? '' : 'note warn', 'data-test': `key-${k.state}` }, t(line)));
  if (switching && k.state === 'none') out.push(h('p', { class: 'note', 'data-test': 'rejected' }, t('confirm.rejected')));
  if (c.client === 'extension' || k.state === 'other') out.push(h('p', { class: 'muted' }, t(hint)));
  if (switching) {
    out.push(h('div', { class: 'row' }, button(t('key.switch'), () => a.switchAccount?.(), { class: 'primary', 'data-test': 'switch-account' }), button(t('key.openPortal'), a.openPortal, { 'data-test': 'open-portal' })));
    out.push(h('p', { class: 'muted small' }, t('key.switchHint')));
  } else if (c.client === 'extension') {
    out.push(h('div', { class: 'row' }, button(t('key.openPortal'), a.openPortal, { class: 'primary', 'data-test': 'open-portal' })));
  }
  if (k.state === 'other') out.push(h('div', { class: 'row' }, button(t('key.forget'), a.forgetKey, { class: 'link' })));
  return out;
}

/** "Is this your Trackman account?": the name and the newest activity - no count, which read as data on its way. */
function confirmPart(s: ClientStatus, c: RenderContext, a: Actions): HTMLElement {
  const { t, lang } = c;
  const k = s.key;
  if (k.state !== 'confirm') return h('div', {});
  const w = k.who;
  const facts = w ? whoLine(w.activities, t, lang) : null;
  const wait = c.confirming ? { disabled: '' } : {};
  return h(
    'div',
    { class: 'confirm', 'data-test': 'confirm' },
    h('h3', {}, t('confirm.title')),
    w ? h('p', { class: 'who' }, w.player ?? t('confirm.noName')) : null,
    facts ? h('p', { class: 'muted' }, facts) : null,
    k.error ? h('p', { class: 'note warn' }, t(k.error === 'guard' ? 'confirm.guard' : 'confirm.unavailable')) : null,
    h('p', { class: 'muted small' }, t('confirm.why')),
    w
      ? h(
          'div',
          { class: 'row' },
          button(t('confirm.yes'), () => a.confirm(true), { class: 'primary', 'data-test': 'confirm-yes', ...wait }),
          button(t('confirm.no'), () => a.confirm(false), { 'data-test': 'confirm-no', ...wait }),
        )
      : h('div', { class: 'row' }, button(t('confirm.retry'), a.retryWho, { 'data-test': 'confirm-retry' }), button(t('confirm.no'), () => a.confirm(false))),
    c.confirming ? h('p', { class: 'muted', 'data-test': 'confirm-checking', role: 'status' }, t('confirm.checking')) : null,
  );
}

/** The launch monitor's steps: each step's own content inside the shared frame. */
function statusWizard(s: ClientStatus, view: WizardView, facts: WizardFacts, c: RenderContext, a: Actions): HTMLElement {
  const { t, lang, now } = c;
  const real = s.pairings.filter((p) => !p.test);
  const target = targetOf(real.map((p) => p.name));
  const lines = wizardLines(view, facts, t, { service: s.provider.name, target });
  const body: Child[] = [];
  if (view.step === 'signin') body.push(...signInPart(s, c, a, true));
  else if (view.step === 'account') {
    const confirm = confirmPart(s, c, a);
    // The frame's title asks already.
    confirm.querySelector('h3')?.remove();
    body.push(confirm);
  } else if (view.step === 'load') {
    if (facts.first === 'failed') {
      const p = real.find((x) => x.last?.status === 'failed') ?? real[0];
      const fetching = !!p && (c.busy.has(p.id) || s.running.includes(p.id));
      if (p) {
        body.push(h('p', { class: 'note warn', 'data-test': 'wizard-failed' }, lastText(p, t, lang, now) ?? ''));
        body.push(h('div', { class: 'row' }, button(fetching ? t('pairing.fetching') : t('pairing.fetchNow'), () => a.fetchNow(p.id), { class: 'primary', 'data-test': 'fetch-now', ...(fetching ? { disabled: '' } : {}) })));
      }
    }
  }
  body.push(...progressLines(lines));
  if (view.step === 'done') body.push(...backPart(t, target, a.back, c.client === 'web'));
  else body.push(...cancelPart(real, target, c, a));
  return wizardFrame(view, lines, body, facts.first !== 'failed');
}

/** The frame every service's steps share: the big line before the yes, the steps, where it stands, the step's title. */
export function wizardFrame(view: WizardView, lines: WizardLines, body: Child[], spinning = true, busy = false): HTMLElement {
  const spin = busy || (view.step === 'load' && spinning);
  return h(
    'section',
    { class: 'wizard', 'data-test': 'wizard', 'data-step': view.step },
    lines.unconfirmed ? h('p', { class: 'banner', 'data-test': 'unconfirmed', role: 'status' }, lines.unconfirmed) : null,
    h('ol', { class: 'steps' }, ...view.steps.map((st, i) => h('li', { class: st.state, ...(st.state === 'current' ? { 'aria-current': 'step' } : {}) }, lines.labels[i] ?? ''))),
    h('p', { class: 'muted small', 'data-test': 'wizard-progress' }, lines.progress),
    h('h3', { 'data-test': 'wizard-title', ...(spin ? { class: 'spin', role: 'status' } : {}) }, lines.title),
    ...body,
  );
}

/** Steps 3 and 4: what came, and what is still to come. */
export function progressLines(lines: WizardLines): Child[] {
  return [
    lines.brought ? h('p', { class: 'brought', 'data-test': 'wizard-brought' }, lines.brought) : null,
    lines.more ? h('p', { class: 'muted', 'data-test': 'wizard-more' }, lines.more) : null,
  ];
}

/** Step 4: back to the app - a button where this page can take the player there, else the sentence that they can. */
export function backPart(t: T, target: string | null, back: (() => void) | undefined, web = false): Child[] {
  const name = target ?? t('wizard.yourApp');
  return [
    back ? h('div', { class: 'row' }, button(t('wizard.back', { target: name }), back, { class: 'primary', 'data-test': 'wizard-back' })) : null,
    h('p', { class: 'muted', 'data-test': 'wizard-back-hint' }, t(web ? 'wizard.backHintWeb' : 'wizard.backHint', { target: name })),
  ];
}

/** Steps 1 to 3: a way out (with one app; with several the overview's own buttons do it). */
function cancelPart(real: ClientStatus['pairings'], target: string | null, c: RenderContext, a: Actions): Child[] {
  const { t } = c;
  const only = real.length === 1 ? real[0] : null;
  if (!only || !target) return [];
  if (c.asking === only.id) {
    return [
      h(
        'div',
        { class: 'note warn' },
        t('pairing.disconnectAsk', { name: only.name }),
        h('div', { class: 'row' }, button(t('pairing.disconnect'), () => a.disconnect(only.id), { class: 'primary', 'data-test': 'disconnect-yes' }), button(t('connect.cancel'), () => a.askDisconnect(null))),
      ),
    ];
  }
  return [h('div', { class: 'row' }, button(t('wizard.cancel', { target }), () => a.askDisconnect(only.id), { class: 'link', 'data-test': 'disconnect' }))];
}

export interface HcpWizardActions {
  openGolfde(): void;
  confirm(yes: boolean): void;
  send(): void;
  askDisconnect(id: string | null): void;
  disconnect(id: string): void;
  back?(): void;
}

export interface HcpWizardContext {
  t: T;
  lang: Lang;
  now: number;
  memory?: WizardMemory;
  /** The pairing whose disconnecting is being asked about. */
  asking?: string | null;
  /** The answer to "Is this your golf.de account?" is on its way. */
  confirming?: boolean;
}

/**
 * The handicap record's steps (golf.de), in the same frame as a launch monitor's; null when there is nothing to set up
 * (or the first data is through and this page didn't walk the steps).
 */
export function hcpWizard(v: HcpView, c: HcpWizardContext, a: HcpWizardActions): { el: HTMLElement; done: boolean } | null {
  const { t, lang, now } = c;
  const facts = factsOfHcp(v);
  if (!facts) return null;
  const view = wizardOf(facts);
  if (view.step !== 'done' && c.memory) c.memory.walked = true;
  if (view.step === 'done' && !c.memory?.walked) return null;
  const target = targetOf(v.pairings.map((p) => p.name));
  const lines = wizardLines(view, facts, t, { service: 'golf.de', target });
  const open = (primary: boolean) => button(t('connect.openHcp'), a.openGolfde, { ...(primary ? { class: 'primary' } : {}), 'data-test': 'hcp-open' });
  const body: Child[] = [];
  if (view.step === 'signin') {
    if (v.account === 'rejected') body.push(h('p', { class: 'note warn', 'data-test': 'hcp-rejected' }, t('wizard.hcpRejected')));
    else if (v.signed_out) body.push(h('p', { class: 'note' }, t('hcp.signedOut')));
    else if (v.waiting) body.push(h('p', { class: 'note' }, t('hcp.waiting')));
    body.push(h('p', {}, t('connect.nextHcp')), h('div', { class: 'row' }, open(true)));
  } else if (view.step === 'account') {
    const wait = c.confirming ? { disabled: '' } : {};
    body.push(
      h(
        'div',
        { class: 'confirm', 'data-test': 'hcp-confirm' },
        h('p', { class: 'who' }, hcpWhoLine(v.index, t, lang)),
        h('p', { class: 'muted small' }, t('wizard.hcpWhy')),
        h(
          'div',
          { class: 'row' },
          button(t('confirm.yes'), () => a.confirm(true), { class: 'primary', 'data-test': 'hcp-confirm-yes', ...wait }),
          button(t('confirm.no'), () => a.confirm(false), { 'data-test': 'hcp-confirm-no', ...wait }),
        ),
        c.confirming ? h('p', { class: 'muted', role: 'status' }, t('confirm.checking')) : null,
      ),
    );
  } else if (view.step === 'load') {
    const failed = v.pairings.find((p) => p.last?.status === 'failed');
    if (facts.first === 'failed' && failed) body.push(h('p', { class: 'note warn', 'data-test': 'wizard-failed' }, hcpLastText(failed, t, lang, now) ?? ''));
    else if (facts.first === 'waiting') body.push(h('p', {}, t('wizard.hcpWaiting', { target: target ?? t('wizard.yourApp') })));
    body.push(
      h(
        'div',
        { class: 'row' },
        facts.first === 'running' ? null : open(!v.fresh),
        v.fresh && facts.first !== 'running' ? button(t('hcp.send'), a.send, { class: 'primary', 'data-test': 'hcp-send' }) : null,
      ),
    );
  }
  body.push(...progressLines(lines));
  if (view.step === 'done') body.push(...backPart(t, target, a.back));
  else {
    const only = v.pairings.length === 1 ? v.pairings[0] : null;
    if (only && target) {
      body.push(
        c.asking === only.id
          ? h(
              'div',
              { class: 'note warn' },
              t('hcp.disconnectAsk', { name: only.name }),
              h('div', { class: 'row' }, button(t('hcp.disconnect'), () => a.disconnect(only.id), { class: 'primary', 'data-test': 'hcp-disconnect-yes' }), button(t('connect.cancel'), () => a.askDisconnect(null))),
            )
          : h('div', { class: 'row' }, button(t('wizard.cancel', { target }), () => a.askDisconnect(only.id), { class: 'link', 'data-test': 'hcp-disconnect' })),
      );
    }
  }
  // Waiting for pages to be opened isn't "running": the spinner only while something is sent.
  return { el: wizardFrame(view, lines, body, facts.first === 'running'), done: view.step === 'done' };
}

export interface OfferContext {
  t: T;
  /** `none`: no app asked yet; `asking`: waiting for the yes; `allowed`: what to connect is next; `working`: pairing. */
  state: 'none' | 'asking' | 'allowed' | 'working';
  kind: ServiceKind;
  /** The asking app's address (shown plainly: any page can ask). */
  host?: string;
  /** What can be connected for this kind (the offer may name one). */
  services: readonly { id: string; name: string }[];
  /** What went wrong with the last request (a code run out, the permission refused …), said on its step. */
  error?: string | null;
  /** The yes in this client's words (the web app: *Connect this page with …*). */
  allowLabel?: string;
}

export interface OfferActions {
  allow(): void;
  cancel(): void;
  choose(id: string): void;
}

/**
 * A new connection's first two steps, in the same frame as the rest: an app asks and the player allows it (or, with no
 * app asking yet, where to start), then what to connect. One button each.
 */
export function offerWizard(c: OfferContext, a: OfferActions): HTMLElement {
  const { t } = c;
  const facts = factsOfOffer(c.state, c.kind);
  const view = wizardOf(facts);
  const target = c.state === 'none' ? null : (c.host ?? null);
  const lines = wizardLines(view, facts, t, { service: c.services[0]?.name ?? '', target });
  const body: Child[] = [];
  if (c.error) body.push(h('p', { class: 'note warn', 'data-test': 'offer-error', role: 'alert' }, c.error));
  if (c.state === 'none') body.push(h('p', { 'data-test': 'offer-start' }, t('wizard.pairStartHow')));
  else if (c.state === 'asking') {
    body.push(
      h('p', { 'data-test': 'offer-what' }, t('wizard.pairWhat', { host: c.host ?? '' })),
      h('div', { class: 'row' }, button(c.allowLabel ?? t('wizard.allow'), a.allow, { class: 'primary', 'data-test': 'allow' }), button(t('connect.cancel'), a.cancel, { class: 'link', 'data-test': 'cancel' })),
    );
  } else {
    const working = c.state === 'working';
    body.push(
      h('p', { class: 'muted small' }, t(c.kind === 'hcp' ? 'wizard.serviceHcp' : 'wizard.serviceLm')),
      h('div', { class: 'row services' }, ...c.services.map((x) => button(x.name, () => a.choose(x.id), { class: 'primary', 'data-test': `service-${x.id}`, ...(working ? { disabled: '' } : {}) }))),
      c.kind === 'lm' ? h('p', { class: 'muted small' }, t('wizard.serviceMore')) : null,
      working ? h('p', { class: 'muted', role: 'status', 'data-test': 'working' }, t('connect.working')) : h('div', { class: 'row' }, button(t('connect.cancel'), a.cancel, { class: 'link', 'data-test': 'cancel' })),
    );
  }
  return wizardFrame(view, lines, body, true, c.state === 'working');
}

/** The main view: *Connect new* and the list of connections, each a row that opens its details. */
export function renderConnections(root: HTMLElement, list: readonly Connection[], c: { t: T }, a: { add(): void; open(id: string): void }): void {
  const { t } = c;
  const row = (x: Connection) => {
    const l = connectionLine(x, t);
    const b = h(
      'button',
      { type: 'button', class: 'connection', 'data-test': 'connection', 'data-id': x.id, 'data-state': x.state },
      h('span', { class: 'title' }, l.title),
      h('span', { class: 'muted small' }, l.targets),
      h('span', { class: `state ${l.tone}`, 'data-test': 'connection-state' }, l.state),
    );
    b.addEventListener('click', () => a.open(x.id));
    return h('li', {}, b);
  };
  fill(
    root,
    h(
      'section',
      { class: 'connections', 'data-test': 'connections' },
      h('div', { class: 'row' }, button(t('connections.new'), a.add, { class: 'primary', 'data-test': 'connect-new' })),
      h('h2', {}, t('connections.title')),
      list.length ? h('ul', { class: 'list' }, ...list.map(row)) : h('p', { class: 'muted', 'data-test': 'connections-none' }, t('connections.none')),
    ),
  );
}

/** Back from a connection's details (or from *Connect new*) to the list. */
export function backLink(t: T, onBack: () => void): HTMLElement {
  return h('div', { class: 'row back' }, button(`‹ ${t('connections.back')}`, onBack, { class: 'link', 'data-test': 'connections-back' }));
}

/** A pairing's test while it lasts: the badge, whose made-up account, until when, its own guard counts, the way out. */
function testCard(id: string, target: string, test: NonNullable<ClientStatus['pairings'][number]['test']>, c: RenderContext, a: Actions): HTMLElement {
  const { t, lang } = c;
  const g = test.counts;
  return h(
    'div',
    { class: 'note test', 'data-test': 'test-card' },
    h('p', {}, h('span', { class: 'badge' }, t('test.badge')), ' ', t('test.scenario', { name: test.name, target })),
    h('p', {}, t('test.active', { player: test.player ?? t('confirm.noName'), date: formatDateTime(test.at, lang) })),
    h('p', { class: 'muted small' }, t('test.notice', { target })),
    h('p', { class: 'muted small' }, t('test.until', { date: formatDateTime(Date.parse(test.valid_until), lang) })),
    g ? h('p', { class: 'muted small', 'data-test': 'test-counts' }, t('guard.counts', { hour: g.hour, perHour: g.limits.per_hour, day: g.day, perDay: g.limits.per_day })) : null,
    c.askingEnd === id
      ? h(
          'div',
          {},
          h('p', {}, t('test.endAsk', { target })),
          h('div', { class: 'row' }, button(t('test.end'), () => a.endTest(id), { class: 'primary', 'data-test': 'test-end-yes' }), button(t('connect.cancel'), () => a.askEndTest(null))),
        )
      : h('div', { class: 'row' }, button(t('test.end'), () => a.askEndTest(id), { 'data-test': 'test-end' })),
  );
}

/**
 * *Enter a test code* at the bottom of a page (spec/test-mode.md): kept apart from the status panel, which is drawn
 * afresh every few seconds - typing must survive that. It redraws only when what it shows changes.
 */
export function testEntry(
  root: HTMLElement,
  t: T,
  fetchTest: (typed: string, id: string | undefined) => Promise<TestOutcome>,
): { update(s: ClientStatus): void; fail(e: TestError): void } {
  let open = false;
  let busy = false;
  let error: string | null = null;
  let chosen: string | null = null;
  let last: ClientStatus | null = null;
  let drawn = '';
  const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', maxlength: '2048', 'data-test': 'test-code', 'aria-label': t('test.codeLabel'), placeholder: t('test.codeLabel') }) as HTMLInputElement;

  const go = async () => {
    const s = last;
    if (!s || busy) return;
    const id = chosen ?? (s.pairings.length === 1 ? s.pairings[0]?.id : undefined);
    busy = true;
    error = null;
    draw(true);
    let out: TestOutcome;
    try {
      out = await fetchTest(input.value, id);
    } catch {
      out = { ok: false, error: 'unreachable' };
    }
    busy = false;
    if (out.ok) {
      open = false;
      input.value = '';
    } else error = t(`test.error.${out.error}`);
    draw(true);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void go();
  });

  function draw(force = false): void {
    const s = last;
    if (!s) return;
    const sig = JSON.stringify([open, busy, error, chosen, !!s.testAsking, s.pairings.map((p) => [p.id, p.name])]);
    if (!force && sig === drawn) return;
    drawn = sig;
    // While a test's question is open, it is answered in the panel first.
    if (s.testAsking) {
      fill(root);
      return;
    }
    if (!open) {
      const enter = () => {
        open = true;
        draw(true);
        input.focus();
      };
      fill(root, h('div', { class: 'row test-entry' }, button(t('test.enter'), enter, { class: 'link', 'data-test': 'test-enter' })));
      return;
    }
    const several = s.pairings.length > 1;
    const pick = (id: string) => () => {
      chosen = id;
      draw(true);
    };
    const cancel = () => {
      open = false;
      error = null;
      draw(true);
    };
    fill(
      root,
      h(
        'section',
        { class: 'test-entry', 'data-test': 'test-entry' },
        h('h2', {}, t('test.title')),
        h('p', { class: 'muted small' }, t('test.what')),
        s.pairings.length ? h('p', {}, input) : h('p', { class: 'note warn', 'data-test': 'test-error' }, t('test.error.unpaired')),
        several
          ? h(
              'div',
              {},
              h('p', { class: 'small' }, t('test.forWhich')),
              h('div', { class: 'row' }, ...s.pairings.map((p) => button(p.name, pick(p.id), { class: chosen === p.id ? 'primary' : '', 'data-test': 'test-for' }))),
            )
          : null,
        error ? h('p', { class: 'note warn', 'data-test': 'test-error', role: 'alert' }, error) : null,
        h(
          'div',
          { class: 'row' },
          s.pairings.length
            ? button(busy ? t('test.fetching') : t('test.fetch'), () => void go(), { class: 'primary', 'data-test': 'test-fetch', ...(busy || (several && !chosen) ? { disabled: '' } : {}) })
            : null,
          button(t('connect.cancel'), cancel, { class: 'link', 'data-test': 'test-cancel' }),
        ),
      ),
    );
  }

  return {
    update(s: ClientStatus) {
      last = s;
      if (chosen && !s.pairings.some((p) => p.id === chosen)) chosen = null;
      draw();
    },
    /** What went wrong after the question (the yes couldn't start the test): said where the code was typed. */
    fail(e: TestError) {
      open = true;
      error = t(`test.error.${e}`);
      draw(true);
    },
  };
}

export { PORTAL_URL };
