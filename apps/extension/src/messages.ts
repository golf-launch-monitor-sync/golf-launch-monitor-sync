// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * What the extension's parts say to its background. Every message is checked against who sent it:
 * the portal's key only from a content script on the portal, a pairing offer only from the web app's
 * pairing page, a bridge request only from a page's top frame, what golf.de's page showed only from a content script
 * on golf.de, everything else only from the extension's own pages.
 */

import type { ClientStatus, HcpView, PairOutcome, ProView, TestOutcome } from '@glmsync/browser';
import type { GuardLogExport } from '@glmsync/core';
import type { Step } from '@glmsync/provider-golfde';
import type { BridgeReply, BridgeRequest } from '@glmsync/spec';

export type FromPortal = { type: 'portal-key'; token: string };
/** From the bridge on a paired target's page (spec/page-bridge.md); the request as read from the page. */
export type FromTargetPage = { type: 'bridge'; request: BridgeRequest };
export type FromPairPage = { type: 'pair-offer'; fragment: string } | { type: 'pair-status' };
/**
 * From golfde-relay.ts on golf.de's page: what it showed (read again strictly here), the line, *Send*, and *Confirm*,
 * which only brings the connect window to the front - the yes itself is given there, in the extension's own page,
 * never on golf.de's (whose scripts reach the line).
 */
export type FromGolfde =
  | { type: 'golfde-seen'; page: string; seen: unknown }
  | { type: 'golfde-line' }
  | { type: 'golfde-send' }
  | { type: 'golfde-confirm' }
  /** *Fetch all* tapped on the line; the tab that tapped drives the run (spec/hcp.md, clicking for the player). */
  | { type: 'golfde-fetch-all' }
  /** The tab asks for the run's next step (only the tab that started it gets one). */
  | { type: 'golfde-step' }
  /** *Stop* on the line. */
  | { type: 'golfde-stop' };
/**
 * From rankings-content.ts on a player's own page of a world ranking (spec/prores.md): the line, *Send* with the page
 * as it showed it (read again strictly by the background), and *Answer*, which only brings the extension's own page to
 * the front - the answer whether the page is the player's is given there, never on the site's page.
 */
export type FromRanking =
  | { type: 'ranking-line'; site: 'owgr' | 'rolex' }
  | { type: 'ranking-send'; page: object }
  | { type: 'ranking-answer' };
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
  /** The yes to an app's pairing, with the service chosen (step 1, the tap that is the yes): the offer's own, or this one when it named none. */
  | { type: 'pair-confirm'; provider?: string }
  /** *Connect new* in the popup: the connect window, at its first step. */
  | { type: 'open-connect' }
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
  /** The answer to "Is this your golf.de account?" (the connect window, the popup). */
  | { type: 'hcp-confirm'; yes: boolean }
  | { type: 'open-golfde' }
  | { type: 'pro-status' }
  /** The answer to "Is this page yours?" (the connect window, the popup). */
  | { type: 'pro-answer'; yes: boolean }
  | { type: 'pro-unpair'; id: string }
  | { type: 'pro-clear-ended' }
  /** Where the player finds their page: the site's own ranking (it has a search). */
  | { type: 'open-ranking'; site: 'owgr' | 'rolex' };

export type Message = FromPortal | FromPairPage | FromTargetPage | FromGolfde | FromRanking | FromPage;

/** A pairing offered by the web app's page, waiting for the player's yes in the connect window. */
export interface Pending {
  target: string;
  host: string;
  code: string;
  provider?: string;
  /** Which target API (1.10.0): `hcp` for the handicap record read along on golf.de, `pro` (1.15.0) for a pro's world
   * ranking pages; none: launch monitor data. */
  kind?: 'lm' | 'hcp' | 'pro';
  at: number;
  state: 'asking' | 'working' | 'paired' | 'failed' | 'cancelled';
  name?: string;
  error?: Extract<PairOutcome, { ok: false }>['error'] | 'denied';
}

export type Reply =
  | { ok: true; status?: ClientStatus; pending?: Pending | null; log?: GuardLogExport; bridge?: BridgeReply; test?: TestOutcome; hcp?: HcpView; step?: Step; pro?: ProView }
  | { ok: false; error: string };

/** What the pairing page's content script hands on to the page (no code, nothing secret). */
export interface PairPageState {
  state: 'asking' | 'working' | 'paired' | 'failed' | 'cancelled' | 'gone';
  name?: string;
  error?: string;
}
