// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The status panel on a page - the extension's popup and the web app alike. Text goes in as text,
 * never as markup: names and messages come from targets and providers, which are untrusted.
 */

import { PORTAL_URL } from '@glmsync/provider-trackman/portal';
import type { ClientStatus } from './client.ts';
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
          ? h('div', { class: 'row' }, button(t('confirm.yes'), () => a.confirm(true), { class: 'primary', 'data-test': 'confirm-yes' }), button(t('confirm.no'), () => a.confirm(false), { 'data-test': 'confirm-no' }))
          : h('div', { class: 'row' }, button(t('confirm.retry'), a.retryWho, { 'data-test': 'confirm-retry' }), button(t('confirm.no'), () => a.confirm(false))),
      ),
    );
  } else if (k.state === 'ready') {
    key.push(h('p', { 'data-test': 'key-ready' }, t('key.ready', { date: formatDateTime(k.until, lang) })));
    key.push(h('div', { class: 'row' }, button(t('key.forget'), a.forgetKey, { class: 'link' })));
  } else {
    const [line, hint] =
      k.state === 'expired' ? (['key.expired', 'key.expiredHint'] as const) : k.state === 'other' ? (['key.other', 'key.otherHint'] as const) : (['key.none', 'key.noneHint'] as const);
    key.push(h('p', { class: k.state === 'none' ? '' : 'note warn', 'data-test': `key-${k.state}` }, t(line)));
    if (c.client === 'extension' || k.state === 'other') key.push(h('p', { class: 'muted' }, t(hint)));
    if (c.client === 'extension') key.push(h('div', { class: 'row' }, button(t('key.openPortal'), a.openPortal, { class: 'primary', 'data-test': 'open-portal' })));
    if (k.state === 'other') key.push(h('div', { class: 'row' }, button(t('key.forget'), a.forgetKey, { class: 'link' })));
  }
  parts.push(h('section', { class: 'key' }, ...key));

  // The targets.
  const targets: Child[] = [h('h2', {}, t('pairings.title'))];
  if (!s.pairings.length) targets.push(h('p', { class: 'muted', 'data-test': 'no-pairings' }, t('pairings.none')));
  for (const p of s.pairings) {
    const fetching = c.busy.has(p.id);
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
                ...(fetching || s.key.state !== 'ready' ? { disabled: '' } : {}),
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

export { PORTAL_URL };
