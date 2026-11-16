// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the extension's parts say to its background. Every message is checked against who sent it:
 * the portal's key only from a content script on the portal, a pairing offer only from the web app's
 * pairing page, everything else only from the extension's own pages.
 */

import type { ClientStatus, PairOutcome } from '@glmsync/browser';
import type { GuardLogExport } from '@glmsync/core';

export type FromPortal = { type: 'portal-key'; token: string };
export type FromPairPage = { type: 'pair-offer'; fragment: string } | { type: 'pair-status' };
export type FromPage =
  | { type: 'status' }
  | { type: 'run'; id?: string }
  | { type: 'confirm'; yes: boolean }
  | { type: 'retry-who' }
  | { type: 'unpair'; id: string }
  | { type: 'export-log' }
  | { type: 'clear-ended' }
  | { type: 'forget-key' }
  | { type: 'open-portal' }
  | { type: 'pending' }
  | { type: 'pair-confirm' }
  | { type: 'pair-cancel' };

export type Message = FromPortal | FromPairPage | FromPage;

/** A pairing offered by the web app's page, waiting for the player's yes in the connect window. */
export interface Pending {
  target: string;
  host: string;
  code: string;
  provider?: string;
  at: number;
  state: 'asking' | 'working' | 'paired' | 'failed' | 'cancelled';
  name?: string;
  error?: Extract<PairOutcome, { ok: false }>['error'] | 'denied';
}

export type Reply =
  | { ok: true; status?: ClientStatus; pending?: Pending | null; log?: GuardLogExport }
  | { ok: false; error: string };

/** What the pairing page's content script hands on to the page (no code, nothing secret). */
export interface PairPageState {
  state: 'asking' | 'working' | 'paired' | 'failed' | 'cancelled' | 'gone';
  name?: string;
  error?: string;
}
