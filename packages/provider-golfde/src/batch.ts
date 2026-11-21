// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** dgvhcp/1 batches of what was seen on golf.de's pages (spec/hcp.md), cut to a target's limits. */

import type { HcpBatch, HcpLimits, HcpResult } from '@glmsync/core';
import type { Reason } from '@glmsync/spec';

export const PROVIDER_ID = 'golfde';
export const PROVIDER_NAME = 'golf.de';

export interface BatchOptions {
  account_ref: string;
  sheet: HcpBatch['sheet'];
  results: HcpResult[];
  now: number;
  generator: { name: string; version?: string };
  plan?: { plan_id?: string; reason: Reason };
  index?: HcpBatch['index'];
  notice?: HcpBatch['notice'];
}

export function batchOf(o: BatchOptions): HcpBatch {
  const b: HcpBatch = {
    format: 'dgvhcp/1',
    provider: PROVIDER_ID,
    account_ref: o.account_ref,
    generated_at: new Date(o.now).toISOString(),
    generator: o.generator,
    sheet: o.sheet,
    results: o.results,
  };
  if (o.plan) b.sync = { ...(o.plan.plan_id ? { plan_id: o.plan.plan_id } : {}), reason: o.plan.reason };
  if (o.index) b.index = o.index;
  if (o.notice) b.notice = o.notice;
  return b;
}

const size = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Results in parts that each fit the target's limits (`max_results`, and `max_bytes` with room for the batch's own
 * frame). A result too large on its own for any batch can't be sent and is left out (none is anywhere near).
 */
export function parts(results: HcpResult[], limits: HcpLimits, frame = 2048): HcpResult[][] {
  const out: HcpResult[][] = [];
  let cur: HcpResult[] = [];
  let bytes = frame;
  for (const r of results) {
    const n = size(r) + 1;
    if (n + frame > limits.max_bytes) continue;
    if (cur.length && (cur.length >= limits.max_results || bytes + n > limits.max_bytes)) {
      out.push(cur);
      cur = [];
      bytes = frame;
    }
    cur.push(r);
    bytes += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
