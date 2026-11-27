// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The shape recorder's side in the background (the developer page, `shape.html`): starts a recording on one portal of
 * the fixed list - only with the host permission the player just gave on that page -, puts the two scripts on the
 * portal's pages while it runs (registered at run time, never across a restart of the browser), takes what they saw,
 * and stops. The recording lies in the session storage (memory only, gone with the browser); a mark in the local
 * storage says one was running, so that a recording the browser's end cut off is told as such, not as nothing.
 *
 * The browser's APIs come in as `Deps`, so every way it can fail is tested without a browser.
 */

import { calls, newRecording, observe, onPortal, portalOf, type Portal, type Recording, type Seen } from '@glmsync/shape';

export const SCRIPT_IDS = ['glmsync-shape-main', 'glmsync-shape-relay'];
const RECORDING_KEY = 'glmsync/shape';
const MARK_KEY = 'glmsync/shape-running';
/** A recording larger than this (as JSON) takes nothing more: the session storage has its limits. */
export const MAX_RECORDING_BYTES = 6_000_000;

export interface Area {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface Script {
  id: string;
  matches: string[];
  js: string[];
  runAt: 'document_start';
  allFrames: false;
  world: 'MAIN' | 'ISOLATED';
  persistAcrossSessions: false;
}

export interface Deps {
  session: Area;
  local: Area;
  hasPermission(origins: string[]): Promise<boolean>;
  registered(ids: string[]): Promise<string[]>;
  register(scripts: Script[]): Promise<void>;
  unregister(ids: string[]): Promise<void>;
  openTab(url: string): Promise<void>;
  now(): number;
}

export type ShapeError = 'unknown_portal' | 'no_permission' | 'register_failed' | 'already_recording' | 'not_recording' | 'full' | 'storage_failed';

export interface ShapeState {
  state: 'idle' | 'recording' | 'stopped' | 'interrupted';
  portal?: string;
  started?: number;
  calls?: number;
  addresses?: number;
  /** The whole recording, once stopped (for the preview). */
  recording?: Recording;
  full?: boolean;
}

interface Mark {
  portal: string;
  started: number;
}

export type Outcome = { ok: true; shape: ShapeState } | { ok: false; error: ShapeError; shape: ShapeState };

export class ShapeKeeper {
  /** One change at a time: a page's answers come in fast, and each is read, merged and written. */
  private queue: Promise<unknown> = Promise.resolve();

  /** `limit`: the most a recording may take, as JSON (smaller in tests). */
  constructor(
    private readonly d: Deps,
    private readonly limit = MAX_RECORDING_BYTES,
  ) {}

  private serial<T>(f: () => Promise<T>): Promise<T> {
    const next = this.queue.then(f, f);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async recording(): Promise<(Recording & { full?: boolean }) | null> {
    const got = await this.d.session.get(RECORDING_KEY);
    const r = got[RECORDING_KEY];
    return r && typeof r === 'object' ? (r as Recording & { full?: boolean }) : null;
  }

  private async mark(): Promise<Mark | null> {
    const got = await this.d.local.get(MARK_KEY);
    const m = got[MARK_KEY] as Mark | undefined;
    return m && typeof m.portal === 'string' && typeof m.started === 'number' ? m : null;
  }

  private stateOf(r: (Recording & { full?: boolean }) | null, mark: Mark | null): ShapeState {
    if (!r) return mark ? { state: 'interrupted', portal: mark.portal, started: mark.started } : { state: 'idle' };
    const base: ShapeState = { state: r.stopped ? 'stopped' : 'recording', portal: r.portal, started: r.started, calls: calls(r), addresses: Object.keys(r.endpoints).length };
    if (r.full) base.full = true;
    if (r.stopped) base.recording = r;
    return base;
  }

  async state(): Promise<ShapeState> {
    try {
      const r = await this.recording();
      const mark = await this.mark();
      // Recording, but its scripts are gone (the browser was closed and opened again): it was cut off.
      if (r && !r.stopped && !(await this.d.registered(SCRIPT_IDS)).length) return { state: 'interrupted', portal: r.portal, started: r.started };
      return this.stateOf(r, mark);
    } catch {
      return { state: 'idle' };
    }
  }

  start(portalId: string): Promise<Outcome> {
    return this.serial(async () => {
      const portal = portalOf(portalId);
      if (!portal) return { ok: false, error: 'unknown_portal', shape: await this.state() };
      const now = await this.state();
      if (now.state === 'recording') return { ok: false, error: 'already_recording', shape: now };
      if (!(await this.d.hasPermission(portal.matches).catch(() => false))) return { ok: false, error: 'no_permission', shape: now };
      await this.clearScripts();
      try {
        await this.d.register(scriptsFor(portal));
      } catch {
        await this.clearScripts();
        return { ok: false, error: 'register_failed', shape: await this.state() };
      }
      try {
        const started = this.d.now();
        await this.d.session.set({ [RECORDING_KEY]: newRecording(portal.id, started) });
        await this.d.local.set({ [MARK_KEY]: { portal: portal.id, started } satisfies Mark });
      } catch {
        await this.clearScripts();
        await this.d.session.remove(RECORDING_KEY).catch(() => undefined);
        await this.d.local.remove(MARK_KEY).catch(() => undefined);
        return { ok: false, error: 'storage_failed', shape: await this.state() };
      }
      // A tab of its own, so that the script is in the page before the portal's first call.
      await this.d.openTab(portal.start).catch(() => undefined);
      return { ok: true, shape: await this.state() };
    });
  }

  /** What a portal page saw. `false`: not recording (any more) - the page then stops reading along. */
  seen(seen: Seen, personal: string[], ids: string[], senderUrl: string | undefined): Promise<boolean> {
    return this.serial(async () => {
      const r = await this.recording();
      if (!r || r.stopped) return false;
      const portal = portalOf(r.portal);
      if (!portal || !onPortal(portal, senderUrl)) return false;
      if (r.full) return true;
      observe(r, seen, personal, ids);
      if (JSON.stringify(r).length > this.limit) {
        // Keep what there is; the developer page says it is full.
        const kept = await this.recording();
        if (kept) await this.d.session.set({ [RECORDING_KEY]: { ...kept, full: true } });
        return true;
      }
      await this.d.session.set({ [RECORDING_KEY]: r });
      return true;
    });
  }

  stop(): Promise<Outcome> {
    return this.serial(async () => {
      await this.clearScripts();
      await this.d.local.remove(MARK_KEY).catch(() => undefined);
      const r = await this.recording().catch(() => null);
      if (!r) return { ok: false, error: 'not_recording', shape: { state: 'idle' } };
      if (!r.stopped) {
        r.stopped = this.d.now();
        await this.d.session.set({ [RECORDING_KEY]: r });
      }
      return { ok: true, shape: this.stateOf(r, null) };
    });
  }

  discard(): Promise<Outcome> {
    return this.serial(async () => {
      await this.clearScripts();
      await this.d.session.remove(RECORDING_KEY).catch(() => undefined);
      await this.d.local.remove(MARK_KEY).catch(() => undefined);
      return { ok: true, shape: { state: 'idle' } };
    });
  }

  private async clearScripts(): Promise<void> {
    try {
      const had = await this.d.registered(SCRIPT_IDS);
      if (had.length) await this.d.unregister(had);
    } catch {
      // Nothing registered, or the browser lost them already (they never outlive its session anyway).
    }
  }
}

export function scriptsFor(portal: Portal): Script[] {
  return [
    // Before the portal's own scripts, so its first calls are seen; reads along, sends nothing.
    { id: SCRIPT_IDS[0]!, matches: portal.matches, js: ['shape-main.js'], runAt: 'document_start', allFrames: false, world: 'MAIN', persistAcrossSessions: false },
    { id: SCRIPT_IDS[1]!, matches: portal.matches, js: ['shape-relay.js'], runAt: 'document_start', allFrames: false, world: 'ISOLATED', persistAcrossSessions: false },
  ];
}
