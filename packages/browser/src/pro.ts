// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * A professional's own pages (spec/prores.md): the pairings with targets of kind `pro`, and sending a page the player
 * read on their tap (`send`). The extension's background holds one.
 *
 * Nothing here asks a ranking's site anything: a page arrives already read, as the page showed it in the player's tab
 * (`@glmsync/provider-rankings`, `@glmsync/provider-tours`), and is read again strictly here. Every batch goes through the target's plan
 * (`manual`: the player tapped) and is one page.
 *
 * Whose page it is: the target compares the page's name with the player's and answers `other_player` when they
 * differ. Then the question waits here (`question`) for the player's answer in the extension's own page - never on the
 * site's page, whose scripts reach it - and a yes sends the page again, marked confirmed; a page the player said is
 * theirs is sent confirmed from then on.
 *
 * What it keeps: in the **vault** the pairings with their import tokens; in **storage** what each target last answered,
 * the pages said to be the player's (fingerprints, never the site's id of them) and the open question with its page.
 * Every method is serialised, and nothing throws at the caller for what can happen: that is a state to show.
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
  type HcpPairing,
  type Storage,
} from '@glmsync/core';
import type { ProSite } from '@glmsync/spec';
import { checkProPage, proBatchOf, proSubjectOf, siteNameOf, type AnyProPage } from './proPages.ts';
import { PRO_PROVIDER } from '@glmsync/spec';
import type { Farewell, PairOutcome } from './client.ts';

const PAIRINGS = 'glmsync/pro/pairings';
const ENTRIES = 'glmsync/pro/entries';
const ENDED = 'glmsync/pro/ended';
const CONFIRMED = 'glmsync/pro/confirmed';
const QUESTION = 'glmsync/pro/question';
const MAX_FAREWELLS = 5;
const MAX_CONFIRMED = 20;
/** A question nobody answered is dropped after a day: the player taps *Send* again to be asked again. */
const QUESTION_MS = 24 * 3600_000;

export interface ProClientOptions {
  storage: Storage;
  vault: Storage;
  kind: ClientKind;
  name: string;
  version: string;
  fetch?: FetchLike;
  now?: () => number;
}

export interface ProLast {
  at: string;
  site: ProSite;
  /**
   * `sent`; `not_due`: the app wanted nothing just now (or another device of the player was sending); `other_player`:
   * the page names someone else - the player is asked; `rejected`: the player said it isn't theirs; `other_account`:
   * another page of this ranking is connected; `failed`.
   */
  status: 'sent' | 'not_due' | 'other_player' | 'rejected' | 'other_account' | 'failed';
  /** Tournaments of the page that went. */
  tournaments?: number;
  error?: string;
}

export interface ProEntry {
  id: string;
  base: string;
  name: string;
  paired_at: string;
  last?: ProLast;
}

/** The open question: a page whose name a target didn't find to be the player's. */
export interface ProQuestion {
  site: ProSite;
  /** The site as the player calls it. */
  siteName: string;
  /** The name the page writes. */
  name: string;
  /** The apps that asked. */
  targets: string[];
  at: string;
}

export interface ProView {
  pairings: (ProEntry & { host: string })[];
  ended: Farewell[];
  question: ProQuestion | null;
}

interface Waiting {
  page: AnyProPage;
  targets: string[];
  at: number;
}

const hostOf = (base: string) => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

/** A pro pairing's id: stable per target address, never the same as a handicap record's or a launch monitor's. */
export function proPairingId(base: string): string {
  return base64url(sha256(utf8(`glmsync-pro-pairing|${base.replace(/\/+$/, '')}`))).slice(0, 16);
}

/** What is kept of a page the player said is theirs: a fingerprint of its site and id. */
const pagePrint = (page: Pick<AnyProPage, 'site' | 'id'>) => base64url(sha256(utf8(`glmsync-pro-page|${proSubjectOf(page)}`))).slice(0, 22);

async function read<T>(s: Storage, key: string, fallback: T): Promise<T> {
  try {
    const raw = await s.get(key);
    const v = raw === null ? null : (JSON.parse(raw) as unknown);
    return v === null || typeof v !== 'object' ? fallback : (v as T);
  } catch {
    return fallback; // unreadable: start afresh rather than stop working
  }
}

export class ProClient {
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ProClientOptions) {
    this.now = opts.now ?? Date.now;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async pairings(): Promise<HcpPairing[]> {
    const v = await read<unknown>(this.opts.vault, PAIRINGS, []);
    return Array.isArray(v) ? (v as HcpPairing[]).filter((p) => p && typeof p.base === 'string' && typeof p.token === 'string') : [];
  }

  private async entries(): Promise<ProEntry[]> {
    const v = await read<unknown>(this.opts.storage, ENTRIES, []);
    return Array.isArray(v) ? (v as ProEntry[]) : [];
  }

  private async saveEntries(list: ProEntry[]): Promise<void> {
    await this.opts.storage.set(ENTRIES, JSON.stringify(list));
  }

  private async setLast(id: string, last: ProLast): Promise<void> {
    await this.saveEntries((await this.entries()).map((e) => (e.id === id ? { ...e, last } : e)));
  }

  private async confirmed(): Promise<string[]> {
    const v = await read<unknown>(this.opts.storage, CONFIRMED, []);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  }

  private async waiting(): Promise<Waiting | null> {
    const w = await read<Partial<Waiting> | null>(this.opts.storage, QUESTION, null);
    const page = checkProPage(w?.page);
    if (!w || !page || typeof w.at !== 'number' || this.now() - w.at > QUESTION_MS) return null;
    return { page, targets: Array.isArray(w.targets) ? w.targets.filter((t): t is string => typeof t === 'string') : [], at: w.at };
  }

  private async forget(id: string, why: Farewell['why']): Promise<void> {
    const entry = (await this.entries()).find((e) => e.id === id);
    await this.opts.vault.set(PAIRINGS, JSON.stringify((await this.pairings()).filter((p) => proPairingId(p.base) !== id)));
    await this.saveEntries((await this.entries()).filter((e) => e.id !== id));
    if (entry) {
      const list = await read<unknown>(this.opts.storage, ENDED, []);
      const ended = Array.isArray(list) ? (list as Farewell[]) : [];
      await this.opts.storage.set(ENDED, JSON.stringify([...ended, { name: entry.name, at: new Date(this.now()).toISOString(), why }].slice(-MAX_FAREWELLS)));
    }
  }

  private targetOpts(): { fetch?: FetchLike; now: () => number } {
    return { ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}), now: this.now };
  }

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  /** POST /pair of a target of kind `pro`; pairing the same target again replaces the old pairing (and ends its token). */
  offerPairing(offer: { target: string; code: string; provider?: string }): Promise<PairOutcome> {
    return this.serial(async () => {
      if (offer.provider && offer.provider !== PRO_PROVIDER) return { ok: false, error: 'provider' } as const;
      let pairing: HcpPairing;
      try {
        pairing = await pairHcp({
          target: offer.target,
          code: offer.code,
          provider: PRO_PROVIDER,
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
      const id = proPairingId(pairing.base);
      const old = (await this.pairings()).find((p) => proPairingId(p.base) === id);
      if (old) await new HcpTarget(old, this.targetOpts()).revoke().catch(() => undefined);
      await this.opts.vault.set(PAIRINGS, JSON.stringify([...(await this.pairings()).filter((p) => proPairingId(p.base) !== id), pairing]));
      await this.saveEntries([...(await this.entries()).filter((e) => e.id !== id), { id, base: pairing.base, name: pairing.target.name, paired_at: pairing.paired_at }]);
      return { ok: true, id, name: pairing.target.name, replaced: !!old } as const;
    });
  }

  /** The player ends a pairing here: the target is told (its token revoked), whatever it answers. */
  removePairing(id: string): Promise<ProView> {
    return this.serial(async () => {
      const p = (await this.pairings()).find((x) => proPairingId(x.base) === id);
      if (p) await new HcpTarget(p, this.targetOpts()).revoke().catch(() => undefined);
      await this.opts.vault.set(PAIRINGS, JSON.stringify((await this.pairings()).filter((x) => proPairingId(x.base) !== id)));
      await this.saveEntries((await this.entries()).filter((e) => e.id !== id));
      return this.viewNow();
    });
  }

  clearEnded(): Promise<ProView> {
    return this.serial(async () => {
      await this.opts.storage.remove(ENDED);
      return this.viewNow();
    });
  }

  // -------------------------------------------------------------------------
  // Sending a page
  // -------------------------------------------------------------------------

  /**
   * A page the player tapped *Send* on, to every app paired for it (each after its plan). `raw` is read again strictly;
   * a page that isn't one sends nothing.
   */
  send(raw: unknown): Promise<ProView> {
    return this.serial(async () => {
      const page = checkProPage(raw);
      if (!page) return this.viewNow();
      const confirmed = (await this.confirmed()).includes(pagePrint(page));
      const asking: string[] = [];
      for (const p of await this.pairings()) {
        const id = proPairingId(p.base);
        if (await this.sendTo(p, page, confirmed)) asking.push(id);
      }
      if (asking.length) await this.opts.storage.set(QUESTION, JSON.stringify({ page, targets: asking, at: this.now() } satisfies Waiting));
      else {
        const w = await this.waiting();
        // A page that went where it was asked about answers that question.
        if (w && proSubjectOf(w.page) === proSubjectOf(page)) await this.opts.storage.remove(QUESTION);
      }
      return this.viewNow();
    });
  }

  /** The player's answer to "Is this page yours?": a yes sends it again, confirmed, to the apps that asked. */
  answer(yes: boolean): Promise<ProView> {
    return this.serial(async () => {
      const w = await this.waiting();
      await this.opts.storage.remove(QUESTION);
      if (!w) return this.viewNow();
      if (!yes) {
        for (const id of w.targets) await this.setLast(id, { at: new Date(this.now()).toISOString(), site: w.page.site, status: 'rejected' });
        return this.viewNow();
      }
      const print = pagePrint(w.page);
      const list = (await this.confirmed()).filter((x) => x !== print);
      await this.opts.storage.set(CONFIRMED, JSON.stringify([...list, print].slice(-MAX_CONFIRMED)));
      for (const p of await this.pairings()) {
        if (w.targets.includes(proPairingId(p.base))) await this.sendTo(p, w.page, true);
      }
      return this.viewNow();
    });
  }

  /** One page to one app, after its plan. True: the app asks whether the page is the player's. */
  private async sendTo(p: HcpPairing, page: AnyProPage, confirmed: boolean): Promise<boolean> {
    const id = proPairingId(p.base);
    const at = new Date(this.now()).toISOString();
    const target = new HcpTarget(p, this.targetOpts());
    try {
      const plan = await target.plan('manual', this.opts.kind);
      if (plan.disconnected) {
        await this.forget(id, 'disconnected');
        return false;
      }
      if (!plan.due) {
        await this.setLast(id, { at, site: page.site, status: 'not_due' });
        return false;
      }
      const batch = proBatchOf(page, {
        account_ref: accountRefOf(p.account_salt, PRO_PROVIDER, proSubjectOf(page)),
        generated_at: at,
        generator: { name: this.opts.name, version: this.opts.version },
        ...(plan.plan_id ? { plan_id: plan.plan_id } : {}),
        reason: 'manual',
        confirmed,
      });
      await target.import(batch);
      await this.setLast(id, { at, site: page.site, status: 'sent', tournaments: batch.tournaments?.length ?? 0 });
      return false;
    } catch (e) {
      const code = e instanceof TargetError ? e.code : 'error';
      if (code === 'token_invalid') await this.forget(id, 'revoked');
      else if (code === 'disconnected') await this.forget(id, 'disconnected');
      else if (code === 'other_player' && !confirmed) {
        await this.setLast(id, { at, site: page.site, status: 'other_player' });
        return true;
      } else if (code === 'other_account') await this.setLast(id, { at, site: page.site, status: 'other_account' });
      else await this.setLast(id, { at, site: page.site, status: 'failed', error: code });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // What it shows
  // -------------------------------------------------------------------------

  view(): Promise<ProView> {
    return this.serial(() => this.viewNow());
  }

  private async viewNow(): Promise<ProView> {
    const entries = await this.entries();
    const ids = new Set((await this.pairings()).map((p) => proPairingId(p.base)));
    const list = await read<unknown>(this.opts.storage, ENDED, []);
    const w = await this.waiting();
    const names = new Map(entries.map((e) => [e.id, e.name]));
    return {
      pairings: entries.filter((e) => ids.has(e.id)).map((e) => ({ ...e, host: hostOf(e.base) })),
      ended: Array.isArray(list) ? (list as Farewell[]) : [],
      question: w
        ? {
            site: w.page.site,
            siteName: siteNameOf(w.page.site),
            name: w.page.name,
            targets: w.targets.map((t) => names.get(t)).filter((n): n is string => !!n),
            at: new Date(w.at).toISOString(),
          }
        : null,
    };
  }
}
