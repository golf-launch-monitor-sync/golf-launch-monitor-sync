// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/** A page read (read.ts) as one prores/1 batch (spec/prores.md): one page a batch, no rounds (a world ranking has none). */

import { PRO_PROVIDER, PRORES_FORMAT, type ProresBatch, type Reason } from '@glmsync/spec';
import type { ProPage } from './read.ts';

export interface BatchOptions {
  /** The account_ref rule (spec/olmd.md) with provider `pro` over `<site>:<id>` and the pairing's salt. */
  account_ref: string;
  generated_at: string;
  generator: { name: string; version?: string };
  plan_id?: string;
  reason?: Reason;
  /** The player said the page is theirs although the target found another name (`other_player`). */
  confirmed?: boolean;
}

/** The subject of a page's account_ref: the site and its id of the player. */
export function subjectOf(page: Pick<ProPage, 'site' | 'id'>): string {
  return `${page.site}:${page.id}`;
}

export function batchOf(page: ProPage, o: BatchOptions): ProresBatch {
  const b: ProresBatch = {
    format: PRORES_FORMAT,
    provider: PRO_PROVIDER,
    site: page.site,
    account_ref: o.account_ref,
    generated_at: o.generated_at,
    generator: o.generator,
    player: o.confirmed ? { name: page.name, confirmed: true } : { name: page.name },
    rankings: [page.ranking],
  };
  if (o.plan_id || o.reason) b.sync = { ...(o.plan_id ? { plan_id: o.plan_id } : {}), ...(o.reason ? { reason: o.reason } : {}) };
  if (page.tournaments?.length) b.tournaments = page.tournaments;
  return b;
}
