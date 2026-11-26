// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The extension's background: it holds the client (@glmsync/browser), answers its pages, and looks
 * every few minutes whether a target's plan says to fetch - a request to the target, never to
 * Trackman. Trackman is asked only when a plan is due, and only through the load guard.
 *
 * And it holds the handicap record read along on golf.de (`HcpClient`, spec/hcp.md): what golf.de's own page showed
 * the player arrives from the content script there; a few seconds after the last new page it goes to the apps paired
 * for it, each batch after their plan. golf.de is never asked anything. *Fetch all* runs on the player's tap, or by
 * itself (spec 1.16.0): every `auto_look_minutes` the apps' plans are asked (`timer`), and when one says due while
 * golf.de last said the player is signed in, *Mein Bereich* opens in a tab that doesn't take the focus, the run goes
 * on there as on a tap, and the tab closes at its end - unless the player switched to it.
 *
 * And a pro's own world ranking page (`ProClient`, spec/prores.md): the page arrives from the content script there when
 * the player taps *Send*, read as the page showed it, and goes to the apps paired for it, each after its plan. Whether
 * a page is the player's is answered in the extension's own pages. The site is never asked anything. A tour's pages
 * the same way (the Pro Golf Tour: tours.ts; europeantour.com, a page per tour: `@glmsync/browser/europeantour`; the
 * season pages of PGA Tour, Korn Ferry, LPGA and Epson: season-content.ts, sent as the page showed them).
 *
 * *Fetch all* on the tours whose pages show a part at a time (`RunKeeper`, @glmsync/browser/runs; decision 57): on the
 * player's tap, a run planned from his page's address opens his own pages there and picks in their own pickers, one
 * step at a time at a person's pace, in the tab he tapped in; its tour's pages go out once at its end, within the reach
 * (two years, at most 50 tournaments).
 *
 * Woken by alarms, messages and the browser starting; it keeps nothing in memory that matters (a
 * Manifest V3 background may be stopped between events): everything is in chrome.storage.
 */

import { badge, BrowserClient, HcpClient, IdbBlobs, pairingProvider, pickLang, ProClient, SEND_AFTER_MS, translator, type HcpView } from '@glmsync/browser';
import { SITES } from '@glmsync/provider-rankings';
import { TourKeeper } from '@glmsync/browser/tours';
import { EtKeeper } from '@glmsync/browser/europeantour';
import { OcsKeeper } from '@glmsync/browser/ocs';
import { AlpsKeeper } from '@glmsync/browser/alps';
import { RunKeeper } from '@glmsync/browser/runs';
import { SeasonKeeper } from '@glmsync/browser/season';
import { ocs, run as pickRun, SITES_OF, type RunFamily, type TourPage } from '@glmsync/provider-tours';
import { CLICKS, HISTORY_SHEET_URL, MY_AREA_URL, readSeen } from '@glmsync/provider-golfde';
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
  name: __BROWSER__ === 'firefox' ? 'Golf Stats Sync for Firefox' : 'Golf Stats Sync for Chrome and Edge',
  version: VERSION,
  // A test scenario (test mode) can be far larger than the extension's storage takes.
  blobs: new IdbBlobs(),
});
const hcp = new HcpClient({
  storage,
  vault: storage,
  session: new ExtensionStorage(chrome.storage.session),
  kind: 'extension',
  name: __BROWSER__ === 'firefox' ? 'Golf Stats Sync for Firefox' : 'Golf Stats Sync for Chrome and Edge',
  version: VERSION,
});
const pro = new ProClient({
  storage,
  vault: storage,
  kind: 'extension',
  name: __BROWSER__ === 'firefox' ? 'Golf Stats Sync for Firefox' : 'Golf Stats Sync for Chrome and Edge',
  version: VERSION,
});
// The Pro Golf Tour's pages as the player opens them (`@glmsync/browser/tours`): what was read, *Fetch all*.
const tours = new TourKeeper(storage);
// His pages on europeantour.com as he opens them (`@glmsync/browser/europeantour`): DP World Tour and HotelPlanner
// Tour, merged.
const et = new EtKeeper(storage);
// The LET's and LET Access Series' pages (`OcsKeeper`, @glmsync/browser/ocs): her profile and her Order of Merit line, per tour.
const ocsPages = new OcsKeeper(storage);
// His Alps Tour profile (`AlpsKeeper`, @glmsync/browser/alps): the reports he picked there, merged.
const alpsPages = new AlpsKeeper(storage);
// *Fetch all* on those tours (`RunKeeper`, @glmsync/browser/runs), and the season pages a run read (`SeasonKeeper`).
const runs = new RunKeeper(storage);
const seasonPages = new SeasonKeeper(storage);
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** His tour page as read so far, to every app paired for a pro's pages (each after its plan). */
async function sendTour(): Promise<Reply> {
  const page = await tours.page(localDay());
  const v = page ? await pro.send(page) : await pro.view();
  await refreshIcon();
  return { ok: true, pro: v, tour: await tours.view() };
}
/** His europeantour.com pages as read so far: a page per tour, each to every app paired for a pro's pages. */
async function sendEt(): Promise<Reply> {
  const pages = await et.pages(localDay());
  let v = await pro.view();
  for (const page of pages) v = await pro.send(page);
  await refreshIcon();
  return { ok: true, pro: v, et: { ...(await et.view()), sent: pages.map((p) => p.site) } };
}
/** Her profile of a tour of the LET's (with her Order of Merit line), to every app paired for a pro's pages. */
async function sendOcs(site: ocs.OcsTourSite): Promise<Reply> {
  const page = await ocsPages.page(site, localDay());
  const v = page ? await pro.send(page) : await pro.view();
  await refreshIcon();
  return { ok: true, pro: v, ocs: await ocsPages.view(site) };
}
/** His Alps Tour profile as read so far, to every app paired for a pro's pages (each after its plan). */
async function sendAlps(): Promise<Reply> {
  const page = await alpsPages.page(localDay());
  const v = page ? await pro.send(page) : await pro.view();
  await refreshIcon();
  return { ok: true, pro: v, alps: await alpsPages.view() };
}
/**
 * A run of *Fetch all* ended: what its tour's pages hold goes out, within the reach (the last two years, at most 50
 * tournaments) - not after another player's page stopped it (what is kept may then be his).
 */
async function sendRun(family: RunFamily): Promise<Reply> {
  const today = localDay();
  const view = await runs.view();
  let pages: TourPage[] = [];
  if (view.ended?.family === family && view.ended.how === 'other_player') {
    await seasonPages.take(SITES_OF[family]);
  } else if (family === 'alps') {
    const p = await alpsPages.page(today);
    pages = p ? [p] : [];
  } else if (family === 'europeantour') {
    pages = await et.pages(today);
  } else if (family === 'tour:let' || family === 'tour:let_access') {
    const p = await ocsPages.page(family, today);
    pages = p ? [p] : [];
  } else {
    pages = await seasonPages.take(SITES_OF[family]);
  }
  let v = await pro.view();
  for (const page of pages) v = await pro.send(pickRun.withinReach(page, today));
  await refreshIcon();
  // Which tours went, the last one last: an app keeps what it answered last, and the line speaks of that one.
  return { ok: true, pro: v, run: await runs.view(), sent: pages.map((p) => p.site) };
}
/**
 * The address a tour's page says it shows now, taken only on the sender's own site (these sites change their address
 * without loading a page, which the sender's address doesn't always follow); none otherwise.
 */
function onSendersSite(url: string, sender: string | undefined): string | null {
  try {
    return sender && new URL(url).origin === new URL(sender).origin ? url : null;
  } catch {
    return null;
  }
}
/** A message naming a tour of the LET's only from that tour's own page (both sites run the same script). */
const fromSite = (url: string | undefined, site: ocs.OcsTourSite): boolean => ocs.siteAt(url)?.site === site;
const HCP_SEND = 'hcp-send';
const HCP_RUN = 'hcp-run';
const HCP_AUTO = 'hcp-auto-look';
const t = () => translator(pickLang(navigator.languages));

// ---------------------------------------------------------------------------
// The icon
// ---------------------------------------------------------------------------

async function refreshIcon(): Promise<void> {
  try {
    const s = await client.status();
    // golf.de's account waiting for the yes asks as a launch monitor's does (nothing is sent before it).
    const hcpAsking = !s.attention && (await hcp.view().catch(() => null))?.account === 'asking';
    // An app asking whether a world ranking page is the player's asks the same way.
    const proAsking = !s.attention && !hcpAsking ? ((await pro.view().catch(() => null))?.question ?? null) : null;
    const b = hcpAsking || proAsking ? badge({ attention: 'confirm' }) : badge(s);
    await chrome.action.setBadgeText({ text: b.text });
    if (b.text) await chrome.action.setBadgeBackgroundColor({ color: b.color });
    const tr = t();
    const title = hcpAsking
      ? tr('wizard.title.account', { service: 'golf.de' })
      : proAsking
        ? tr('proLine.ask', { targets: proAsking.targets.join(', ') })
      : s.attention === 'sign_in'
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
  else if (alarm.name === HCP_SEND) void hcp.send().catch(() => undefined);
  else if (alarm.name === HCP_RUN) void hcp.view().then(watchRun).catch(() => undefined);
  else if (alarm.name === HCP_AUTO) void autoLook();
});

// ---------------------------------------------------------------------------
// The handicap record, read along on golf.de
// ---------------------------------------------------------------------------

/**
 * Something new came in: it goes by itself a little after the last new page (a few pages make one import), unless the
 * player wants to say when. Each new page moves the moment on.
 */
async function scheduleHcp(v: HcpView): Promise<void> {
  // A run of *Fetch all* sends once at its end, not page by page.
  if (v.fetch_all === 'running') {
    await chrome.alarms.clear(HCP_SEND).catch(() => false);
    return;
  }
  if (v.auto && v.fresh > 0 && v.pairings.some((p) => !p.other_account)) {
    // Alarms go no sooner than 30 s anyway.
    await chrome.alarms.create(HCP_SEND, { when: Date.now() + Math.max(SEND_AFTER_MS, 30_000) });
  }
}

async function golfdeSeen(page: string, raw: unknown): Promise<Reply> {
  const seen = readSeen(raw);
  if (!seen) return { ok: true, hcp: await hcp.view() };
  const v = await hcp.see(page, seen);
  await scheduleHcp(v).catch(() => undefined);
  // A run may have stopped on what this page showed (signed out, another account): its background tab goes.
  await settleAutoTab(v).catch(() => undefined);
  if (v.account === 'asking') await refreshIcon();
  return { ok: true, hcp: v };
}

/** Which tab drives a run of *Fetch all*: only the one that tapped. */
const tabOwner = (tabId: number | undefined) => (typeof tabId === 'number' ? `tab:${tabId}` : null);

/**
 * While a run goes on, a look every minute: a run whose tab stopped asking (the player went elsewhere in it) ends and
 * sends what it read. A closed tab ends its run at once (below).
 */
async function watchRun(v: HcpView): Promise<void> {
  if (v.fetch_all === 'running') await chrome.alarms.create(HCP_RUN, { periodInMinutes: 1 });
  else await chrome.alarms.clear(HCP_RUN).catch(() => false);
  await settleAutoTab(v).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Fetch all by itself, when the record is due (spec/hcp.md, spec 1.16.0)
// ---------------------------------------------------------------------------

const AUTO_TAB_KEY = 'glmsync/hcp/auto-tab';
/** A background tab whose run hasn't started this long after it opened (its page never got going) is closed. */
const AUTO_TAB_START_MS = 2 * 60_000;

/** The tab a run by itself opened: when, whether its run started, whether the player switched to it (then it's theirs). */
interface AutoTab {
  id: number;
  at: number;
  started?: boolean;
  taken?: boolean;
}

async function autoTab(): Promise<AutoTab | null> {
  const got = await chrome.storage.session.get(AUTO_TAB_KEY);
  const v = got[AUTO_TAB_KEY] as Partial<AutoTab> | undefined;
  return v && typeof v.id === 'number' && typeof v.at === 'number' ? (v as AutoTab) : null;
}

async function setAutoTab(v: AutoTab | null): Promise<void> {
  if (v) await chrome.storage.session.set({ [AUTO_TAB_KEY]: v });
  else await chrome.storage.session.remove(AUTO_TAB_KEY);
}

/** Its run is over: the background tab closes, unless the player took it up. */
async function endAutoTab(tab: AutoTab): Promise<void> {
  await setAutoTab(null);
  if (!tab.taken) await chrome.tabs.remove(tab.id).catch(() => undefined);
}

async function settleAutoTab(v: HcpView): Promise<void> {
  if (v.fetch_all === 'running') return;
  const tab = await autoTab();
  if (tab?.started) await endAutoTab(tab);
}

async function ensureHcpAuto(): Promise<void> {
  const had = await chrome.alarms.get(HCP_AUTO);
  if (!had) await chrome.alarms.create(HCP_AUTO, { periodInMinutes: CLICKS.auto_look_minutes, delayInMinutes: 3 });
}

/** An ordinary window to open the tab in (never a private one); with none open, nothing (no window of its own). */
async function quietWindow(): Promise<number | null> {
  const all = await chrome.windows.getAll({ windowTypes: ['normal'] });
  const fit = all.filter((w) => !w.incognito && typeof w.id === 'number');
  return (fit.find((w) => w.focused) ?? fit[0])?.id ?? null;
}

let looking = false;

/**
 * Whether to start a run by itself now (`HcpClient.autoDue`: the switch, the hold, signed in, the account confirmed,
 * runs left, a plan with `timer` that says due); if so, *Mein Bereich* in a background tab and the run for it. Its page
 * asks for the steps as on a tap (golfde-relay.ts); a page that says signed out ends it there - nothing signs in.
 */
async function autoLook(): Promise<void> {
  if (looking) return;
  looking = true;
  try {
    const had = await autoTab();
    if (had) {
      // One at a time: a run still under way there, or a page still loading. One left behind (the background was
      // stopped before it closed the tab) goes now.
      const live = had.started ? await hcp.drives(`tab:${had.id}`) : Date.now() - had.at < AUTO_TAB_START_MS;
      if (live) return;
      await endAutoTab(had);
    }
    if (!(await hcp.autoDue())) return;
    const windowId = await quietWindow();
    if (windowId === null) return;
    const tab = await chrome.tabs.create({ url: MY_AREA_URL, active: false, windowId });
    if (typeof tab.id !== 'number') return;
    const opened: AutoTab = { id: tab.id, at: Date.now() };
    await setAutoTab(opened);
    const v = await hcp.startFetchAll(`tab:${tab.id}`, { auto: true });
    if (v.fetch_all !== 'running') {
      await endAutoTab(opened);
      return;
    }
    await setAutoTab({ ...opened, started: true });
    await chrome.alarms.create(HCP_RUN, { periodInMinutes: 1 });
  } catch {
    // The next look tries again (a tab that couldn't open, a target that didn't answer).
  } finally {
    looking = false;
  }
}

// The player switched to the background tab: it's theirs now and stays open when the run ends.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void autoTab()
    .then((tab) => (tab && tab.id === tabId && !tab.taken ? setAutoTab({ ...tab, taken: true }) : undefined))
    .catch(() => undefined);
});

async function golfdeRun(m: { type: 'golfde-fetch-all' | 'golfde-step' | 'golfde-stop' }, tabId: number | undefined): Promise<Reply> {
  const owner = tabOwner(tabId);
  if (!owner) return { ok: false, error: 'no tab' };
  if (m.type === 'golfde-fetch-all') {
    const v = await hcp.startFetchAll(owner);
    await scheduleHcp(v).catch(() => undefined);
    await watchRun(v).catch(() => undefined);
    return { ok: true, hcp: v };
  }
  if (m.type === 'golfde-stop') {
    const v = await hcp.cancelFetchAll();
    await watchRun(v).catch(() => undefined);
    return { ok: true, hcp: v };
  }
  const turn = await hcp.runStep(owner);
  if (turn.step.do === 'end') await watchRun(turn.view).catch(() => undefined);
  return { ok: true, hcp: turn.view, step: turn.step };
}

async function hcpSendNow(): Promise<Reply> {
  await chrome.alarms.clear(HCP_SEND).catch(() => false);
  return { ok: true, hcp: await hcp.send() };
}

chrome.runtime.onStartup.addListener(() => {
  void ensureTimer();
  void ensureHcpAuto();
  void run('timer');
});

chrome.runtime.onInstalled.addListener(() => {
  void ensureTimer();
  void ensureHcpAuto();
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
      run: (id, reason) => run(reason, id),
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
async function openConnectWindow(near: Near | null, fresh = false): Promise<void> {
  const got = await chrome.storage.session.get(CONNECT_TAB_KEY);
  const id = got[CONNECT_TAB_KEY];
  // *Connect new*: the window starts at its first step (`new`), also when it was open showing something else.
  const url = chrome.runtime.getURL(fresh ? 'connect.html?new=1' : 'connect.html');
  if (typeof id === 'number') {
    if (fresh) await chrome.tabs.update(id, { url }).catch(() => undefined);
    if (await showTab(tabsApi, id)) return;
  }
  const tab = await openTab(tabsApi, url, near);
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
    if (read.kind) p.kind = read.kind;
    await setPending(p);
  }
  await openConnectWindow(near);
  return { ok: true };
}

/** The yes to the pending offer, with the service the player chose when the offer named none. */
async function confirmPairing(chosen?: string): Promise<Reply> {
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
  // The link may name several launch monitors (spec 1.18.0): the pairing goes out with the one tapped, if it names it.
  const provider = pairingProvider(p.provider, chosen);
  const offerOf = { target: p.target, code: p.code, ...(provider ? { provider } : {}) };
  // The handicap record (kind=hcp) pairs with its own API and reads along on golf.de; nothing to fetch now.
  // A pro's world ranking pages (kind=pro) likewise: they are sent on the player's tap on their page.
  const out = p.kind === 'hcp' ? await hcp.offerPairing(offerOf) : p.kind === 'pro' ? await pro.offerPairing(offerOf) : await client.offerPairing(offerOf);
  const next: Pending = out.ok ? { ...p, state: 'paired', name: out.name, code: '' } : { ...p, state: 'failed', error: out.error, code: '' };
  await setPending(next);
  if (out.ok && p.kind === 'hcp') await scheduleHcp(await hcp.view()).catch(() => undefined);
  else if (out.ok && p.kind === 'pro') await refreshIcon();
  else if (out.ok) {
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
      return confirmPairing(m.provider);
    case 'open-connect':
      await openConnectWindow(near, true);
      return { ok: true };
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
    case 'test-fetch': {
      const test = await client.fetchTest(m.code, m.id);
      // A pairing the app ended on the way is gone: icon and bridge follow.
      await refreshIcon();
      if (!test.ok && test.error === 'revoked') await syncBridges();
      return { ok: true, test, status: await client.status() };
    }
    case 'test-confirm': {
      const test = await client.confirmTest(m.yes);
      const status = await client.status();
      // The answer goes back first; the first sync from the scenario follows, as after a sign-in's yes.
      if (m.yes && test.ok) void run('connect', test.id);
      else await refreshIcon();
      return { ok: true, test, status };
    }
    case 'test-end':
      await client.endTest(m.id);
      await refreshIcon();
      await scheduleBackfill().catch(() => undefined);
      return { ok: true, status: await client.status() };
    case 'open-portal':
      // Beside the connect window, in its browser window, in front.
      await openTab(tabsApi, PORTAL_URL, near);
      return { ok: true };
    case 'golfde-seen':
      return golfdeSeen(m.page, m.seen);
    case 'golfde-line': {
      // The tab that drives a run hears so (a background tab whose page loaded before its run was saved, too).
      const owner = tabOwner(from.tabId);
      return { ok: true, hcp: await hcp.view(), ...(owner && (await hcp.drives(owner)) ? { drive: true } : {}) };
    }
    case 'hcp-status':
      return { ok: true, hcp: await hcp.view() };
    case 'golfde-send':
    case 'hcp-send':
      return hcpSendNow();
    case 'hcp-auto': {
      const v = await hcp.setAuto(m.auto);
      if (!m.auto) await chrome.alarms.clear(HCP_SEND).catch(() => false);
      else await scheduleHcp(v).catch(() => undefined);
      return { ok: true, hcp: v };
    }
    case 'hcp-auto-fetch':
      return { ok: true, hcp: await hcp.setAutoFetch(m.on) };
    case 'hcp-unpair':
      return { ok: true, hcp: await hcp.removePairing(m.id) };
    case 'hcp-clear-ended':
      return { ok: true, hcp: await hcp.clearEnded() };
    case 'hcp-confirm': {
      const v = await hcp.confirm(m.yes);
      await refreshIcon();
      // The answer goes back first; what was seen goes to the apps right after a yes (the wizard shows it coming).
      if (m.yes && v.account === 'confirmed') void hcpSendNow().catch(() => undefined);
      return { ok: true, hcp: v };
    }
    case 'golfde-fetch-all':
    case 'golfde-step':
    case 'golfde-stop':
      return golfdeRun(m, from.tabId);
    case 'golfde-confirm':
      // From golf.de's page: only the connect window comes to the front, where the player answers.
      await openConnectWindow(near);
      return { ok: true, hcp: await hcp.view() };
    case 'open-golfde':
      await openTab(tabsApi, HISTORY_SHEET_URL, near);
      return { ok: true };
    case 'ranking-line':
    case 'pro-status':
      return { ok: true, pro: await pro.view() };
    case 'ranking-send': {
      const v = await pro.send(m.page);
      await refreshIcon();
      return { ok: true, pro: v };
    }
    case 'ranking-answer':
      // From the site's page: only the connect window comes to the front, where the player answers.
      await openConnectWindow(near);
      return { ok: true, pro: await pro.view() };
    case 'tour-seen':
      return { ok: true, pro: await pro.view(), tour: await tours.seen(m.seen) };
    case 'tour-line':
      return { ok: true, pro: await pro.view(), tour: await tours.view() };
    case 'tour-send':
      return sendTour();
    case 'tour-fetch-all': {
      if (from.tabId === undefined) return { ok: false, error: 'no_tab' };
      const fetch = await tours.fetchAll(from.tabId, localDay());
      return { ok: true, fetch, pro: await pro.view(), tour: await tours.view() };
    }
    case 'tour-step': {
      if (from.tabId === undefined) return { ok: false, error: 'no_tab' };
      const step = await tours.step(from.tabId);
      // The run just ended: what it read goes out once, now (the player's tap on *Fetch all* asked for it).
      if (step?.do === 'end') {
        const r = await sendTour();
        return r.ok ? { ...r, step } : r;
      }
      return step ? { ok: true, step, tour: await tours.view() } : { ok: true, tour: await tours.view() };
    }
    case 'tour-stop':
      await tours.stop();
      return sendTour();
    case 'tour-answer':
      // From the tour's page: only the connect window comes to the front, where the player answers.
      await openConnectWindow(near);
      return { ok: true, pro: await pro.view() };
    case 'et-seen':
      return { ok: true, pro: await pro.view(), et: await et.seen(m.read) };
    case 'et-line':
      return { ok: true, pro: await pro.view(), et: await et.view() };
    case 'et-send':
      return sendEt();
    case 'et-answer':
      // From the site's page: only the connect window comes to the front, where the player answers.
      await openConnectWindow(near);
      return { ok: true, pro: await pro.view() };
    case 'season-line':
      return { ok: true, pro: await pro.view() };
    case 'season-send': {
      // His season as the page showed it on his tap: read again strictly (checkTourPage) and sent to each app after its plan.
      const v = await pro.send(m.page);
      await refreshIcon();
      return { ok: true, pro: v };
    }
    case 'season-answer':
      await openConnectWindow(near);
      return { ok: true, pro: await pro.view() };
    case 'ocs-line':
      if (!fromSite(from.url, m.site)) return { ok: false, error: 'wrong_site' };
      return { ok: true, pro: await pro.view(), ocs: await ocsPages.view(m.site) };
    case 'ocs-seen':
      if (!fromSite(from.url, m.site)) return { ok: false, error: 'wrong_site' };
      return { ok: true, pro: await pro.view(), ocs: await ocsPages.seen(m.site, m.seen) };
    case 'ocs-send':
      if (!fromSite(from.url, m.site)) return { ok: false, error: 'wrong_site' };
      return sendOcs(m.site);
    case 'ocs-answer':
      // From the tour's page: only the connect window comes to the front, where the player answers.
      await openConnectWindow(near);
      return { ok: true, pro: await pro.view() };
    case 'alps-seen':
      return { ok: true, pro: await pro.view(), alps: await alpsPages.seen(m.read) };
    case 'alps-line':
      return { ok: true, pro: await pro.view(), alps: await alpsPages.view() };
    case 'alps-send':
      return sendAlps();
    case 'alps-answer':
      // From the site's page: only the connect window comes to the front, where the player answers.
      await openConnectWindow(near);
      return { ok: true, pro: await pro.view() };
    case 'trun-view': {
      // Whether the run going on is this tab's: only its pages answer its steps.
      const view = await runs.view();
      return { ok: true, pro: await pro.view(), run: view, runHere: view.running !== null && view.running.tab === from.tabId };
    }
    case 'trun-start': {
      if (from.tabId === undefined) return { ok: false, error: 'no_tab' };
      // The run is planned from the address of the page the tap came from: the one it shows now, of the sender's own site.
      const url = onSendersSite(m.url, from.url);
      if (!url) return { ok: false, error: 'wrong_site' };
      const { outcome, family, fresh } = await runs.start(url, from.tabId, localDay());
      // A new run of a season site starts from nothing kept (by hand, *Send* keeps nothing).
      if (fresh && family) await seasonPages.take(SITES_OF[family]);
      return { ok: true, start: outcome, pro: await pro.view(), run: await runs.view() };
    }
    case 'trun-step': {
      if (from.tabId === undefined) return { ok: false, error: 'no_tab' };
      const s = await runs.step(from.tabId);
      if (!s) return { ok: true, run: await runs.view() };
      // The run just ended: what it read goes out once, now (the player's tap on *Fetch all* asked for it).
      if (s.step.do === 'end') {
        const r = await sendRun(s.family);
        return r.ok ? { ...r, runStep: s.step } : r;
      }
      return { ok: true, runStep: s.step, run: await runs.view() };
    }
    case 'trun-seen': {
      const url = onSendersSite(m.url, from.url);
      if (from.tabId === undefined || !url) return { ok: false, error: 'no_tab' };
      const seen: pickRun.PickSeen = { url, outcome: m.outcome };
      if (m.key !== undefined) seen.key = m.key;
      if (m.player !== undefined) seen.player = m.player.toLowerCase();
      return { ok: true, pro: await pro.view(), run: await runs.seen(from.tabId, seen) };
    }
    case 'trun-stop': {
      const family = await runs.stop('cancelled', from.tabId);
      return family ? sendRun(family) : { ok: true, pro: await pro.view(), run: await runs.view() };
    }
    case 'season-seen':
      // A season page a run read: kept (read again strictly) until the run ends.
      await seasonPages.seen(m.page);
      return { ok: true, pro: await pro.view() };
    case 'pro-answer': {
      const v = await pro.answer(m.yes);
      await refreshIcon();
      return { ok: true, pro: v };
    }
    case 'pro-unpair':
      return { ok: true, pro: await pro.removePairing(m.id) };
    case 'pro-clear-ended':
      return { ok: true, pro: await pro.clearEnded() };
    case 'open-ranking':
      await openTab(tabsApi, SITES[m.site].start, near);
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

// A run of *Fetch all* whose tab closes ends there, and what it read goes out.
chrome.tabs.onRemoved.addListener((tabId) => {
  void autoTab()
    .then((tab) => (tab?.id === tabId ? setAutoTab(null) : undefined))
    .catch(() => undefined);
  const owner = tabOwner(tabId);
  if (owner) void hcp.leaveFetchAll(owner).then(watchRun).catch(() => undefined);
  // The same for a run on a tour.
  void runs
    .stop('cancelled', tabId)
    .then((family) => (family ? sendRun(family) : undefined))
    .catch(() => undefined);
});

void ensureTimer();
void ensureHcpAuto();
void refreshIcon();
// Firefox may forget registered content scripts when it restarts: the bridge is put back on every wake.
void syncBridges();

