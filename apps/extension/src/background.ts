// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's background: it holds the client (@glmsync/browser), answers its pages, and looks
 * every few minutes whether a target's plan says to fetch - a request to the target, never to
 * Trackman. Trackman is asked only when a plan is due, and only through the load guard.
 *
 * Woken by alarms, messages and the browser starting; it keeps nothing in memory that matters (a
 * Manifest V3 background may be stopped between events): everything is in chrome.storage.
 */

import { badge, BrowserClient, pickLang, translator } from '@glmsync/browser';
import { bridgeMessage, type BridgeReply, type Reason } from '@glmsync/spec';
import { PORTAL_URL, SIGN_OUT_URL } from '@glmsync/provider-trackman/portal';
import { answer, bridgeMatches, originOf } from './bridge.ts';
import type { Message, Pending, Reply } from './messages.ts';
import { accept, sourceOf } from './senders.ts';
import { ExtensionStorage } from './storage.ts';
import { nearOf, openTab, showTab, type Near, type TabsApi } from './tabs.ts';

declare const __VERSION__: string;
declare const __BROWSER__: 'chrome' | 'firefox';

const VERSION = __VERSION__;
const TIMER = 'timer';
const BACKFILL = 'backfill';
/** How often the plan is asked: like the app's own look, a request to the target only. */
const TIMER_MINUTES = 5;
/** A pairing offer waits this long for the player's yes (the code itself is good for ten minutes). */
const PENDING_MS = 10 * 60_000;
const PENDING_KEY = 'glmsync/pending';

const storage = new ExtensionStorage(chrome.storage.local);
const client = new BrowserClient({
  storage,
  vault: storage,
  kind: 'extension',
  name: __BROWSER__ === 'firefox' ? 'Golf Launch Monitor Sync for Firefox' : 'Golf Launch Monitor Sync for Chrome and Edge',
  version: VERSION,
});
const t = () => translator(pickLang(navigator.languages));

// ---------------------------------------------------------------------------
// The icon
// ---------------------------------------------------------------------------

async function refreshIcon(): Promise<void> {
  try {
    const s = await client.status();
    const b = badge(s);
    await chrome.action.setBadgeText({ text: b.text });
    if (b.text) await chrome.action.setBadgeBackgroundColor({ color: b.color });
    const tr = t();
    const title =
      s.attention === 'sign_in'
        ? s.key.state === 'expired'
          ? tr('key.expired')
          : tr('key.none')
        : s.attention === 'confirm'
          ? tr('confirm.title')
          : s.attention === 'other_account'
            ? tr('key.other')
            : tr('app.name');
    await chrome.action.setTitle({ title });
  } catch {
    // The icon is a convenience; the popup says the same.
  }
}

// ---------------------------------------------------------------------------
// Syncs
// ---------------------------------------------------------------------------

async function scheduleBackfill(): Promise<void> {
  const at = await client.nextBackfill();
  if (at === null) {
    await chrome.alarms.clear(BACKFILL);
    return;
  }
  // Alarms go no sooner than 30 s; the target's own wait is longer anyway.
  await chrome.alarms.create(BACKFILL, { when: Math.max(at, Date.now() + 30_000) });
}

async function run(reason: Reason, id?: string) {
  try {
    const report = await client.run(reason, id);
    return report;
  } finally {
    await scheduleBackfill().catch(() => undefined);
    await refreshIcon();
    // A run may have learnt that a target ended the connection: its bridge goes with it.
    await syncBridges();
  }
}

/** The targets hear where the sign-in stands when it changed to one they can't fetch with (spec 1.5.0). */
function report(): void {
  void client.report().catch(() => undefined);
}

async function ensureTimer(): Promise<void> {
  const had = await chrome.alarms.get(TIMER);
  if (!had) await chrome.alarms.create(TIMER, { periodInMinutes: TIMER_MINUTES, delayInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === TIMER) void run('timer');
  else if (alarm.name === BACKFILL) void run('backfill');
});

chrome.runtime.onStartup.addListener(() => {
  void ensureTimer();
  void run('timer');
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureTimer();
  void refreshIcon();
  void reachOpenPairPages();
  void syncBridges();
});

// ---------------------------------------------------------------------------
// The bridge on a paired target's page (spec/page-bridge.md)
// ---------------------------------------------------------------------------

const BRIDGE_ID = 'glmsync-bridge';
const BRIDGE_STARTED = 'glmsync/bridge-started';

/**
 * The bridge's content script goes on the pages of every paired target's origin the browser lets the extension
 * talk to (the player allowed it at pairing) - registered at run time, since the origins are the player's - and
 * comes off when no pairing has that origin any more. Pages of a new origin already open get it at once.
 */
async function syncBridges(): Promise<void> {
  try {
    const s = await client.status();
    const allowed: string[] = [];
    for (const m of bridgeMatches(s.pairings)) {
      if (await chrome.permissions.contains({ origins: [m] })) allowed.push(m);
    }
    const had = await chrome.scripting.getRegisteredContentScripts({ ids: [BRIDGE_ID] });
    const before = [...(had[0]?.matches ?? [])].sort();
    if (had.length && before.join(' ') === allowed.join(' ')) return;
    if (had.length) await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] });
    if (!allowed.length) return;
    await chrome.scripting.registerContentScripts([{ id: BRIDGE_ID, matches: allowed, js: ['bridge-content.js'], runAt: 'document_start', allFrames: false }]);
    const fresh = allowed.filter((m) => !before.includes(m));
    if (!fresh.length) return;
    for (const tab of await chrome.tabs.query({ url: fresh })) {
      if (tab.id !== undefined) await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['bridge-content.js'] }).catch(() => undefined);
    }
  } catch {
    // Asked again at the next start, pairing or run; without it the popup's "Fetch now" still works.
  }
}

async function bridgeStarted(): Promise<Record<string, number>> {
  const got = await chrome.storage.session.get(BRIDGE_STARTED);
  const v = got[BRIDGE_STARTED] as Record<string, number> | undefined;
  return v && typeof v === 'object' ? v : {};
}

async function bridge(m: Extract<Message, { type: 'bridge' }>, url: string | undefined, tabId: number | undefined): Promise<Reply> {
  const origin = originOf(url);
  if (!origin) return { ok: false, error: 'origin' };
  const out = await answer(
    {
      status: () => client.status(),
      guardHold: () => client.guardHold(),
      run: (id) => run('manual', id),
      now: Date.now,
      lastStarted: async (id) => (await bridgeStarted())[id] ?? null,
      started: async (id, at) => chrome.storage.session.set({ [BRIDGE_STARTED]: { ...(await bridgeStarted()), [id]: at } }),
    },
    m.request,
    origin,
  );
  if (out.finish) {
    void out.finish().then((finished: BridgeReply) =>
      tabId === undefined ? undefined : chrome.tabs.sendMessage(tabId, { glmsyncBridge: bridgeMessage(finished) }, { frameId: 0 }).catch(() => undefined),
    );
  }
  return { ok: true, bridge: out.reply };
}

/**
 * A pairing page that was already open when the extension was installed (the player came from it to
 * install): its content script isn't in it yet, so it is put there now - the page then pairs by itself.
 */
async function reachOpenPairPages(): Promise<void> {
  try {
    const m = chrome.runtime.getManifest();
    const matches = m.content_scripts?.find((c) => c.js?.includes('pair-content.js'))?.matches ?? [];
    const tabs = await chrome.tabs.query({ url: matches });
    for (const tab of tabs) {
      if (tab.id !== undefined) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['pair-content.js'] }).catch(() => undefined);
    }
  } catch {
    // No such page open, or not allowed there: the player reloads it.
  }
}

// ---------------------------------------------------------------------------
// Pairing: the web app's page offers, the connect window asks the player
// ---------------------------------------------------------------------------

async function pending(): Promise<Pending | null> {
  const got = await chrome.storage.session.get(PENDING_KEY);
  const p = got[PENDING_KEY] as Pending | undefined;
  if (!p || Date.now() - p.at > PENDING_MS) return null;
  return p;
}

async function setPending(p: Pending | null): Promise<void> {
  if (p) await chrome.storage.session.set({ [PENDING_KEY]: p });
  else await chrome.storage.session.remove(PENDING_KEY);
}

const CONNECT_TAB_KEY = 'glmsync/connect-tab';
const tabsApi = chrome as unknown as TabsApi;

/**
 * The connect window: brought to the front if it is open, else opened as a tab beside the page that asked (the
 * pairing page, the portal) - never a popup window of its own (tabs.ts says why).
 */
async function openConnectWindow(near: Near | null): Promise<void> {
  const got = await chrome.storage.session.get(CONNECT_TAB_KEY);
  const id = got[CONNECT_TAB_KEY];
  if (typeof id === 'number' && (await showTab(tabsApi, id))) return;
  const tab = await openTab(tabsApi, chrome.runtime.getURL('connect.html'), near);
  if (tab?.id !== undefined) await chrome.storage.session.set({ [CONNECT_TAB_KEY]: tab.id });
}

async function offer(fragment: string, near: Near | null): Promise<Reply> {
  const read = BrowserClient.readFragment(fragment);
  if (!read) return { ok: false, error: 'link' };
  const now = Date.now();
  const had = await pending();
  // The same offer again (the page reloaded): keep its state.
  if (!(had && had.code === read.code && had.target === read.target)) {
    const p: Pending = { target: read.target, host: new URL(read.target).host, code: read.code, at: now, state: 'asking' };
    if (read.provider) p.provider = read.provider;
    await setPending(p);
  }
  await openConnectWindow(near);
  return { ok: true };
}

async function confirmPairing(): Promise<Reply> {
  const p = await pending();
  if (!p || p.state !== 'asking') return { ok: true, pending: p };
  const origin = `${new URL(p.target).origin}/*`;
  // The connect window asked the browser for the permission (it needs the click); without it nothing goes there.
  const allowed = await chrome.permissions.contains({ origins: [origin] });
  if (!allowed) {
    const next: Pending = { ...p, state: 'failed', error: 'denied' };
    await setPending(next);
    return { ok: true, pending: next };
  }
  await setPending({ ...p, state: 'working' });
  const out = await client.offerPairing({ target: p.target, code: p.code, ...(p.provider ? { provider: p.provider } : {}) });
  const next: Pending = out.ok ? { ...p, state: 'paired', name: out.name, code: '' } : { ...p, state: 'failed', error: out.error, code: '' };
  await setPending(next);
  if (out.ok) {
    void run('connect', out.id);
    await syncBridges();
  } else await refreshIcon();
  return { ok: true, pending: next };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * `near`: the tab the message came from (the pairing page, the portal, the connect window), if any; `from`:
 * where it came from (a bridge request's page).
 */
async function handle(m: Message, near: Near | null, from: { url?: string | undefined; tabId?: number | undefined }): Promise<Reply> {
  switch (m.type) {
    case 'portal-key': {
      const r = await client.setKey(m.token);
      if (r.ok && r.changed) {
        if (r.ready) void run('connect');
        else {
          await refreshIcon();
          report();
          // A key of an account to ask about, and an app is waiting for it: ask "Is this you?" right away - also
          // when another account's question was still open (the player switched accounts in the portal tab).
          if (r.asking && (await client.status()).pairings.length) await openConnectWindow(near);
        }
      }
      return { ok: true };
    }
    case 'bridge':
      return bridge(m, from.url, from.tabId);
    case 'pair-offer':
      return offer(m.fragment, near);
    case 'pair-status':
      return { ok: true, pending: await pending() };
    case 'pending':
      return { ok: true, pending: await pending() };
    case 'pair-confirm':
      return confirmPairing();
    case 'pair-cancel': {
      const p = await pending();
      if (p && p.state === 'asking') await setPending({ ...p, state: 'cancelled', code: '' });
      return { ok: true, pending: await pending() };
    }
    case 'status':
      return { ok: true, status: await client.status() };
    case 'run':
      await run('manual', m.id);
      return { ok: true, status: await client.status() };
    case 'confirm': {
      const state = await client.confirm(m.yes);
      // The answer goes back before the sync starts: the page says "connected" at once (18 Nov: a yes seemed
      // to do nothing for seconds while the reply waited for the whole first sync).
      const status = await client.status();
      if (state.state === 'ready') void run('connect');
      else {
        await refreshIcon();
        report();
      }
      return { ok: true, status };
    }
    case 'retry-who':
      await client.retryWho();
      await refreshIcon();
      return { ok: true, status: await client.status() };
    case 'unpair':
      await client.removePairing(m.id);
      await refreshIcon();
      await syncBridges();
      return { ok: true, status: await client.status() };
    case 'export-log':
      return { ok: true, log: await client.exportLog() };
    case 'clear-ended':
      await client.clearEnded();
      return { ok: true, status: await client.status() };
    case 'forget-key':
      await client.dropKey();
      await refreshIcon();
      report();
      return { ok: true, status: await client.status() };
    case 'open-portal':
      // Beside the connect window, in its browser window, in front.
      await openTab(tabsApi, PORTAL_URL, near);
      return { ok: true };
    case 'switch-account':
      // Someone else's account is signed in to the portal here: Trackman's own sign-out, as a page the player
      // sees; then the portal, to sign in with their own (the extension picks the new key up from there).
      await openTab(tabsApi, SIGN_OUT_URL, near);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  const source = sourceOf(sender, chrome.runtime.id, chrome.runtime.getURL(''));
  const m = accept(raw, source);
  if (!m) return false; // not ours to answer
  handle(m, nearOf(sender.tab), { url: sender.url, tabId: sender.tab?.id }).then(reply, (e: unknown) => reply({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies Reply));
  return true; // answered asynchronously
});

void ensureTimer();
void refreshIcon();
// Firefox may forget registered content scripts when it restarts: the bridge is put back on every wake.
void syncBridges();

