// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the extension's parts say to its background. Every message is checked against who sent it:
 * the portal's key only from a content script on the portal, a pairing offer only from the web app's
 * pairing page, a bridge request only from a page's top frame, what golf.de's page showed only from a content script
 * on golf.de, everything else only from the extension's own pages.
 */

import type { ClientStatus, HcpView, PairOutcome, TestOutcome } from '@glmsync/browser';
import type { GuardLogExport } from '@glmsync/core';
import type { BridgeReply, BridgeRequest } from '@glmsync/spec';

export type FromPortal = { type: 'portal-key'; token: string };
/** From the bridge on a paired target's page (spec/page-bridge.md); the request as read from the page. */
export type FromTargetPage = { type: 'bridge'; request: BridgeRequest };
export type FromPairPage = { type: 'pair-offer'; fragment: string } | { type: 'pair-status' };
/** From golfde-relay.ts on golf.de's page: what it showed (read again strictly here), the line, *Send*. */
export type FromGolfde = { type: 'golfde-seen'; page: string; seen: unknown } | { type: 'golfde-line' } | { type: 'golfde-send' };
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
  | { type: 'switch-account' }
  | { type: 'pending' }
  | { type: 'pair-confirm' }
  | { type: 'pair-cancel' }
  /** Test mode (spec/test-mode.md): a test code typed for a pairing, the answer to its question, its end. */
  | { type: 'test-fetch'; code: string; id?: string }
  | { type: 'test-confirm'; yes: boolean }
  | { type: 'test-end'; id: string }
  | { type: 'hcp-status' }
  | { type: 'hcp-send' }
  | { type: 'hcp-auto'; auto: boolean }
  | { type: 'hcp-unpair'; id: string }
  | { type: 'hcp-clear-ended' }
  | { type: 'open-golfde' };

export type Message = FromPortal | FromPairPage | FromTargetPage | FromGolfde | FromPage;

/** A pairing offered by the web app's page, waiting for the player's yes in the connect window. */
export interface Pending {
  target: string;
  host: string;
  code: string;
  provider?: string;
  /** Which target API (1.10.0): `hcp` for the handicap record read along on golf.de; none: launch monitor data. */
  kind?: 'lm' | 'hcp';
  at: number;
  state: 'asking' | 'working' | 'paired' | 'failed' | 'cancelled';
  name?: string;
  error?: Extract<PairOutcome, { ok: false }>['error'] | 'denied';
}

export type Reply =
  | { ok: true; status?: ClientStatus; pending?: Pending | null; log?: GuardLogExport; bridge?: BridgeReply; test?: TestOutcome; hcp?: HcpView }
  | { ok: false; error: string };

/** What the pairing page's content script hands on to the page (no code, nothing secret). */
export interface PairPageState {
  state: 'asking' | 'working' | 'paired' | 'failed' | 'cancelled' | 'gone';
  name?: string;
  error?: string;
}
