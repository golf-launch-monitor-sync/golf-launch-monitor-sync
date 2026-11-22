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
import { batchOf, ownLine, parts, PROVIDER_ID, type Seen } from '@glmsync/provider-golfde';
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
}

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
      return { ok: true, id, name: pairing.target.name, replaced: !!old } as const;
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
      await this.saveSession(s);
      await this.keep(k);
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
      this.sending = true;
      try {
        for (const p of await this.pairings()) await this.sendOne(p);
      } finally {
        this.sending = false;
      }
      return this.viewNow();
    });
  }

  private async sendOne(p: HcpPairing): Promise<void> {
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
    const sent = await this.sent(id);
    const fresh = this.fresh(k, sent);
    const told = k.told?.[id];
    const notice: HcpBatch['notice'] | undefined =
      k.signed_out && told !== 'signed_out' ? { code: 'signed_out' } : k.changed_page && told !== `changed:${k.changed_page}` ? { code: 'changed_page' } : undefined;
    if (!fresh.results.length && !fresh.index && !notice) return;
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
      await this.update(id, (e) => ({ ...e, account_ref: ref, other_account: false, last: { at, status: 'sent', brought: total.new + total.changed, result: total } }));
    } catch (e) {
      const code = e instanceof TargetError ? e.code : 'error';
      if (code === 'token_invalid') await this.forget(id, 'revoked');
      else if (code === 'disconnected') await this.forget(id, 'disconnected');
      else if (code === 'other_account') await this.update(id, (x) => ({ ...x, other_account: true, last: { at, status: 'other_account' } }));
      else await this.update(id, (x) => ({ ...x, last: { at, status: 'failed', error: code } }));
    }
  }

  // -------------------------------------------------------------------------
  // What a client shows
  // -------------------------------------------------------------------------

  view(): Promise<HcpView> {
    return this.viewNow();
  }

  private async viewNow(): Promise<HcpView> {
    const [entries, k, s] = [await this.entries(), await this.kept(), await this.session()];
    let fresh = 0;
    for (const e of entries) {
      if (e.other_account) continue;
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
