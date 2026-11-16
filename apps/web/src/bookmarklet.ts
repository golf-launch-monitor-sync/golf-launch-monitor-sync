// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The bookmark for the web app (no extension): clicked on the signed-in Trackman portal, it finds
 * the player's own key there and offers it to copy, so they can paste it into the web app. It only
 * reads; nothing is sent anywhere, and its box can be closed any time.
 *
 * Same rules as the extension (`@glmsync/provider-trackman/portal`): a key Trackman's sign-in issued
 * from storage or cookies, else the one the portal's next call to Trackman's API carries. The box is
 * never a `window.alert`: an alert would freeze the page, and the portal couldn't make the call the
 * bookmark waits for.
 *
 * Built into one `javascript:` line by build.mjs.
 */

import { bearer, best, cookieValues, fromTrackman, liveUntil, strings } from '@glmsync/provider-trackman/portal';

const TEXT = {
  en: {
    found: 'Trackman key found',
    valid: 'Good for about {h} more hours.',
    copy: 'Copy',
    copied: 'copied',
    copyByHand: 'please copy with Ctrl+C / Cmd+C',
    then: 'Then paste it into Golf Launch Monitor Sync.',
    close: 'close',
    waiting: 'Waiting for Trackman',
    waitingHint: 'The key isn’t stored here; it comes with the portal’s next call. Click Activities in the portal.',
    nothing: 'Nothing found yet',
    nothingHint: 'Click Activities in the portal, or reload the page and use the bookmark again.',
    wrongPage: 'This bookmark works on the Trackman portal (portal.trackmangolf.com) while you are signed in.',
  },
  de: {
    found: 'Trackman-Schlüssel gefunden',
    valid: 'Gilt noch etwa {h} Stunden.',
    copy: 'Kopieren',
    copied: 'kopiert',
    copyByHand: 'bitte mit Strg+C / Cmd+C kopieren',
    then: 'Dann in Golf Launch Monitor Sync einfügen.',
    close: 'schließen',
    waiting: 'Warte auf Trackman',
    waitingHint: 'Der Schlüssel liegt hier nicht im Speicher, er kommt mit dem nächsten Abruf des Portals. Klick im Portal auf Activities.',
    nothing: 'Noch nichts gefunden',
    nothingHint: 'Klick im Portal auf Activities, oder lade die Seite neu und nimm das Lesezeichen noch einmal.',
    wrongPage: 'Dieses Lesezeichen funktioniert im Trackman-Portal (portal.trackmangolf.com), während du angemeldet bist.',
  },
};

(() => {
  const lang = /^de\b/i.test(navigator.language) ? 'de' : 'en';
  const tx = TEXT[lang];
  const ID = 'glmsync-key-box';
  document.getElementById(ID)?.remove();
  const box = document.createElement('div');
  box.id = ID;
  box.setAttribute(
    'style',
    'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:340px;padding:14px 16px;border-radius:12px;background:#14532d;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 10px 34px rgba(0,0,0,.4)',
  );
  document.body.append(box);

  const el = (tag: string, text: string, style = '') => {
    const e = document.createElement(tag);
    e.textContent = text;
    if (style) e.setAttribute('style', style);
    return e;
  };
  const closer = () => {
    const a = el('a', tx.close, 'color:#f2d16b;cursor:pointer;text-decoration:underline');
    a.addEventListener('click', () => box.remove());
    const row = el('div', '', 'margin-top:8px;font-size:12px;opacity:.85');
    row.append(a);
    return row;
  };
  const say = (title: string, hint: string) => box.replaceChildren(el('b', title), el('div', hint, 'margin-top:6px;opacity:.9'), closer());

  if (location.hostname !== 'portal.trackmangolf.com') {
    say('Golf Launch Monitor Sync', tx.wrongPage);
    return;
  }

  let shown = false;
  const show = (token: string) => {
    if (shown) return;
    shown = true;
    const hours = Math.max(0, Math.round(((liveUntil(token, Date.now()) ?? Date.now()) - Date.now()) / 3_600_000));
    const area = document.createElement('textarea');
    area.readOnly = true;
    area.value = token;
    area.setAttribute('style', 'width:100%;height:48px;font:11px/1.3 monospace;border-radius:8px;border:0;padding:6px;resize:none;color:#111');
    const note = el('span', '', 'margin-left:8px;opacity:.85');
    const copy = () => {
      const byHand = () => {
        area.select();
        note.textContent = tx.copyByHand;
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(token).then(() => (note.textContent = tx.copied), byHand);
      else byHand();
    };
    const button = el('button', tx.copy, 'all:unset;cursor:pointer;background:#f2d16b;color:#14532d;font-weight:700;padding:7px 14px;border-radius:8px');
    button.addEventListener('click', copy);
    const row = el('div', '', 'margin:10px 0 8px');
    row.append(button, note);
    box.replaceChildren(el('b', tx.found), el('div', tx.valid.replace('{h}', String(hours))), row, area, el('div', tx.then, 'margin-top:8px;font-size:12px;opacity:.85'), closer());
    copy();
  };

  const found: string[] = [];
  try {
    for (const s of [localStorage, sessionStorage]) {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k !== null) found.push(...strings(s.getItem(k)));
      }
    }
  } catch {
    // storage switched off
  }
  try {
    for (const v of cookieValues(document.cookie)) found.push(...strings(v));
  } catch {
    // no cookies
  }
  const stored = best(found.filter(fromTrackman), Date.now());
  if (stored) {
    show(stored);
    return;
  }

  // Not stored: the portal's next call to Trackman's API carries it.
  const toApi = (url: unknown) => {
    try {
      return new URL(String(url), location.href).host === 'api.trackmangolf.com';
    } catch {
      return false;
    }
  };
  const offer = (t: string | null) => {
    if (t && liveUntil(t, Date.now()) !== null) show(t);
  };
  const ownFetch = window.fetch;
  window.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
    try {
      const url = input instanceof Request ? input.url : input;
      if (toApi(url)) {
        const h = init?.headers ?? (input instanceof Request ? input.headers : undefined);
        const v = h instanceof Headers ? h.get('Authorization') : Array.isArray(h) ? h.find(([k]) => k.toLowerCase() === 'authorization')?.[1] : (h as Record<string, string> | undefined)?.Authorization ?? (h as Record<string, string> | undefined)?.authorization;
        offer(bearer(v));
      }
    } catch {
      // never in the portal's way
    }
    return ownFetch.apply(this, [input, init] as Parameters<typeof fetch>);
  } as typeof fetch;
  const ownOpen = XMLHttpRequest.prototype.open;
  const ownSet = XMLHttpRequest.prototype.setRequestHeader;
  const urls = new WeakMap<XMLHttpRequest, unknown>();
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: unknown[]) {
    urls.set(this, args[1]);
    return (ownOpen as (...a: unknown[]) => void).apply(this, args);
  } as typeof XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    try {
      if (name.toLowerCase() === 'authorization' && toApi(urls.get(this))) offer(bearer(value));
    } catch {
      // never in the portal's way
    }
    return ownSet.call(this, name, value);
  };
  say(tx.waiting, tx.waitingHint);
  try {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  } catch {
    // only a nudge
  }
  setTimeout(() => {
    if (!shown) say(tx.nothing, tx.nothingHint);
  }, 45_000);
})();
