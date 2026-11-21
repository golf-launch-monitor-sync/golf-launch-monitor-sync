// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The status panel on a page - the extension's popup and the web app alike. Text goes in as text,
 * never as markup: names and messages come from targets and providers, which are untrusted.
 */

import { PORTAL_URL } from '@glmsync/provider-trackman/portal';
import type { ClientStatus, TestError, TestOutcome } from './client.ts';
import { formatDate, formatDateTime, formatTime, type Lang, type T } from './i18n.ts';
import { historyText, lastText, noticeText } from './view.ts';

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
}

export function renderStatus(root: HTMLElement, s: ClientStatus, c: RenderContext, a: Actions): void {
  const { t, lang, now } = c;
  const parts: Child[] = [];

  for (const f of s.ended) {
    const at = Date.parse(f.at);
    parts.push(
      h(
        'div',
        { class: 'note warn', 'data-test': 'ended' },
        t(f.why === 'disconnected' ? 'ended.disconnected' : 'ended.revoked', { name: f.name, date: Number.isFinite(at) ? formatDate(at, lang) : '' }),
        ' ',
        button(t('ended.ok'), a.clearEnded, { class: 'link' }),
      ),
    );
  }

  // A test code fetched: "Is this your account?" about its made-up account, before anything is synced.
  const ta = s.testAsking;
  if (ta) {
    const w = ta.who;
    const facts = w.activities
      ? w.activities.count === 0
        ? t('confirm.noActivities')
        : w.activities.last
          ? t('confirm.activities', { count: w.activities.count, date: formatDate(Date.parse(w.activities.last), lang) })
          : null
      : null;
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

  // The sign-in.
  const k = s.key;
  const key: Child[] = [h('h2', {}, t('key.title'))];
  if (k.state === 'confirm') {
    const w = k.who;
    const facts = w?.activities
      ? w.activities.count === 0
        ? t('confirm.noActivities')
        : w.activities.last
          ? t(w.activities.place ? 'confirm.activitiesAt' : 'confirm.activities', {
              count: w.activities.count,
              date: formatDate(Date.parse(w.activities.last), lang),
              place: w.activities.place ?? '',
            })
          : null
      : null;
    key.push(
      h(
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
              button(t('confirm.yes'), () => a.confirm(true), { class: 'primary', 'data-test': 'confirm-yes', ...(c.confirming ? { disabled: '' } : {}) }),
              button(t('confirm.no'), () => a.confirm(false), { 'data-test': 'confirm-no', ...(c.confirming ? { disabled: '' } : {}) }),
            )
          : h('div', { class: 'row' }, button(t('confirm.retry'), a.retryWho, { 'data-test': 'confirm-retry' }), button(t('confirm.no'), () => a.confirm(false))),
        c.confirming ? h('p', { class: 'muted', 'data-test': 'confirm-checking', role: 'status' }, t('confirm.checking')) : null,
      ),
    );
  } else if (k.state === 'ready') {
    if (c.confirmed) key.push(h('p', { class: 'note', 'data-test': 'confirmed', role: 'status' }, t('confirm.done')));
    key.push(h('p', { 'data-test': 'key-ready' }, t('key.ready', { date: formatDateTime(k.until, lang) })));
    key.push(h('div', { class: 'row' }, button(t('key.forget'), a.forgetKey, { class: 'link' })));
  } else {
    const [line, hint] =
      k.state === 'expired' ? (['key.expired', 'key.expiredHint'] as const) : k.state === 'other' ? (['key.other', 'key.otherHint'] as const) : (['key.none', 'key.noneHint'] as const);
    // The player said no to the account signed in to the portal here, or the target has another one: the way
    // to their own goes through Trackman's sign-out first (18 Nov: the portal opened with someone else's).
    const switching = c.client === 'extension' && !!a.switchAccount && (k.state === 'other' || (k.state === 'none' && s.rejected));
    key.push(h('p', { class: k.state === 'none' ? '' : 'note warn', 'data-test': `key-${k.state}` }, t(line)));
    if (switching && k.state === 'none') key.push(h('p', { class: 'note', 'data-test': 'rejected' }, t('confirm.rejected')));
    if (c.client === 'extension' || k.state === 'other') key.push(h('p', { class: 'muted' }, t(hint)));
    if (switching) {
      key.push(h('div', { class: 'row' }, button(t('key.switch'), () => a.switchAccount?.(), { class: 'primary', 'data-test': 'switch-account' }), button(t('key.openPortal'), a.openPortal, { 'data-test': 'open-portal' })));
      key.push(h('p', { class: 'muted small' }, t('key.switchHint')));
    } else if (c.client === 'extension') {
      key.push(h('div', { class: 'row' }, button(t('key.openPortal'), a.openPortal, { class: 'primary', 'data-test': 'open-portal' })));
    }
    if (k.state === 'other') key.push(h('div', { class: 'row' }, button(t('key.forget'), a.forgetKey, { class: 'link' })));
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
