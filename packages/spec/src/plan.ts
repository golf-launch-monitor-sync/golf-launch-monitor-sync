// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Two of the reference planning rules (spec/planning.md) for a target written in TypeScript (the file target): how far
 * back a first sync asks, and how many new sessions a plan lets the client fetch (since 1.23.0). As the reference
 * (spec/reference/plan.py) and its vectors (plan.json) say.
 */

import rules from '../../../spec/plan/rules.json' with { type: 'json' };
import type { Reason } from './olmd.ts';

const DAY = 86_400_000;

/** Days back for a first sync: to 1 October of the previous year (UTC) with the usual slack, within 90 and 400. */
export function firstDays(nowMs: number): number {
  const t = new Date(nowMs);
  const start = Date.UTC(t.getUTCFullYear() - 1, rules.first_season_month - 1, 1);
  const days = Math.floor((nowMs - start) / DAY) + rules.window_slack_days;
  return Math.max(rules.recent_days, Math.min(rules.first_max_days, days));
}

/** New sessions a plan allows: a history chunk's, fewer for a first sync (room in the run for the scorecards), else 40. */
export function maxSessions(lastSyncAt: string | null | undefined, reason: Reason): number {
  if (reason === 'backfill') return rules.history_chunk_sessions;
  const last = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  return Number.isNaN(last) ? rules.first_max_sessions : rules.sync_max_sessions;
}
