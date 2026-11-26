// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The handicap record, read along on golf.de (spec/hcp.md, *A client that only observes*): the pairings with handicap
 * targets, what golf.de's pages showed (`see`), and sending it (`send`). The extension's background holds one.
 *
 * Nothing here asks golf.de anything: what arrives in `see` is what golf.de's own page loaded in the player's tab,
 * already made into dgvhcp/1 results inside the page (no names, no numbers). Every batch goes through the target's
 * plan (`manual`: the player opened the page) and only what is new or changed for that target is sent - a target
 * keeps one import per batch, so the background gathers a few pages before it sends (`SEND_AFTER_MS`). The companion
 * app holds one too, for its golf.de window (`apps/companion/src/lib/hcp.ts`).
 *
 * What it keeps:
 * - in the **vault**: the pairings with their import tokens (each goes to its own target only);
 * - in **storage**: what each target last answered, the results seen (of one golf.de account: another account's
 *   are dropped the moment it shows) and a fingerprint of what each target has from here;
 * - in the **session** (gone when the browser closes): which golf.de account the pages showed, and results of a
 *   page that hasn't said yet whose they are.
 *
 * Nothing goes to a target before the player said the golf.de account the pages named is theirs (*Is this your
 * account?*, `confirm`), unless a target already has that very account connected (as with a launch monitor's
 * sign-in): on a shared computer someone else may be signed in to golf.de.
 *
 * *Fetch all* runs on the player's tap, or (spec 1.16.0, the extension) by itself: `autoDue` says whether to start one
 * now - only while golf.de last said the player is signed in, the account confirmed, and a target's plan with `timer`
 * says due - and the extension's background opens golf.de in a tab of its own for it. A run by itself that stops early
 * holds the next until golf.de's page has shown the player signed in outside a run. The companion app (spec 1.17.0) does
 * the same only while it is open, in a window the player doesn't see, keeping a run of the day for the player's tap
 * (`autoDue` with `spare`); the app going to the back interrupts its run without the hold (`interruptFetchAll`).
 *
 * One tournament (spec 1.19.0, *Taking one tournament*): `takeEvent` sends the one tournament whose page the player has
 * open, on their tap, to the target they picked - read again strictly first (it may come from a page script). It needs
 * no golf.de account and no yes to one: the page is public and names no one.
 *
 * Every method is serialised, and nothing throws at the caller for what can happen (a target down, a token
 * revoked): that is a state to show.
 */

import {
  accountRefOf,
  base64url,
  HcpTarget,
  pairHcp,
  sha256,
  TargetError,
  utf8,
  type ClientKind,
  type FetchLike,
  type HcpBatch,
  type HcpImportResult,
  type HcpPairing,
  type HcpResult,
  type Storage,
} from '@glmsync/core';
import {
  batchOf,
  eventBody,
  readEvent,
  cancelRun,
  CLICKS,
  nextStep,
  ownLine,
  parts,
  PROVIDER_ID,
  readRun,
  running,
  runView,
  seeRun,
  startRun,
  type RunState,
  type RunView,
  type Seen,
  type Step,
} from '@glmsync/provider-golfde';
import type { Farewell, PairOutcome } from './client.ts';

/** How long after the last new thing seen the background sends by itself: a few pages make one import. */
export const SEND_AFTER_MS = 30_000;
const MAX_KEPT = 600;
const MAX_PENDING = 20;
const PENDING_MS = 30 * 60_000;
const MAX_FAREWELLS = 5;

const PAIRINGS = 'glmsync/hcp/pairings';
const ENTRIES = 'glmsync/hcp/entries';
const SEEN = 'glmsync/hcp/seen';
const SENT = 'glmsync/hcp/sent/';
const SETTINGS = 'glmsync/hcp/settings';
const ENDED = 'glmsync/hcp/ended';
const SESSION = 'glmsync/hcp/session';
/** *Fetch all* (spec/hcp.md): the run (session), the result lists opened lately and the runs of the last day (storage). */
const RUN = 'glmsync/hcp/run';
const OPENED = 'glmsync/hcp/opened';
const RUNS = 'glmsync/hcp/runs';
/** A run by itself (spec 1.16.0): switched off by the player, held after one that stopped early, when it last looked. */
const AUTO = 'glmsync/hcp/auto';
/** A run whose page hasn't asked for its next step for this long was left (the tab closed, the player went elsewhere). */
export const RUN_LEFT_MS = 120_000;
const DAY_MS = 24 * 3600_000;
/** The golf.de accounts the player said were theirs, and those they said weren't (fingerprints of the subject). */
const ACCOUNTS = 'glmsync/hcp/accounts';
const MAX_ACCOUNTS = 20;

export interface HcpClientOptions {
  storage: Storage;
  vault: Storage;
  /** Forgets when the browser closes (chrome.storage.session): which account the pages showed. */
  session: Storage;
  kind: ClientKind;
  name: string;
  version: string;
  fetch?: FetchLike;
  now?: () => number;
}

export interface HcpLast {
  at: string;
  status: 'sent' | 'failed' | 'other_account' | 'not_due';
  /** Results the target took as new or with more. */
  brought?: number;
  result?: HcpImportResult;
  error?: string;
}

export interface HcpEntry {
  id: string;
  base: string;
  name: string;
  paired_at: string;
  account_ref?: string;
  last?: HcpLast;
  other_account?: boolean;
  /** Results this target took as new or with more, all sends together (the wizard's "12 results sent"). */
  total?: number;
}

/** What taking one tournament came to, for the player (spec 1.19.0): its words are `eventText`'s. */
export type TakeOutcome =
  | { ok: true; name: string; result: 'new' | 'known' | 'updated'; kept: string[] }
  | {
      ok: false;
      name?: string;
      error:
        | 'no_pairing'
        | 'changed_page'
        | 'not_offered'
        | 'account_inactive'
        | 'ended'
        | 'rate_limited'
        | 'calendar_full'
        | 'too_old'
        | 'too_far_ahead'
        | 'refused'
        | 'unreachable'
        | 'failed';
      /** With `rate_limited`: how long the target asked to wait. */
      retry_after_s?: number;
    };

export interface HcpView {
  pairings: (HcpEntry & { host: string })[];
  /** Send by itself (after a few pages), or only on the player's word. */
  auto: boolean;
  /** Results kept from golf.de's pages (of the account they showed). */
  seen: number;
  /** Of them, what a connected target doesn't have from here yet (the most of any target). */
  fresh: number;
  /** Seen, but no page has said yet whose record it is (golf.de's *Mein Bereich* says it). */
  waiting: boolean;
  /** golf.de's page said the player isn't signed in. */
  signed_out: boolean;
  /** An answer looked different from what this version knows: nothing of it was read. */
  changed_page: boolean;
  sending: boolean;
  ended: Farewell[];
  /**
   * The golf.de account the pages named: `none` (none named yet), `asking` (waiting for the player's yes: nothing is
   * sent), `confirmed`, `rejected` (not theirs: nothing of it is kept or sent).
   */
  account: 'none' | 'asking' | 'confirmed' | 'rejected';
  /** While asking: the account's handicap index as its page showed it, to tell whose it is. */
  index: { value: number; as_of: string } | null;
  /**
   * *Fetch all*: `ready` (signed in on golf.de, the account confirmed, an app connected: the button), `running`,
   * `limit` (enough runs today), or `no` (not now: not signed in, no account yet or not confirmed, no app).
   */
  fetch_all: 'ready' | 'running' | 'limit' | 'no';
  /** The run under way, or the last one of this session (what it read, how it ended). */
  run: (RunView & { auto?: true }) | null;
  /** *Fetch all* by itself when a target says the record is due (spec 1.16.0): the player's switch, on by default. */
  auto_fetch: boolean;
}

interface AutoState {
  off?: boolean;
  /** A run by itself stopped early: none again until golf.de's page showed the player signed in outside a run. */
  hold?: boolean;
  /** When a look last asked the targets' plans. */
  looked?: number;
}

/** A run as it is kept: the run, which page drives it, when that page last asked, and whether it is closed. */
interface KeptRun {
  run: RunState;
  owner: string;
  asked: number;
  /** Over and what it read sent (once). */
  closed?: boolean;
  /** Started by itself, not by the player's tap (spec 1.16.0). */
  auto?: boolean;
}

/** What a page that may drive a run hears: the step to take, and the view to show. */
export interface RunTurn {
  step: Step;
  view: HcpView;
}

interface Kept {
  subject: string | null;
  index: { value: number; low?: number; as_of: string } | null;
  results: Record<string, HcpResult>;
  /** Told already, per pairing: a notice goes to a target once, not with every page. */
  told?: Record<string, string>;
  signed_out?: boolean;
  changed_page?: string;
}

interface Session {
  subject: string | null;
  signed_out: boolean;
  pages: Record<string, { subject?: string; at: number; pending?: { sheet: 'history' | 'scoring'; results: HcpResult[] }[] }>;
}

const hostOf = (base: string) => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

/** A handicap pairing's id: stable per target address (and never the same as a launch monitor pairing's). */
export function hcpPairingId(base: string): string {
  return base64url(sha256(utf8(`glmsync-hcp-pairing|${base.replace(/\/+$/, '')}`))).slice(0, 16);
}

/** Which result it is, for keeping and comparing: golf.de's own id of it, else what tells it. */
export function keyOf(r: HcpResult): string {
  return r.ref ? `ref:${r.ref}` : `day:${r.played_on}|${r.holes_read ?? ''}|${r.cr ?? ''}/${r.slope ?? ''}|${r.gbe ?? r.stableford_net ?? ''}|${r.round_no ?? ''}`;
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const print = (v: unknown) => base64url(sha256(utf8(stable(v)))).slice(0, 16);

/** What is kept of a golf.de account the player answered about: a fingerprint, not its id. */
const accountPrint = (subject: string) => base64url(sha256(utf8(`glmsync-hcp-account|${subject}`))).slice(0, 22);

interface Accounts {
  confirmed: string[];
  rejected: string[];
}

/** The day in the browser's own time zone (what "today" is for the player). */
function today(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function read<T>(s: Storage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await s.get(key);
    const v = raw === null ? null : (JSON.parse(raw) as unknown);
    return v === null || typeof v !== 'object' ? fallback : (v as T);
  } catch {
    return fallback; // unreadable: start afresh rather than stop working
  }
}

export class HcpClient {
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private sending = false;

  constructor(private readonly opts: HcpClientOptions) {
    this.now = opts.now ?? Date.now;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  // -------------------------------------------------------------------------
  // What is kept
  // -------------------------------------------------------------------------

  private async pairings(): Promise<HcpPairing[]> {
    const v = await read<unknown>(this.opts.vault, PAIRINGS, []);
    return Array.isArray(v) ? (v as HcpPairing[]) : [];
  }

  private async entries(): Promise<HcpEntry[]> {
    const v = await read<unknown>(this.opts.storage, ENTRIES, []);
    return Array.isArray(v) ? (v as HcpEntry[]) : [];
  }

  private async saveEntries(list: HcpEntry[]): Promise<void> {
    await this.opts.storage.set(ENTRIES, JSON.stringify(list));
  }

  private async update(id: string, change: (e: HcpEntry) => HcpEntry): Promise<void> {
    await this.saveEntries((await this.entries()).map((e) => (e.id === id ? change(e) : e)));
  }

  private async kept(): Promise<Kept> {
    const k = await read<Partial<Kept>>(this.opts.storage, SEEN, {});
    return {
      subject: typeof k.subject === 'string' ? k.subject : null,
      index: k.index && typeof k.index === 'object' ? k.index : null,
      results: k.results && typeof k.results === 'object' ? k.results : {},
      told: k.told && typeof k.told === 'object' ? k.told : {},
      ...(k.signed_out ? { signed_out: true } : {}),
      ...(typeof k.changed_page === 'string' ? { changed_page: k.changed_page } : {}),
    };
  }

  private async keep(k: Kept): Promise<void> {
    const list = Object.entries(k.results);
    if (list.length > MAX_KEPT) {
      // The newest stay: an older result is one the target has long had.
      list.sort((a, b) => (a[1].played_on < b[1].played_on ? 1 : a[1].played_on > b[1].played_on ? -1 : 0));
      k.results = Object.fromEntries(list.slice(0, MAX_KEPT));
    }
    await this.opts.storage.set(SEEN, JSON.stringify(k));
  }

  private async sent(id: string): Promise<Record<string, string>> {
    return read<Record<string, string>>(this.opts.storage, SENT + id, {});
  }

  private async accounts(): Promise<Accounts> {
    const a = await read<Partial<Accounts>>(this.opts.storage, ACCOUNTS, {});
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { confirmed: list(a.confirmed), rejected: list(a.rejected) };
  }

  /**
   * Where the account the pages named stands. Confirmed also when a target already has that very account connected
   * (its `account_ref`): the player said yes to it once, here or on another device.
   */
  private async accountOf(k: Kept): Promise<HcpView['account']> {
    if (!k.subject) return 'none';
    const a = await this.accounts();
    const mine = accountPrint(k.subject);
    if (a.rejected.includes(mine)) return 'rejected';
    if (a.confirmed.includes(mine)) return 'confirmed';
    const entries = await this.entries();
    for (const p of await this.pairings()) {
      const e = entries.find((x) => x.id === hcpPairingId(p.base));
      if (e?.account_ref && e.account_ref === accountRefOf(p.account_salt, PROVIDER_ID, k.subject)) return 'confirmed';
    }
    return 'asking';
  }

  private async session(): Promise<Session> {
    const s = await read<Partial<Session>>(this.opts.session, SESSION, {});
    return { subject: typeof s.subject === 'string' ? s.subject : null, signed_out: s.signed_out === true, pages: s.pages && typeof s.pages === 'object' ? s.pages : {} };
  }

  private async saveSession(s: Session): Promise<void> {
    const now = this.now();
    // Pages of the last half hour only: a page's results waiting for their account don't wait for ever.
    s.pages = Object.fromEntries(Object.entries(s.pages).filter(([, p]) => now - p.at < PENDING_MS).slice(-MAX_PENDING));
    await this.opts.session.set(SESSION, JSON.stringify(s));
  }

  private async forget(id: string, why: Farewell['why']): Promise<void> {
    const entry = (await this.entries()).find((e) => e.id === id);
    await this.opts.vault.set(PAIRINGS, JSON.stringify((await this.pairings()).filter((p) => hcpPairingId(p.base) !== id)));
    await this.saveEntries((await this.entries()).filter((e) => e.id !== id));
    await this.opts.storage.remove(SENT + id);
    if (entry) {
      const list = await read<unknown>(this.opts.storage, ENDED, []);
      const ended = Array.isArray(list) ? (list as Farewell[]) : [];
      await this.opts.storage.set(ENDED, JSON.stringify([...ended, { name: entry.name, at: new Date(this.now()).toISOString(), why }].slice(-MAX_FAREWELLS)));
    }
  }

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  /** POST /pair of a handicap target; pairing the same target again replaces the old pairing (and ends its token). */
  offerPairing(offer: { target: string; code: string; provider?: string }): Promise<PairOutcome> {
    return this.serial(async () => {
      if (offer.provider && offer.provider !== PROVIDER_ID) return { ok: false, error: 'provider' } as const;
      let pairing: HcpPairing;
      try {
        pairing = await pairHcp({
          target: offer.target,
          code: offer.code,
          provider: PROVIDER_ID,
          client: { kind: this.opts.kind, name: this.opts.name, version: this.opts.version },
          ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}),
          now: this.now,
        });
      } catch (e) {
        if (!(e instanceof TargetError)) return { ok: false, error: 'refused' } as const;
        const map: Partial<Record<TargetError['code'], Extract<PairOutcome, { ok: false }>['error']>> = {
          bad_request: 'link',
          code_invalid: 'code',
          code_expired: 'code',
          provider_unknown: 'provider',
          rate_limited: 'rate_limited',
          unreachable: 'unreachable',
          unavailable: 'unreachable',
          bad_answer: 'answer',
        };
        return { ok: false, error: map[e.code] ?? 'refused' } as const;
      }
      const id = hcpPairingId(pairing.base);
      const old = (await this.pairings()).find((p) => hcpPairingId(p.base) === id);
      if (old) await new HcpTarget(old, this.targetOpts()).revoke().catch(() => undefined);
      await this.opts.vault.set(PAIRINGS, JSON.stringify([...(await this.pairings()).filter((p) => hcpPairingId(p.base) !== id), pairing]));
      const entry: HcpEntry = { id, base: pairing.base, name: pairing.target.name, paired_at: pairing.paired_at, ...(pairing.account_ref ? { account_ref: pairing.account_ref } : {}) };
      await this.saveEntries([...(await this.entries()).filter((e) => e.id !== id), entry]);
      // A new pairing has nothing from here yet: what was seen before goes to it with the next send.
      await this.opts.storage.remove(SENT + id);
      const back = pairing.target.return_prefixes?.length ? { return_prefixes: pairing.target.return_prefixes } : {};
      return { ok: true, id, name: pairing.target.name, replaced: !!old, ...back } as const;
    });
  }

  /** The player ends a pairing here: the target is told (its token revoked), whatever it answers. */
  removePairing(id: string): Promise<HcpView> {
    return this.serial(async () => {
      const p = (await this.pairings()).find((x) => hcpPairingId(x.base) === id);
      if (p) await new HcpTarget(p, this.targetOpts()).revoke().catch(() => undefined);
      await this.opts.vault.set(PAIRINGS, JSON.stringify((await this.pairings()).filter((x) => hcpPairingId(x.base) !== id)));
      await this.saveEntries((await this.entries()).filter((e) => e.id !== id));
      await this.opts.storage.remove(SENT + id);
      return this.viewNow();
    });
  }

  private targetOpts(): { fetch?: FetchLike; now: () => number } {
    return { ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}), now: this.now };
  }

  // -------------------------------------------------------------------------
  // What golf.de's pages showed
  // -------------------------------------------------------------------------

  private merge(k: Kept, results: HcpResult[]): void {
    for (const r of results) {
      const key = keyOf(r);
      k.results[key] = { ...k.results[key], ...r };
    }
  }

  /** Another account's record showed: what was kept of the one before is dropped, never sent as this one's. */
  private switchTo(k: Kept, subject: string): Kept {
    if (k.subject === subject) return k;
    return { subject, index: null, results: {}, told: {} };
  }

  /**
   * What golf.de's page `page` (an id the extension's side gives each page it is on) showed. Results of a page go to
   * the account that page named, else to the one the pages of this browser session last named (unless golf.de said
   * since that nobody is signed in); with neither, they wait for their page to name it.
   */
  see(page: string, seen: Seen): Promise<HcpView> {
    return this.serial(async () => {
      const s = await this.session();
      const at = this.now();
      const pg = (s.pages[page] ??= { at });
      pg.at = at;
      let k = await this.kept();
      switch (seen.kind) {
        case 'member': {
          // The player on golf.de themselves (not in a run by itself): a run by itself may come again.
          const kr = await this.keptRun();
          if ((await this.autoState()).hold && !(kr?.auto && running(kr.run))) await this.changeAuto((a) => ({ ...a, hold: false }));
          s.subject = seen.subject;
          s.signed_out = false;
          pg.subject = seen.subject;
          k = this.switchTo(k, seen.subject);
          delete k.signed_out;
          if (seen.index) k.index = { ...seen.index, as_of: today(at) };
          for (const p of pg.pending ?? []) this.merge(k, p.results);
          delete pg.pending;
          break;
        }
        case 'history':
        case 'scoring': {
          const subject = pg.subject ?? (s.signed_out ? null : s.subject);
          if (!subject) {
            pg.pending = [...(pg.pending ?? []), { sheet: seen.kind, results: seen.results }].slice(-10);
            break;
          }
          k = this.switchTo(k, subject);
          delete k.signed_out;
          this.merge(k, seen.results);
          break;
        }
        case 'places': {
          // Only the line of a result kept here (golf.de's id of it names exactly one player's result).
          for (const [key, r] of Object.entries(k.results)) {
            const line = r.ref ? ownLine(seen.lines, r.ref) : null;
            if (line) k.results[key] = { ...r, place: line.place, field: line.field };
          }
          break;
        }
        case 'signed_out':
          s.signed_out = true;
          k.signed_out = true;
          break;
        case 'changed_page':
          k.changed_page = today(at);
          break;
      }
      // Not the player's (they said so): nothing of it is kept.
      if (k.subject && (await this.accountOf(k)) === 'rejected') {
        k.results = {};
        k.index = null;
      }
      await this.saveSession(s);
      await this.keep(k);
      // A run under way hears it too: it moves on, or stops (signed out, another account, a page that changed).
      const kr = await this.keptRun();
      if (kr && running(kr.run)) {
        const run = seeRun(kr.run, seen, at);
        if (run !== kr.run) await this.saveRun({ ...kr, run });
        if (!running(run)) await this.closeRun();
      }
      return this.viewNow();
    });
  }

  // -------------------------------------------------------------------------
  // Fetch all: the clicks the player would make, on their tap (spec/hcp.md)
  // -------------------------------------------------------------------------

  private async keptRun(): Promise<KeptRun | null> {
    const raw = await read<Partial<KeptRun>>(this.opts.session, RUN, {});
    const run = readRun(raw.run);
    if (!run || typeof raw.owner !== 'string' || typeof raw.asked !== 'number') return null;
    return { run, owner: raw.owner, asked: raw.asked, ...(raw.closed ? { closed: true } : {}), ...(raw.auto ? { auto: true } : {}) };
  }

  private async saveRun(kr: KeptRun): Promise<void> {
    await this.opts.session.set(RUN, JSON.stringify(kr));
  }

  /** Starts of the last day (a few runs a day at most: spec/hcp/clicks.json `runs_per_day`). */
  private async runsToday(): Promise<number[]> {
    const v = await read<unknown>(this.opts.storage, RUNS, []);
    const now = this.now();
    return (Array.isArray(v) ? v : []).filter((t): t is number => typeof t === 'number' && t <= now && now - t < DAY_MS);
  }

  /** The result lists opened lately, by tournament (the day each was opened). */
  private async opened(): Promise<Record<string, string>> {
    const v = await read<Record<string, unknown>>(this.opts.storage, OPENED, {});
    const from = today(this.now() - CLICKS.list_again_days * DAY_MS);
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] >= from));
  }

  /**
   * A run is over: what it opened is kept (not opened again for a while), and what it read goes out now - one send at
   * the end, not one per page (it waited for this). `hold: false` for a run the phone cut off (the companion app sent
   * to the back): nothing went wrong, so a run by itself isn't held for it. Inside `serial`.
   */
  private async closeRun(opts: { hold?: boolean } = {}): Promise<void> {
    const kr = await this.keptRun();
    if (!kr || kr.closed) return;
    const run = running(kr.run) ? cancelRun(kr.run, this.now()) : kr.run;
    const day = today(this.now());
    const opened = await this.opened();
    for (const t of run.opened) opened[t] = day;
    await this.opts.storage.set(OPENED, JSON.stringify(Object.fromEntries(Object.entries(opened).slice(-500))));
    await this.saveRun({ ...kr, run, closed: true });
    if (!kr.auto) {
      await this.sendAll();
      return;
    }
    // By itself: one that finished tells every target it read, even with nothing new, so the plan moves on and doesn't
    // say due again within the day; one that stopped early holds the next until the player is back on golf.de.
    const done = run.phase === 'done';
    if (!done && opts.hold !== false) await this.changeAuto((a) => ({ ...a, hold: true }));
    await this.sendAll(done);
  }

  private async autoState(): Promise<AutoState> {
    const a = await read<Partial<AutoState>>(this.opts.storage, AUTO, {});
    return {
      ...(a.off === true ? { off: true } : {}),
      ...(a.hold === true ? { hold: true } : {}),
      ...(typeof a.looked === 'number' && Number.isFinite(a.looked) ? { looked: a.looked } : {}),
    };
  }

  private async changeAuto(change: (a: AutoState) => AutoState): Promise<void> {
    await this.opts.storage.set(AUTO, JSON.stringify(change(await this.autoState())));
  }

  /** A run under way, or null; one left by its page (`RUN_LEFT_MS`) is closed here as cancelled. */
  private async liveRun(): Promise<KeptRun | null> {
    const kr = await this.keptRun();
    if (!kr || !running(kr.run)) return null;
    if (this.now() - kr.asked < RUN_LEFT_MS) return kr;
    await this.saveRun({ ...kr, run: cancelRun(kr.run, this.now()) });
    await this.closeRun();
    return null;
  }

  private async fetchAllNow(k: Kept): Promise<HcpView['fetch_all']> {
    const kr = await this.keptRun();
    if (kr && running(kr.run) && this.now() - kr.asked < RUN_LEFT_MS) return 'running';
    const s = await this.session();
    const live = (await this.entries()).some((e) => !e.other_account);
    if (!live || !k.subject || s.signed_out || k.signed_out || (await this.accountOf(k)) !== 'confirmed') return 'no';
    return (await this.runsToday()).length >= CLICKS.runs_per_day ? 'limit' : 'ready';
  }

  /**
   * The player tapped *Fetch all* on a page (`owner`: which page drives the run - the extension's tab, the app's
   * window). Only signed in on golf.de, with the account confirmed and an app connected, a few times a day; else the
   * view says why not. The run's first step is the page's to ask for (`runStep`).
   */
  startFetchAll(owner: string, opts: { auto?: boolean } = {}): Promise<HcpView> {
    return this.serial(async () => {
      await this.liveRun();
      const k = await this.kept();
      if ((await this.fetchAllNow(k)) !== 'ready' || !k.subject) return this.viewNow();
      // By itself only as `autoDue` allows (checked again: the switch or the hold may have changed since).
      if (opts.auto) {
        const a = await this.autoState();
        if (a.off || a.hold) return this.viewNow();
      }
      const now = this.now();
      const placed = Object.values(k.results)
        .filter((r) => r.ref && r.place !== undefined)
        .map((r) => r.ref as string);
      const run = startRun({ subject: k.subject, now, today: today(now), placed, recent: Object.keys(await this.opened()) });
      await this.opts.storage.set(RUNS, JSON.stringify([...(await this.runsToday()), now]));
      await this.saveRun({ run, owner, asked: now, ...(opts.auto ? { auto: true } : {}) });
      return this.viewNow();
    });
  }

  /**
   * Whether to start *Fetch all* by itself now (spec/hcp.md, *By itself, when the record is due*): switched on, not
   * held, no run under way, golf.de last said the player is signed in with the account confirmed and a target paired,
   * runs left today - and then a target's plan with `timer` says due. Asks the targets at most every
   * `auto_look_minutes`, and only the targets; golf.de is asked nothing. Never throws: a target that can't answer
   * says not due. `spare`: runs of the day it leaves for the player's tap (the companion app keeps one, since a run of
   * its own may be cut off by the phone and would otherwise use up the day's runs).
   */
  autoDue(opts: { spare?: number } = {}): Promise<boolean> {
    return this.serial(async () => {
      const a = await this.autoState();
      const now = this.now();
      // A minute's slack: the alarm that asks comes every `auto_look_minutes`, give or take.
      if (a.off || a.hold || (a.looked !== undefined && a.looked <= now && now - a.looked < (CLICKS.auto_look_minutes - 1) * 60_000)) return false;
      if (await this.liveRun()) return false;
      const k = await this.kept();
      if ((await this.fetchAllNow(k)) !== 'ready' || !k.subject) return false;
      const spare = Math.max(0, Math.floor(opts.spare ?? 0));
      if (spare && (await this.runsToday()).length + spare >= CLICKS.runs_per_day) return false;
      await this.changeAuto((x) => ({ ...x, looked: now }));
      const ref = (p: HcpPairing) => accountRefOf(p.account_salt, PROVIDER_ID, k.subject as string);
      for (const p of await this.pairings()) {
        const id = hcpPairingId(p.base);
        const entry = (await this.entries()).find((e) => e.id === id);
        if (!entry || entry.other_account || (entry.account_ref && entry.account_ref !== ref(p))) continue;
        try {
          const plan = await new HcpTarget(p, this.targetOpts()).plan('timer', this.opts.kind);
          if (plan.disconnected) {
            await this.forget(id, 'disconnected');
            continue;
          }
          if (plan.account_ref && plan.account_ref !== ref(p)) {
            await this.update(id, (e) => ({ ...e, account_ref: plan.account_ref as string, other_account: true }));
            continue;
          }
          if (plan.due) return true;
        } catch (e) {
          const code = e instanceof TargetError ? e.code : 'error';
          if (code === 'token_invalid') await this.forget(id, 'revoked');
          else if (code === 'disconnected') await this.forget(id, 'disconnected');
          // Anything else (the target down, busy): not now; the next look asks again.
        }
      }
      return false;
    });
  }

  /** The player's switch for *Fetch all* by itself. On again also lifts a hold: they asked for it. */
  setAutoFetch(on: boolean): Promise<HcpView> {
    return this.serial(async () => {
      await this.changeAuto((a) => (on ? { ...(a.looked !== undefined ? { looked: a.looked } : {}) } : { ...a, off: true }));
      return this.viewNow();
    });
  }

  /** The page `owner` drives the run under way (it should ask for its steps). */
  drives(owner: string): Promise<boolean> {
    return this.serial(async () => {
      const kr = await this.keptRun();
      return !!kr && kr.owner === owner && running(kr.run) && this.now() - kr.asked < RUN_LEFT_MS;
    });
  }

  /**
   * The page `owner` asks what to do now. Only the page that started the run gets steps; any other hears `end`. A run
   * that just ended is closed (its read sent) before the answer.
   */
  runStep(owner: string): Promise<RunTurn> {
    return this.serial(async () => {
      const kr = await this.liveRun();
      if (!kr || kr.owner !== owner) return { step: { do: 'end' } as Step, view: await this.viewNow() };
      const now = this.now();
      const { state, step } = nextStep(kr.run, now);
      await this.saveRun({ ...kr, run: state, asked: now });
      if (!running(state)) await this.closeRun();
      return { step, view: await this.viewNow() };
    });
  }

  /** The page that drives a run went away (its tab closed): the run ends, and what it read goes out. */
  leaveFetchAll(owner: string): Promise<HcpView> {
    return this.serial(async () => {
      const kr = await this.keptRun();
      if (kr && kr.owner === owner && running(kr.run)) {
        await this.saveRun({ ...kr, run: cancelRun(kr.run, this.now()) });
        await this.closeRun();
      }
      return this.viewNow();
    });
  }

  /**
   * The phone sent the companion app to the back (spec 1.17.0): a run under way (of `owner`, if named) ends as
   * cancelled and what it read goes out, as on *Stop* - but a run by itself isn't held for it, since nothing went
   * wrong; the next look may start another (the day's runs still count).
   */
  interruptFetchAll(owner?: string): Promise<HcpView> {
    return this.serial(async () => {
      const kr = await this.keptRun();
      if (kr && running(kr.run) && (owner === undefined || kr.owner === owner)) {
        await this.saveRun({ ...kr, run: cancelRun(kr.run, this.now()) });
        await this.closeRun({ hold: false });
      }
      return this.viewNow();
    });
  }

  /** The player cancels the run (or its page went away): what it read so far goes out. */
  cancelFetchAll(): Promise<HcpView> {
    return this.serial(async () => {
      const kr = await this.keptRun();
      if (kr && running(kr.run)) {
        await this.saveRun({ ...kr, run: cancelRun(kr.run, this.now()) });
        await this.closeRun();
      }
      return this.viewNow();
    });
  }

  /**
   * The player's answer to *Is this your account?* about the golf.de account the pages named. Yes: what was seen goes
   * to the apps (with the next send). No: what was kept of it is dropped, and nothing of it is kept or sent again.
   */
  confirm(yes: boolean): Promise<HcpView> {
    return this.serial(async () => {
      const k = await this.kept();
      if (!k.subject) return this.viewNow();
      const mine = accountPrint(k.subject);
      const a = await this.accounts();
      const without = (xs: string[]) => xs.filter((x) => x !== mine);
      const next: Accounts = yes
        ? { confirmed: [...without(a.confirmed), mine].slice(-MAX_ACCOUNTS), rejected: without(a.rejected) }
        : { confirmed: without(a.confirmed), rejected: [...without(a.rejected), mine].slice(-MAX_ACCOUNTS) };
      await this.opts.storage.set(ACCOUNTS, JSON.stringify(next));
      if (!yes) await this.keep({ ...k, index: null, results: {} });
      return this.viewNow();
    });
  }

  /** Send by itself after a few pages, or only when the player says so. */
  setAuto(auto: boolean): Promise<HcpView> {
    return this.serial(async () => {
      await this.opts.storage.set(SETTINGS, JSON.stringify({ auto }));
      return this.viewNow();
    });
  }

  private async auto(): Promise<boolean> {
    const s = await read<{ auto?: unknown }>(this.opts.storage, SETTINGS, {});
    return s.auto !== false;
  }

  // -------------------------------------------------------------------------
  // Sending
  // -------------------------------------------------------------------------

  /** What a target doesn't have from here yet: results (newest first) and whether the index is new to it. */
  private fresh(k: Kept, sent: Record<string, string>): { results: HcpResult[]; index: boolean } {
    const results = Object.entries(k.results)
      .filter(([key, r]) => sent[key] !== print(r))
      .map(([, r]) => r)
      .sort((a, b) => (a.played_on < b.played_on ? 1 : a.played_on > b.played_on ? -1 : 0));
    return { results, index: !!k.index && sent.__index !== print(k.index) };
  }

  /** Send what each target doesn't have yet (and a notice it hasn't heard), each batch after its plan. */
  send(): Promise<HcpView> {
    return this.serial(async () => {
      await this.sendAll();
      return this.viewNow();
    });
  }

  /** `send` inside `serial`; `always`: a batch to each target even with nothing new (a run by itself that finished). */
  private async sendAll(always = false): Promise<void> {
    this.sending = true;
    try {
      for (const p of await this.pairings()) await this.sendOne(p, always);
    } finally {
      this.sending = false;
    }
  }

  private async sendOne(p: HcpPairing, always = false): Promise<void> {
    const id = hcpPairingId(p.base);
    const entry = (await this.entries()).find((e) => e.id === id);
    const k = await this.kept();
    if (!entry || !k.subject) return;
    const ref = accountRefOf(p.account_salt, PROVIDER_ID, k.subject);
    if (entry.account_ref && entry.account_ref !== ref) {
      // Another golf.de account than the target has: nothing goes there, and nothing is asked.
      if (!entry.other_account) await this.update(id, (e) => ({ ...e, other_account: true }));
      return;
    }
    // Nothing before the player's yes (or an app that has this very account already).
    if ((await this.accountOf(k)) !== 'confirmed') return;
    const sent = await this.sent(id);
    const fresh = this.fresh(k, sent);
    const told = k.told?.[id];
    const notice: HcpBatch['notice'] | undefined =
      k.signed_out && told !== 'signed_out' ? { code: 'signed_out' } : k.changed_page && told !== `changed:${k.changed_page}` ? { code: 'changed_page' } : undefined;
    if (!fresh.results.length && !fresh.index && !notice && !always) return;
    const target = new HcpTarget(p, this.targetOpts());
    const at = new Date(this.now()).toISOString();
    try {
      const plan = await target.plan('manual', this.opts.kind);
      if (plan.disconnected) {
        await this.forget(id, 'disconnected');
        return;
      }
      if (plan.account_ref && plan.account_ref !== ref) {
        await this.update(id, (e) => ({ ...e, account_ref: plan.account_ref as string, other_account: true, last: { at, status: 'other_account' } }));
        return;
      }
      if (!plan.due) {
        await this.update(id, (e) => ({ ...e, last: { at, status: 'not_due' } }));
        return;
      }
      const generator = { name: this.opts.name, version: this.opts.version };
      const planned = { ...(plan.plan_id ? { plan_id: plan.plan_id } : {}), reason: 'manual' as const };
      const index = k.index ?? undefined;
      const total: HcpImportResult = { read: 0, new: 0, changed: 0, same: 0, skipped: 0, failed: 0 };
      const batches: HcpBatch[] = [];
      const chunks = parts(fresh.results, p.limits);
      chunks.forEach((results, i) => {
        const withIndex = i === 0 && index ? { index } : {};
        batches.push(batchOf({ account_ref: ref, sheet: sheetOf(results), results, now: this.now(), generator, plan: planned, ...withIndex }));
      });
      if (!batches.length) {
        // Nothing but the index, or a notice: a batch without results says it.
        batches.push(batchOf({ account_ref: ref, sheet: 'history', results: [], now: this.now(), generator, plan: planned, ...(fresh.index && index ? { index } : {}), ...(notice ? { notice } : {}) }));
      }
      for (const b of batches) {
        const got = await target.import(b);
        for (const key of Object.keys(total) as (keyof HcpImportResult)[]) total[key] += got[key];
        // What the target has now, from here: sent again only when it changes.
        const now = await this.sent(id);
        for (const r of b.results) now[keyOf(r)] = print(r);
        if (b.index) now.__index = print(b.index);
        await this.opts.storage.set(SENT + id, JSON.stringify(now));
      }
      if (notice || told) {
        const after = await this.kept();
        after.told = { ...after.told };
        if (notice) after.told[id] = notice.code === 'signed_out' ? 'signed_out' : `changed:${k.changed_page}`;
        else delete after.told[id]; // something read again: a later notice is news
        await this.keep(after);
      }
      await this.update(id, (e) => ({ ...e, account_ref: ref, other_account: false, total: (e.total ?? 0) + total.new + total.changed, last: { at, status: 'sent', brought: total.new + total.changed, result: total } }));
    } catch (e) {
      const code = e instanceof TargetError ? e.code : 'error';
      if (code === 'token_invalid') await this.forget(id, 'revoked');
      else if (code === 'disconnected') await this.forget(id, 'disconnected');
      else if (code === 'other_account') await this.update(id, (x) => ({ ...x, other_account: true, last: { at, status: 'other_account' } }));
      else await this.update(id, (x) => ({ ...x, last: { at, status: 'failed', error: code } }));
    }
  }

  // -------------------------------------------------------------------------
  // One tournament (spec 1.19.0)
  // -------------------------------------------------------------------------

  /**
   * Sends the one tournament the player took on golf.de's page to the target `id` (POST /tournament). `event` is read
   * again strictly: one that isn't dgvevent/1's is `changed_page` and goes nowhere. A token the target no longer knows,
   * or a connection the player ended there, ends the pairing as for the record.
   */
  takeEvent(id: string, event: unknown): Promise<TakeOutcome> {
    return this.serial(async () => {
      const p = (await this.pairings()).find((x) => hcpPairingId(x.base) === id);
      const name = (await this.entries()).find((e) => e.id === id)?.name ?? p?.target.name;
      if (!p) return { ok: false, error: 'no_pairing', ...(name ? { name } : {}) } as const;
      const ev = readEvent(event);
      if (!ev) return { ok: false, name: name ?? p.target.name, error: 'changed_page' } as const;
      const who = name ?? p.target.name;
      try {
        const got = await new HcpTarget(p, this.targetOpts()).tournament(eventBody(ev, { name: this.opts.name, version: this.opts.version }));
        return { ok: true, name: who, result: got.result, kept: got.kept } as const;
      } catch (e) {
        const code = e instanceof TargetError ? e.code : 'error';
        if (code === 'token_invalid') await this.forget(id, 'revoked');
        if (code === 'disconnected') await this.forget(id, 'disconnected');
        const map: Partial<Record<string, Extract<TakeOutcome, { ok: false }>['error']>> = {
          token_invalid: 'ended',
          disconnected: 'ended',
          not_offered: 'not_offered',
          account_inactive: 'account_inactive',
          rate_limited: 'rate_limited',
          calendar_full: 'calendar_full',
          too_old: 'too_old',
          too_far_ahead: 'too_far_ahead',
          invalid_event: 'refused',
          too_large: 'refused',
          wrong_token: 'refused',
          bad_request: 'refused',
          unreachable: 'unreachable',
          unavailable: 'unreachable',
        };
        const wait = e instanceof TargetError && e.code === 'rate_limited' && e.retryAfterS ? { retry_after_s: e.retryAfterS } : {};
        return { ok: false, name: who, error: map[code] ?? 'failed', ...wait } as const;
      }
    });
  }

  // -------------------------------------------------------------------------
  // What a client shows
  // -------------------------------------------------------------------------

  view(): Promise<HcpView> {
    return this.serial(async () => {
      await this.liveRun(); // a run its page left ends here, and sends what it read
      return this.viewNow();
    });
  }

  private async viewNow(): Promise<HcpView> {
    const [entries, k, s, kr] = [await this.entries(), await this.kept(), await this.session(), await this.keptRun()];
    const account = await this.accountOf(k);
    let fresh = 0;
    for (const e of entries) {
      if (e.other_account || account !== 'confirmed') continue;
      const f = this.fresh(k, await this.sent(e.id));
      fresh = Math.max(fresh, f.results.length);
    }
    const ended = await read<unknown>(this.opts.storage, ENDED, []);
    return {
      pairings: entries.map((e) => ({ ...e, host: hostOf(e.base) })),
      auto: await this.auto(),
      seen: Object.keys(k.results).length,
      fresh,
      waiting: Object.values(s.pages).some((p) => (p.pending?.length ?? 0) > 0),
      signed_out: !!k.signed_out,
      changed_page: k.changed_page === today(this.now()),
      sending: this.sending,
      ended: Array.isArray(ended) ? (ended as Farewell[]) : [],
      account,
      index: account === 'asking' && k.index ? { value: k.index.value, as_of: k.index.as_of } : null,
      fetch_all: await this.fetchAllNow(k),
      run: kr ? { ...runView(kr.run), ...(kr.auto ? { auto: true as const } : {}) } : null,
      auto_fetch: !(await this.autoState()).off,
    };
  }

  /** The player saw that a target ended the connection. */
  clearEnded(): Promise<HcpView> {
    return this.serial(async () => {
      await this.opts.storage.remove(ENDED);
      return this.viewNow();
    });
  }
}

/** A part all of one list says so; one with a result list's place, or of both lists, is `mixed`. */
function sheetOf(results: HcpResult[]): HcpBatch['sheet'] {
  if (results.some((r) => r.place !== undefined)) return 'mixed';
  const scoring = results.filter((r) => r.sd !== undefined).length;
  return scoring === 0 ? 'history' : scoring === results.length ? 'scoring' : 'mixed';
}
