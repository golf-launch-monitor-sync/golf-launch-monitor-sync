// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the tour window does on the Ladies European Tour and the LET Access Series (`ocs`; spec/prores.md), without the
 * window: the extension's way there (apps/extension/src/ocs-content.ts) on the phone.
 *
 * - Her profile is read once it has loaded (her results of the season shown, every round with them) and kept
 *   (`OcsKeeper`, `@glmsync/browser/ocs`, shared with the extension).
 * - On the tour's Order of Merit, once a profile of this tour was read, only her own line is read, by that profile's id;
 *   it goes with the next *Send* of that season.
 * - *Send* (on her profile, or on the Order of Merit once a profile was read) reads the page once more and sends her
 *   profile with her rank to every connected app, each after its plan (`ProClient`).
 *
 * Both sites change their address without loading a page; the window tells every move (`moved`, `loaded`), whether the
 * web view saw it or the page script did. Nothing is read without a connection for a pro's pages (as the extension's
 * content script reads nothing then), nothing while the window is closed, and the site is asked nothing. Every keeper
 * call runs one after the other, and no failure is left uncaught: on her tap it becomes the bar's `error`; a read of
 * its own that fails says nothing (only a page the module doesn't know, as the extension's line does).
 */

import type { OcsKeeper, OcsView } from '@glmsync/browser/ocs';
import type { ProView } from '@glmsync/browser/pro';
import type { LinePhase } from '@glmsync/browser/proView';
import type { ocs } from '@glmsync/provider-tours';
import { ocsProfileUrl, onOcsOom, onOcsProfile, type TourAnswer } from './toursPage.ts';

/** What the bar adds to the extension's line, as the extension's line does (`ocsLine.*`). */
export type OcsNote = { kind: 'noResults' } | { kind: 'oomRead'; rank: number } | { kind: 'oomMissing' };

export interface OcsState {
  view: ProView | null;
  /** The connections couldn't be read: the window says so, with *Load again*. */
  unread: boolean;
  ocs: OcsView | null;
  phase: LinePhase;
  note: OcsNote | null;
}

export interface OcsSessionDeps {
  site: ocs.OcsTourSite;
  keeper: Pick<OcsKeeper, 'view' | 'seen' | 'page'>;
  pro: { view(): Promise<ProView>; send(raw: unknown): Promise<ProView>; answer(yes: boolean): Promise<ProView> };
  lastPage: { set(url: string): Promise<void> };
  /** Ask the page script for a read of the page the window shows (`who`: the profile's id, on the Order of Merit); null when no answer came. */
  read(who: string | null): Promise<TourAnswer | null>;
  /** The player's day, on this phone's clock. */
  today(): string;
  onChange(state: OcsState): void;
}

export class OcsSession {
  private state: OcsState = { view: null, unread: false, ocs: null, phase: 'ready', note: null };
  private chain: Promise<unknown> = Promise.resolve();
  private reading = false;
  private closed = false;
  /** The address of the page shown now (the window tells every move). */
  private shown: string | null = null;

  constructor(private readonly d: OcsSessionDeps) {}

  get now(): OcsState {
    return this.state;
  }

  private set(part: Partial<OcsState>): void {
    this.state = { ...this.state, ...part };
    if (!this.closed) this.d.onChange(this.state);
  }

  /** One keeper step after the other; a failure doesn't stop the ones after it. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => undefined);
    return p;
  }

  private get connected(): boolean {
    return !!this.state.view?.pairings.length;
  }

  /** A page of this tour the window reads: her profile, or the Order of Merit once her profile was read. */
  private readable(url: string): boolean {
    return onOcsProfile(url) || (onOcsOom(url) && !!this.state.ocs?.who);
  }

  /** The window opened: what is connected and what was kept. */
  async start(): Promise<void> {
    await this.loadView();
    try {
      const kept = await this.serial(() => this.d.keeper.view(this.d.site));
      this.set({ ocs: kept });
    } catch {
      this.set({ ocs: null }); // unreadable: the next read starts it afresh
    }
    // A page that loaded while the connections were still being read is read now.
    if (this.shown) void this.loaded(this.shown);
  }

  async loadView(): Promise<void> {
    try {
      this.set({ view: await this.d.pro.view(), unread: false });
    } catch {
      this.set({ unread: true });
    }
  }

  /** The window shows another page: whatever the bar said of the last one is over. */
  moved(url: string): void {
    this.shown = url;
    this.set(this.state.phase === 'reading' ? { note: null } : { phase: 'ready', note: null });
  }

  /**
   * Reads the page the window shows and keeps what is hers. `mine`: her tap - a failure says so on the bar; otherwise
   * only a page the module doesn't know does. True when something can go: her profile read, or on the Order of Merit
   * (whatever its line said) the profile read before.
   */
  private async readNow(url: string, mine: boolean): Promise<boolean> {
    const oom = onOcsOom(url);
    const who = oom ? (this.state.ocs?.who?.id ?? null) : null;
    if (oom && !who) return false;
    const a = await this.d.read(who);
    if (!a) {
      if (mine && !oom) this.set({ phase: 'error' });
      return oom;
    }
    if (!a.ok) {
      if (a.why === 'changed_page') this.set({ phase: 'changed_page' });
      else if (mine) this.set({ phase: 'ready' });
      return oom;
    }
    if ('ocsUnread' in a) {
      if (a.ocsUnread === 'no_result') this.set({ note: { kind: 'noResults' }, ...(this.state.phase === 'changed_page' ? { phase: 'ready' } : {}) });
      else if (a.ocsUnread === 'not_him') this.set({ note: { kind: 'oomMissing' } });
      else this.set({ phase: 'changed_page' });
      return oom;
    }
    if (!('ocs' in a)) {
      if (mine) this.set({ phase: 'error' });
      return oom;
    }
    const seen = a.ocs;
    const kept = await this.serial(() => this.d.keeper.seen(this.d.site, seen.kind === 'profile' ? { profile: seen } : { oom: seen }));
    const note: OcsNote | null = seen.kind === 'oom' && seen.rank !== undefined ? { kind: 'oomRead', rank: seen.rank } : null;
    this.set(this.state.phase === 'changed_page' ? { ocs: kept, note, phase: 'ready' } : { ocs: kept, note });
    return true;
  }

  /** The window finished loading `url`, or the site changed its address to it: a page of hers is read as it shows. */
  async loaded(url: string): Promise<void> {
    this.shown = url;
    if (this.closed || this.reading || !this.connected || !this.readable(url)) return;
    this.reading = true;
    try {
      await this.readNow(url, false);
    } catch {
      // Kept as it was; *Send* reads the page again.
    } finally {
      this.reading = false;
    }
  }

  /** Her tap on *Send*, on her profile or the Order of Merit: read it once more, then her profile with her rank to every connected app. */
  async send(url: string): Promise<void> {
    if (this.reading || !this.readable(url)) return;
    this.reading = true;
    this.set({ phase: 'reading', note: null });
    try {
      if (!(await this.readNow(url, true))) {
        if (this.state.phase === 'reading') this.set({ phase: 'ready' });
        return;
      }
      const page = await this.serial(() => this.d.keeper.page(this.d.site, this.d.today()));
      if (!page) {
        this.set({ phase: 'ready' });
        return;
      }
      const view = await this.d.pro.send(page);
      this.set({ view, phase: 'done' });
      // The window opens on her profile next time (from the Order of Merit too).
      const profile = onOcsProfile(url) ? url : ocsProfileUrl(this.d.site, page.id);
      if (profile) await this.d.lastPage.set(profile).catch(() => undefined);
    } catch {
      this.set({ phase: 'error' });
    } finally {
      this.reading = false;
    }
  }

  /** Her answer to *Is this page yours?*. */
  async answer(yes: boolean): Promise<void> {
    try {
      this.set({ view: await this.d.pro.answer(yes), phase: 'done' });
    } catch {
      this.set({ phase: 'error' });
    }
  }

  /** The window closes: what was read stays kept for the next *Send*. */
  close(): void {
    this.closed = true;
  }
}
