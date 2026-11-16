// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The demo provider: made-up practice sessions and simulator rounds of a made-up player, for tests,
 * for trying a client out without a launch monitor account, and for app reviews. It asks no one
 * anything - but it counts its "requests" through the load guard all the same (one for the list,
 * one per session, one for the rounds, one for their shots, as the Trackman provider would), so the
 * counters, the pauses and the log behave as they will with a real account.
 *
 * Everything is worked out from the date: a session every third day at 18:00 UTC over the last two
 * years, a round every fortnight. The same day always gives the same data and the same ids, so a
 * target stores each once however often it syncs.
 */

import { ms, type Fetched, type Plan, type Provider, type ProviderContext } from '@glmsync/core';
import { PLAN_RULES, type Round, type RoundShot, type Session, type Shot } from '@glmsync/spec';

const DAY = 86_400_000;
const SESSION_EVERY_DAYS = 3;
const ROUND_EVERY_DAYS = 14;
const HISTORY_DAYS = 730;

export const DEMO_NOTICE = 'Demo data: a made-up player, for trying the app out. Nothing here comes from a launch monitor.';

/** A small deterministic random source (mulberry32), seeded from text. */
function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roughly normal, from three uniforms. */
const normal = (r: () => number) => (r() + r() + r() - 1.5) * 2;
const r1 = (x: number) => Math.round(x * 10) / 10 + 0;
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;

// The bag: carry (m), launch (°), spin (rpm), smash.
const BAG: [string, string, number, number, number, number][] = [
  ['Dr', 'Driver', 215, 12.5, 2700, 1.47],
  ['3W', 'Wood3', 195, 11.5, 3600, 1.46],
  ['5H', 'Hybrid5', 175, 14, 4400, 1.42],
  ['6i', 'Iron6', 160, 15.5, 5400, 1.38],
  ['7i', 'Iron7', 148, 17, 6300, 1.36],
  ['8i', 'Iron8', 136, 19, 7200, 1.33],
  ['9i', 'Iron9', 124, 21.5, 8000, 1.3],
  ['PW', 'PitchingWedge', 110, 24.5, 8800, 1.25],
  ['52°', 'Wedge52', 92, 28, 9400, 1.2],
  ['56°', 'Wedge56', 76, 31, 9800, 1.15],
];

function shot(r: () => number, i: number, at: number): Shot {
  const [club, raw, carry0, launch0, spin0, smash0] = BAG[i % BAG.length] as (typeof BAG)[number];
  const carry = carry0 * (1 + normal(r) * 0.04);
  const ball = Math.sqrt(carry * 9.81 / Math.sin((2 * Math.max(launch0, 8) * Math.PI) / 180)) * 0.92;
  const smash = smash0 * (1 + normal(r) * 0.01);
  const side = normal(r) * carry * 0.05;
  return {
    played_at: new Date(at).toISOString(),
    club,
    club_raw: raw,
    ball: { speed_mps: r1(ball), launch_angle_deg: r1(launch0 + normal(r) * 1.5), spin_rpm: Math.round(spin0 * (1 + normal(r) * 0.08)), spin_axis_deg: r1(normal(r) * 4) },
    club_delivery: { speed_mps: r1(ball / smash), path_deg: r1(normal(r) * 2.5), face_angle_deg: r1(normal(r) * 2), smash_factor: r2(smash) },
    flight: { carry_m: r1(carry), total_m: r1(carry * (club === 'Dr' || club === '3W' ? 1.09 : 1.04)), side_m: r1(side), total_side_m: r1(side * 1.15) },
  };
}

const dayId = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

/** The session of a day (18:00 UTC), when the demo player practised that day. */
export function sessionOn(day: number): Session {
  const start = Math.floor(day / DAY) * DAY + 18 * 3600_000;
  const id = `demo-s-${dayId(start)}`;
  const r = rng(id);
  const kinds = [['range', 'RANGE'], ['simulator', 'SIMULATOR'], ['map_my_bag', 'MAP_MY_BAG']] as const;
  const [kind, kindRaw] = kinds[Math.floor(r() * kinds.length)] as (typeof kinds)[number];
  const n = 18 + Math.floor(r() * 24);
  const first = Math.floor(r() * BAG.length);
  const shots = Array.from({ length: n }, (_, k) => shot(r, first + Math.floor(k / 4), start + k * 45_000));
  return { external_id: id, kind, kind_raw: kindRaw, started_at: new Date(start).toISOString(), location: { name: 'Demo Golf Hall' }, device: { maker: 'demo' }, shots };
}

const PARS = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5, 4];
const LENGTHS = [360, 480, 150, 340, 390, 170, 330, 500, 375, 350, 140, 470, 400, 320, 180, 365, 510, 380];

/** The round of a day (simulator, 18 holes), with or without each shot. */
export function roundOn(day: number, withShots: boolean): Round {
  const start = Math.floor(day / DAY) * DAY + 17 * 3600_000;
  const id = `demo-r-${dayId(start)}`;
  const r = rng(id);
  const holes: NonNullable<Round['holes']> = [];
  const shots: RoundShot[] = [];
  let putts = 0;
  let gir = 0;
  for (let h = 0; h < 18; h++) {
    const par = PARS[h] as number;
    let left = LENGTHS[h] as number;
    let n = 0;
    let lie = 'Tee';
    // Full shots until on the green, then putts.
    while (left > 25 && n < 6) {
      n += 1;
      const club = left > 200 ? (n === 1 ? 'Dr' : '3W') : left > 150 ? '6i' : left > 120 ? '8i' : left > 90 ? 'PW' : '56°';
      const go = Math.min(left, (BAG.find((b) => b[0] === club)?.[2] ?? 100) * (0.92 + r() * 0.12));
      const after = Math.max(1.5, Math.abs(left - go) + r() * 9);
      const next = after > 25 ? (r() < 0.7 ? 'Fairway' : 'Rough') : 'Green';
      shots.push({ hole: h + 1, number: n, club, lie_before: lie, lie_after: next, penalty_strokes: 0, to_pin_before_m: r2(left), to_pin_after_m: r2(after), carry_m: r1(go * 0.93), total_m: r1(go) });
      left = after;
      lie = next;
    }
    if (n <= par - 2) gir += 1;
    let p = 0;
    while (left > 0 && p < 3) {
      n += 1;
      p += 1;
      const holed = left < 1.2 || p === 3 || r() < 0.5;
      const after = holed ? 0 : r2(Math.max(0.3, left * 0.15 * r()));
      shots.push({ hole: h + 1, number: n, club: 'Putter', lie_before: 'Green', lie_after: holed ? 'Hole' : 'Green', penalty_strokes: 0, to_pin_before_m: r2(left), to_pin_after_m: after });
      left = after;
    }
    putts += p;
    holes.push({ number: h + 1, par, score: n, putts: p, gir: n - p <= par - 2 });
  }
  const gross = holes.reduce((s, x) => s + (x.score ?? 0), 0);
  const round: Round = {
    external_id: id,
    kind: 'simulator',
    played_at: new Date(start).toISOString(),
    course: { name: 'Demo Links' },
    tee: { name: 'Yellow' },
    holes_played: 18,
    par: 72,
    gross_score: gross,
    to_par: gross - 72,
    stats: { putts, greens_in_regulation: gir },
    holes,
  };
  if (withShots) round.shots = shots;
  return round;
}

/** The days the demo player practised and played, newest first, between `from` and `to` (ms). */
export function days(from: number, to: number, every: number, offset: number): number[] {
  const out: number[] = [];
  const last = Math.floor((to - DAY) / DAY) * DAY; // up to yesterday
  for (let d = last; d >= from - DAY; d -= DAY) {
    if (d < to - HISTORY_DAYS * DAY) break;
    if ((Math.floor(d / DAY) + offset) % every === 0) out.push(d);
  }
  return out;
}

async function fetchForPlan(plan: Plan, ctx: ProviderContext): Promise<Fetched> {
  const now = ctx.now();
  const since = plan.since ? ms(plan.since) : now - PLAN_RULES.recent_days * DAY;
  const known = new Set(plan.known_ids);
  const skip = new Set(plan.give_up);
  const max = plan.max_sessions ?? PLAN_RULES.sync_max_sessions;
  const ok = <T>(value: T) => async () => ({ status: 200, value });
  const sessions: Session[] = [];
  const rounds: Round[] = [];
  let skipped = 0;
  let more = false;
  let oldest: string | undefined;
  if (max > 0 || ctx.reason !== 'backfill') {
    const list = await ctx.guarded('list', ok(days(since, now, SESSION_EVERY_DAYS, 0)));
    for (const d of list) {
      const s = sessionOn(d);
      if (ms(s.started_at) < since) continue;
      if (known.has(s.external_id) || skip.has(s.external_id)) {
        if (known.has(s.external_id)) skipped += 1;
        oldest = s.started_at;
        continue;
      }
      if (sessions.length >= max) {
        more = true;
        break;
      }
      sessions.push(await ctx.guarded('session', ok(s)));
      oldest = s.started_at;
    }
  }
  if (plan.rounds) {
    const found = await ctx.guarded('rounds', ok(days(since, now, ROUND_EVERY_DAYS, 5).map((d) => roundOn(d, false))));
    for (const r of found) if (!known.has(r.external_id) && !(ms(r.played_at) < since)) rounds.push(r);
  }
  const want = [...(plan.round_shots ? rounds.slice(0, 10).map((r) => r.external_id) : []), ...(plan.round_shots ? plan.rounds_wanted.map((w) => w.external_id) : [])];
  if (want.length) {
    const withShots = await ctx.guarded('round_shots', ok(want));
    for (const id of withShots) {
      const day = /^demo-r-(\d{4})(\d{2})(\d{2})$/.exec(id);
      const at = day ? Date.parse(`${day[1]}-${day[2]}-${day[3]}T00:00:00Z`) : Number.NaN;
      const r = rounds.find((x) => x.external_id === id);
      if (Number.isNaN(at)) {
        if (!r) rounds.push({ external_id: id, shots: [] }); // not one of the demo's: none
        continue;
      }
      const shots = roundOn(at, true).shots ?? [];
      if (r) r.shots = shots;
      else rounds.push({ external_id: id, shots });
    }
  }
  const progress: NonNullable<Fetched['progress']> = { more_available: more, skipped_known: skipped };
  if (oldest) progress.oldest_seen = oldest;
  return { sessions, rounds, failed: [], progress };
}

export interface DemoProvider extends Provider<string> {
  /** "Is this you?" for the demo player: through the guard, like every request. */
  who(ctx: ProviderContext): Promise<{ player: string; activities: { count: number; last: string | null; place: string | null } }>;
}

/**
 * The demo provider. Its "sign-in" is any non-empty text; each text is another made-up account (for
 * trying out a target's "one account per player"), the empty text none.
 */
export function demo(): DemoProvider {
  return {
    id: 'demo',
    name: 'Demo',
    notice: DEMO_NOTICE,
    subject: (credential) => (credential ? `demo:${credential.slice(0, 100)}` : null),
    fetch: (plan, _credential, ctx) => fetchForPlan(plan, ctx),
    async who(ctx) {
      const now = ctx.now();
      const all = await ctx.guarded('who', async () => ({ status: 200, value: days(now - HISTORY_DAYS * DAY, now, SESSION_EVERY_DAYS, 0) }));
      const last = all[0];
      return {
        player: 'Demo Player',
        activities: { count: all.length, last: last === undefined ? null : sessionOn(last).started_at ?? null, place: 'Demo Golf Hall' },
      };
    },
  };
}
