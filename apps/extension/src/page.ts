// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** What the popup and the connect window share: talking to the background, and the panels (launch monitor, golf.de, world ranking). */

import { formatDate, hcpLastText, pickLang, translator, type ClientStatus, type HcpView, type Lang, type ProView, type T } from '@glmsync/browser';
import { download, logName } from '@glmsync/browser/download';
import { button, fill, h, hcpWizard, proDetails, renderStatus, testEntry, type Actions, type WizardMemory } from '@glmsync/browser/render';
import type { FromPage, Reply } from './messages.ts';

export const lang: Lang = pickLang(navigator.languages);
export const t: T = translator(lang);

export async function send(m: FromPage): Promise<Reply> {
  try {
    const r = (await chrome.runtime.sendMessage(m)) as Reply | undefined;
    return r ?? { ok: false, error: 'no answer' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The page's title and header in the browser's language. */
export function heading(key: Parameters<T>[0]): void {
  document.documentElement.lang = lang;
  document.title = t(key);
  const h1 = document.querySelector('h1');
  if (h1) h1.textContent = t(key);
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]')) el.textContent = t(el.dataset.t as Parameters<T>[0]);
}

/**
 * The status panel, kept current: it re-reads every few seconds while the page is open. `onStatus` hears
 * every status it shows (the connect window says "done" from it). Until the first data is through it shows connecting
 * as steps (the wizard); `back` is its last step's button.
 */
export function statusPanel(root: HTMLElement, opts: { onPortal?: () => void; onStatus?: (s: ClientStatus) => void; back?: () => void; memory?: WizardMemory } = {}) {
  const memory: WizardMemory = opts.memory ?? { walked: false };
  const busy = new Set<string>();
  let asking: string | null = null;
  let confirming = false;
  let confirmed = false;
  let askingEnd: string | null = null;
  let testConfirming = false;
  let updating: 'checking' | 'failed' | null = null;
  let last: ClientStatus | null = null;
  // *Enter a test code* (test mode): drawn apart, so typing survives the panel's redraws; the panel puts it under the
  // sign-in.
  const entryRoot = document.createElement('div');
  const entry = testEntry(entryRoot, t, async (code, id) => {
    const r = await send(id ? { type: 'test-fetch', code, id } : { type: 'test-fetch', code });
    if (r.ok && r.status) draw(r.status);
    return r.ok && r.test ? r.test : { ok: false, error: 'unreachable' };
  });

  const draw = (s: ClientStatus) => {
    last = s;
    // "Connected, the data is on its way" while the first sync after the yes runs.
    if (confirmed && s.key.state === 'ready' && !s.running.length && s.pairings.some((p) => p.last)) confirmed = false;
    renderStatus(root, s, { t, lang, now: Date.now(), busy, client: 'extension', asking, confirming, confirmed, askingEnd, testConfirming, memory, testSlot: entryRoot, updating }, actions);
    entry.update(s);
    opts.onStatus?.(s);
  };
  const refresh = async (got?: Reply) => {
    const r = got ?? (await send({ type: 'status' }));
    if (r.ok && r.status) draw(r.status);
  };
  const actions: Actions = {
    confirm: (yes) => {
      // The answer may take a moment (the extension saves it, then starts the first sync): say so at once.
      confirming = true;
      if (last) draw(last);
      void send({ type: 'confirm', yes }).then(async (r) => {
        confirming = false;
        confirmed = yes && r.ok && r.status?.key.state === 'ready';
        await refresh(r);
        if (!r.ok && last) draw(last);
      });
    },
    retryWho: () => void send({ type: 'retry-who' }).then(refresh),
    fetchNow: (id) => {
      busy.add(id);
      if (last) draw(last);
      void send({ type: 'run', id }).then(async (r) => {
        busy.delete(id);
        await refresh(r);
      });
    },
    askDisconnect: (id) => {
      asking = id;
      if (last) draw(last);
    },
    disconnect: (id) => {
      asking = null;
      void send({ type: 'unpair', id }).then(refresh);
    },
    exportLog: () =>
      void send({ type: 'export-log' }).then((r) => {
        if (r.ok && r.log) download(logName(Date.now()), `${JSON.stringify(r.log, null, 2)}\n`);
      }),
    clearEnded: () => void send({ type: 'clear-ended' }).then(refresh),
    forgetKey: () => void send({ type: 'forget-key' }).then(refresh),
    openPortal: () => {
      void send({ type: 'open-portal' });
      opts.onPortal?.();
    },
    switchAccount: () => {
      void send({ type: 'switch-account' });
      opts.onPortal?.();
    },
    confirmTest: (yes) => {
      testConfirming = true;
      if (last) draw(last);
      void send({ type: 'test-confirm', yes }).then(async (r) => {
        testConfirming = false;
        await refresh(r);
        if (!r.ok && last) draw(last);
        if (yes && (!r.ok || (r.test && !r.test.ok))) entry.fail(r.ok && r.test && !r.test.ok ? r.test.error : 'not_kept');
      });
    },
    askEndTest: (id) => {
      askingEnd = id;
      if (last) draw(last);
    },
    endTest: (id) => {
      askingEnd = null;
      void send({ type: 'test-end', id }).then(refresh);
    },
    ...(opts.back ? { back: opts.back } : {}),
    update: () => {
      updating = 'checking';
      if (last) draw(last);
      void send({ type: 'update' }).then((r) => {
        // Reloading ends this page with the extension; a store page opened beside it is where the player goes on.
        updating = r.ok && r.update !== 'failed' ? null : 'failed';
        if (r.ok && r.update === 'page') opts.onPortal?.();
        if (last) draw(last);
      });
    },
  };
  void refresh();
  const timer = setInterval(() => void refresh(), 3000);
  return { refresh, stop: () => clearInterval(timer) };
}

/**
 * The handicap record's part of the popup (spec/hcp.md): only once an app is paired for it. Its apps (each to
 * disconnect, asked first), what was seen on golf.de and what is new, *Send now*, whether it sends by itself, and the
 * way to golf.de's History Sheet. Text goes in as text: names come from targets.
 */
export function hcpPanel(root: HTMLElement, opts: { onGolfde?: () => void; back?: () => void; onView?: (v: HcpView) => void } = {}) {
  let asking: string | null = null;
  let confirming = false;
  let last: HcpView | null = null;
  const memory: WizardMemory = { walked: false };

  const draw = (v: HcpView) => {
    last = v;
    opts.onView?.(v);
    if (!v.pairings.length && !v.ended.length) {
      fill(root);
      return;
    }
    const now = Date.now();
    // Connecting as steps until the first results went out; nothing that looks like data on its way before the yes.
    const wizard = hcpWizard(v, { t, lang, now, memory, asking, confirming }, {
      openGolfde: () => {
        void send({ type: 'open-golfde' });
        opts.onGolfde?.();
      },
      confirm: (yes) => {
        confirming = true;
        draw(v);
        void send({ type: 'hcp-confirm', yes }).then((r) => {
          confirming = false;
          if (r.ok && r.hcp) draw(r.hcp);
          else if (last) draw(last);
        });
      },
      send: () => void send({ type: 'hcp-send' }).then(apply),
      askDisconnect: (id) => {
        asking = id;
        if (last) draw(last);
      },
      disconnect: (id) => {
        asking = null;
        void send({ type: 'hcp-unpair', id }).then(apply);
      },
      ...(opts.back ? { back: opts.back } : {}),
    });
    if (wizard && !wizard.done) {
      fill(root, h('h2', {}, t('hcp.title')), wizard.el);
      return;
    }
    const pairings = v.pairings.map((p) =>
      h('div', { class: 'pairing', 'data-test': 'hcp-pairing' },
        h('p', {}, h('strong', {}, t('hcp.connected', { name: p.name })), ` · ${p.host}`),
        p.other_account ? h('p', { class: 'note warn' }, t('hcp.other', { name: p.name })) : null,
        (() => {
          const line = hcpLastText(p, t, lang, now);
          return line ? h('p', { class: 'muted small' }, line) : null;
        })(),
        asking === p.id
          ? h('div', { class: 'note' }, h('p', {}, t('hcp.disconnectAsk', { name: p.name })),
              h('div', { class: 'row' },
                button(t('hcp.disconnect'), () => {
                  asking = null;
                  void send({ type: 'hcp-unpair', id: p.id }).then(apply);
                }, { class: 'primary', 'data-test': 'hcp-disconnect-yes' }),
                button(t('connect.cancel'), () => {
                  asking = null;
                  if (last) draw(last);
                })))
          : h('div', { class: 'row' }, button(t('hcp.disconnect'), () => {
              asking = p.id;
              if (last) draw(last);
            }, { 'data-test': 'hcp-disconnect' })),
      ),
    );
    const auto = h('input', { type: 'checkbox', id: 'hcp-auto', 'data-test': 'hcp-auto' }) as HTMLInputElement;
    auto.checked = v.auto;
    auto.addEventListener('change', () => void send({ type: 'hcp-auto', auto: auto.checked }).then(apply));
    const autoFetch = h('input', { type: 'checkbox', id: 'hcp-auto-fetch', 'data-test': 'hcp-auto-fetch' }) as HTMLInputElement;
    autoFetch.checked = v.auto_fetch;
    autoFetch.addEventListener('change', () => void send({ type: 'hcp-auto-fetch', on: autoFetch.checked }).then(apply));
    const notes = [
      v.waiting ? t('hcp.waiting') : null,
      v.signed_out ? t('hcp.signedOut') : null,
      v.changed_page ? t('hcp.changed') : null,
    ].filter((x): x is string => !!x);
    fill(root,
      h('h2', {}, t('hcp.title')),
      wizard ? wizard.el : null,
      ...v.ended.map((e) => h('p', { class: 'note warn' }, t(e.why === 'revoked' ? 'ended.revoked' : 'ended.disconnected', { name: e.name, date: formatDate(Date.parse(e.at), lang) }))),
      v.ended.length ? h('div', { class: 'row' }, button(t('ended.ok'), () => void send({ type: 'hcp-clear-ended' }).then(apply))) : null,
      ...pairings,
      v.pairings.length ? h('p', { 'data-test': 'hcp-seen' }, v.seen ? t('hcp.seen', { seen: v.seen, fresh: v.fresh }) : t('hcp.seenNone')) : null,
      ...notes.map((n) => h('p', { class: 'note' }, n)),
      v.pairings.length ? h('p', { class: 'muted small' }, t('hcp.how')) : null,
      v.pairings.length
        ? h('div', { class: 'row' },
            button(t('hcp.open'), () => {
              void send({ type: 'open-golfde' });
              opts.onGolfde?.();
            }, { 'data-test': 'hcp-open' }),
            v.fresh ? button(v.sending ? t('hcp.sending') : t('hcp.send'), () => void send({ type: 'hcp-send' }).then(apply), { class: 'primary', 'data-test': 'hcp-send' }) : null)
        : null,
      v.pairings.length ? h('p', { class: 'small' }, h('label', { for: 'hcp-auto' }, auto, ` ${t('hcp.auto')}`)) : null,
      v.pairings.length ? h('p', { class: 'small' }, h('label', { for: 'hcp-auto-fetch' }, autoFetch, ` ${t('hcp.autoFetch')}`)) : null,
    );
  };
  const apply = (r: Reply) => {
    if (r.ok && r.hcp) draw(r.hcp);
  };
  const refresh = async () => apply(await send({ type: 'hcp-status' }));
  void refresh();
  const timer = setInterval(() => void refresh(), 3000);
  return { refresh, stop: () => clearInterval(timer) };
}

/**
 * A pro's world ranking pages (spec/prores.md): where to open them, the question whether a page is the player's (asked
 * here, never on the site's page), each connected app with its last answer. Nothing while no app is connected for it.
 */
export function proPanel(root: HTMLElement, opts: { onOpen?: () => void; back?: () => void; onView?: (v: ProView) => void } = {}) {
  let asking: string | null = null;
  let answering = false;
  let last: ProView | null = null;
  const draw = (v: ProView) => {
    last = v;
    opts.onView?.(v);
    if (!v.pairings.length && !v.ended.length) {
      fill(root);
      return;
    }
    fill(
      root,
      ...v.ended.map((e) => h('p', { class: 'note warn' }, t(e.why === 'revoked' ? 'ended.revoked' : 'ended.disconnected', { name: e.name, date: formatDate(Date.parse(e.at), lang) }))),
      v.ended.length ? h('div', { class: 'row' }, button(t('ended.ok'), () => void send({ type: 'pro-clear-ended' }).then(apply))) : null,
      v.pairings.length
        ? proDetails(v, { t, lang, now: Date.now(), asking, answering }, {
            open: (site) => {
              void send({ type: 'open-ranking', site });
              opts.onOpen?.();
            },
            answer: (yes) => {
              answering = true;
              draw(v);
              void send({ type: 'pro-answer', yes }).then((r) => {
                answering = false;
                if (r.ok && r.pro) draw(r.pro);
                else if (last) draw(last);
              });
            },
            askDisconnect: (id) => {
              asking = id;
              if (last) draw(last);
            },
            disconnect: (id) => {
              asking = null;
              void send({ type: 'pro-unpair', id }).then(apply);
            },
          })
        : null,
      opts.back && v.pairings.length && !v.question && v.pairings.some((p) => p.last?.status === 'sent')
        ? h('div', { class: 'row' }, button(t('wizard.back', { target: v.pairings[0]?.name ?? '' }), opts.back, { 'data-test': 'pro-back' }))
        : null,
    );
  };
  const apply = (r: Reply) => {
    if (r.ok && r.pro) draw(r.pro);
  };
  const refresh = async () => apply(await send({ type: 'pro-status' }));
  void refresh();
  const timer = setInterval(() => void refresh(), 3000);
  return { refresh, stop: () => clearInterval(timer) };
}
