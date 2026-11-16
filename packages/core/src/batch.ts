// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Making a batch fit to send: checked against the schema with one bad value costing that value,
 * not the batch (`clean`), and cut into parts the target takes (`split`).
 */

import { validateBatch, type Batch, type Round, type Session } from '@glmsync/spec';
import type { ImportLimits } from './api.ts';
import { InvalidBatchError } from './errors.ts';
import { utf8Length } from './sha256.ts';

type Obj = Record<string, unknown>;
const GROUPS = new Set(['ball', 'club_delivery', 'flight', 'target', 'location', 'stats']);
const OPTIONAL_TOP = new Set(['generator', 'sync', 'failed', 'progress', 'notice', 'extra']);

/**
 * The batch, valid: what the schema refuses is dropped at the smallest place it can be - a value of
 * a shot, a shot, a hole, a round's shots, a round, a session (which then counts as failed, so the
 * target asks for it again) - and `dropped` says how many places. Only a batch whose head is wrong
 * (a bug, not the provider's data) throws `InvalidBatchError`.
 */
export function clean(input: Batch): { batch: Batch; dropped: number } {
  const batch = JSON.parse(JSON.stringify(input)) as Batch;
  let dropped = 0;
  for (let pass = 0; pass < 6; pass++) {
    const v = validateBatch(batch);
    if (v.ok) return { batch, dropped };
    const gone = new Set<unknown>();
    const failed: { external_id: string; started_at?: string }[] = [];
    for (const err of v.errors) {
      const p = err.path.split('/').slice(1);
      const at = (n: number): unknown => {
        let x: unknown = batch;
        for (const k of p.slice(0, n)) x = (x as Obj | undefined)?.[k];
        return x;
      };
      const [top, i, sub, k, group, field] = p;
      if (top === 'sessions' && i !== undefined) {
        const s = at(2) as Session | undefined;
        if (sub === 'shots' && k !== undefined && group !== undefined && GROUPS.has(group) && field !== undefined) {
          const g = at(5) as Obj | undefined;
          if (g && typeof g === 'object') delete g[field];
        } else if (sub === 'shots' && k !== undefined) gone.add(at(4));
        else if (sub === 'location' || sub === 'kind_raw' || sub === 'extra' || sub === 'started_at' || sub === 'device') {
          if (s) delete (s as unknown as Obj)[sub];
        } else if (s) {
          gone.add(s);
          if (typeof s.external_id === 'string' && s.external_id && s.external_id.length <= 400) failed.push({ external_id: s.external_id });
        }
      } else if (top === 'rounds' && i !== undefined) {
        const r = at(2) as Round | undefined;
        if (sub === 'shots' && k !== undefined && group !== undefined && group !== 'hole' && group !== 'number') {
          const shot = at(4) as Obj | undefined;
          if (shot) delete shot[group];
        } else if (sub === 'shots' && k !== undefined) gone.add(at(4));
        else if (sub === 'shots' && r) delete r.shots; // not sent: the target may ask for them again
        else if (sub === 'holes' && k !== undefined) gone.add(at(4));
        else if (sub === 'stats' && k !== undefined && r?.stats) delete (r.stats as Obj)[k];
        else if (sub !== undefined && sub !== 'external_id' && r) delete (r as unknown as Obj)[sub];
        else if (r) gone.add(r);
      } else if (top === 'failed' && i !== undefined) gone.add(at(2));
      else if (top !== undefined && OPTIONAL_TOP.has(top)) delete (batch as unknown as Obj)[top];
      else throw new InvalidBatchError(`Not an olmd/1 batch: ${err.path} ${err.message}`);
      dropped += 1;
    }
    const keep = <T>(xs: T[] | undefined) => (xs ?? []).filter((x) => !gone.has(x));
    batch.sessions = keep(batch.sessions);
    for (const s of batch.sessions) {
      s.shots = keep(s.shots);
      for (const shot of s.shots) for (const g of GROUPS) if (isEmpty((shot as Obj)[g])) delete (shot as Obj)[g];
    }
    batch.rounds = keep(batch.rounds);
    for (const r of batch.rounds) {
      if (r.shots) r.shots = keep(r.shots);
      if (r.holes) {
        r.holes = keep(r.holes);
        if (!r.holes.length) delete r.holes;
      }
      if (isEmpty(r.stats)) delete r.stats;
    }
    if (batch.failed) batch.failed = keep(batch.failed);
    if (failed.length) batch.failed = [...(batch.failed ?? []), ...failed];
  }
  const v = validateBatch(batch);
  if (!v.ok) throw new InvalidBatchError(`Not an olmd/1 batch: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  return { batch, dropped };
}

const isEmpty = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0;

const bytes = (v: unknown) => utf8Length(JSON.stringify(v));

/**
 * The batch in parts the target takes (`limits` from pairing): sessions and rounds as they come,
 * a new part when the next would not fit. What concerns the whole fetch - `failed`, `progress`,
 * `notice` and `sync` (whose import releases the plan's lease) - goes with the last part. A session
 * with more shots than a part may carry keeps its first ones; one item too big for a part on its own
 * is left out (a session as failed, so it is asked for again).
 */
export function split(batch: Batch, limits: ImportLimits): { parts: Batch[]; left_out: number } {
  const { sessions, rounds, failed, progress, notice, sync, ...head } = batch;
  const tail: Partial<Batch> = {};
  const extraFailed: { external_id: string; started_at?: string }[] = [];
  let leftOut = 0;
  const base = (): Batch => ({ ...head, sessions: [], rounds: [] }) as Batch;
  const parts: Batch[] = [];
  let cur = base();
  let size = 0;
  let shots = 0;
  let roundShots = 0;
  const room = () => Math.max(limits.max_bytes - 2048, limits.max_bytes * 0.8); // the tail and the commas
  const startSize = () => bytes(base());
  size = startSize();
  const flush = () => {
    if (cur.sessions.length || cur.rounds.length) parts.push(cur);
    cur = base();
    size = startSize();
    shots = 0;
    roundShots = 0;
  };
  for (const s0 of sessions) {
    const s = s0.shots.length > limits.max_shots ? { ...s0, shots: s0.shots.slice(0, limits.max_shots) } : s0;
    const b = bytes(s) + 1;
    if (startSize() + b > room()) {
      leftOut += 1;
      extraFailed.push({ external_id: s.external_id, ...(s.started_at ? { started_at: s.started_at } : {}) });
      continue;
    }
    if (cur.sessions.length + 1 > limits.max_sessions || shots + s.shots.length > limits.max_shots || size + b > room()) flush();
    cur.sessions.push(s);
    size += b;
    shots += s.shots.length;
  }
  for (const r0 of rounds) {
    let r = r0;
    if (r.shots && r.shots.length > limits.max_round_shots) {
      const { shots: _, ...rest } = r; // not sent this time: the target asks for them again
      r = rest as Round;
      leftOut += 1;
    }
    const n = r.shots?.length ?? 0;
    let b = bytes(r) + 1;
    if (startSize() + b > room() && r.shots) {
      const { shots: _, ...rest } = r;
      r = rest as Round;
      b = bytes(r) + 1;
      leftOut += 1;
    }
    if (startSize() + b > room()) {
      leftOut += 1;
      continue;
    }
    const rn = r.shots ? n : 0;
    if (cur.rounds.length + 1 > limits.max_rounds || roundShots + rn > limits.max_round_shots || size + b > room()) flush();
    cur.rounds.push(r);
    size += b;
    roundShots += rn;
  }
  const allFailed = [...(failed ?? []), ...extraFailed];
  if (allFailed.length) tail.failed = allFailed;
  if (progress) tail.progress = progress;
  if (notice) tail.notice = notice;
  if (sync) tail.sync = sync;
  if (bytes(tail) + size > limits.max_bytes) flush();
  Object.assign(cur, tail);
  parts.push(cur);
  return { parts, left_out: leftOut };
}
