// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Trackman's answers as olmd/1: the port of spec/reference/trackman.py, field for field; both answer
 * spec/testvectors/trackman-olmd.json alike.
 *
 * Input is what the fetch has, in Trackman's own shapes (the fields the web portal itself requests):
 * the activity list, each session's strokes, the scorecards and each shot of a round. These are pure
 * functions over untrusted data - every field may be missing or of the wrong type, and is mapped or
 * dropped, never trusted.
 *
 * Units Trackman sends are already SI: metres, m/s, degrees, rpm. Values are passed on as measured;
 * only what is worked out here (the distances to the flag in a round) is rounded.
 */

import { camelClub, externalId, integer, num, put, text, UNKNOWN_CLUB, when } from '@glmsync/core';
import type { Batch, Round, RoundShot, Session, SessionKind, Shot } from '@glmsync/spec';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Activity kinds that are played rounds, not practice: they come in as scorecards. */
export const GAME_KINDS: ReadonlySet<string> = new Set(['COURSE_PLAY', 'ON_COURSE', 'VIRTUAL_GOLF_PLAY']);

/** Trackman's activity kinds -> olmd session kinds; anything else is "other" (kind_raw keeps it). */
export const SESSION_KINDS: Readonly<Record<string, SessionKind>> = {
  RANGE_PRACTICE: 'range',
  RANGE_FIND_MY_DISTANCE: 'find_my_distance',
  FIND_MY_DISTANCE: 'find_my_distance',
  SIMULATOR: 'simulator',
  SHOT_ANALYSIS: 'shot_analysis',
  MAP_MY_BAG: 'map_my_bag',
  VIRTUAL_RANGE: 'virtual_range',
  COMBINE: 'combine',
  TRACKMAN_COMBINE: 'combine',
  COURSE_PRACTICE: 'course_practice',
};

/** (canonical code, the name as sent): no code for a shot hit without a club set. */
export function clubOf(raw: unknown): [string | null, string | null] {
  const code = camelClub(raw);
  return [code === UNKNOWN_CLUB ? null : code.slice(0, 40), text(raw, 100)];
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * A measurement's ball, club delivery and flight (without carry and total, which the caller places):
 * the same fields for a session's stroke and a round's shot.
 */
export function measured(m: Obj): [Obj, Obj, Obj] {
  // Range activities name the spin `ballSpin`, bay activities `spinRate`.
  const spin = m.spinRate !== null && m.spinRate !== undefined ? m.spinRate : m.ballSpin;
  const ball: Obj = {};
  put(ball, 'speed_mps', num(m.ballSpeed));
  put(ball, 'launch_angle_deg', num(m.launchAngle));
  put(ball, 'spin_rpm', num(spin));
  put(ball, 'spin_axis_deg', num(m.spinAxis));
  const head: Obj = {};
  put(head, 'speed_mps', num(m.clubSpeed));
  put(head, 'path_deg', num(m.clubPath));
  put(head, 'face_angle_deg', num(m.faceAngle));
  put(head, 'smash_factor', num(m.smashFactor));
  const flight: Obj = {};
  put(flight, 'side_m', num(m.carrySide));
  put(flight, 'total_side_m', num(m.totalSide));
  put(flight, 'curve_m', num(m.curve));
  return [ball, head, flight];
}

/** One stroke as an olmd shot, or null when it has no ball flight at all (a putt, a misread). */
export function stroke(st: unknown): Shot | null {
  const s = obj(st);
  const m = obj(s?.measurement);
  if (!s || !m) return null;
  if ((m.carry === null || m.carry === undefined) && (m.ballSpeed === null || m.ballSpeed === undefined)) return null;
  const [club, clubRaw] = clubOf(s.club);
  const shot: Obj = {};
  put(shot, 'played_at', when(s.time));
  put(shot, 'club', club);
  put(shot, 'club_raw', clubRaw);
  const [ball, head, rest] = measured(m);
  put(shot, 'ball', ball);
  put(shot, 'club_delivery', head);
  const flight: Obj = {};
  put(flight, 'carry_m', num(m.carry));
  put(flight, 'total_m', num(m.total));
  put(shot, 'flight', { ...flight, ...rest });
  return shot as Shot;
}

/**
 * An activity and its fetched node as an olmd session; null for no session at all (no id, or a
 * played round, which comes as a scorecard).
 */
export function session(activity: unknown, node: unknown): Session | null {
  const a = obj(activity);
  if (!a) return null;
  const ext = externalId(a.id);
  if (ext === null) return null;
  const rawKind = text(a.kind, 100);
  if (rawKind !== null && GAME_KINDS.has(rawKind)) return null;
  const out: Obj = { external_id: ext };
  put(out, 'started_at', when(a.time));
  out.kind = (rawKind !== null && Object.prototype.hasOwnProperty.call(SESSION_KINDS, rawKind) ? SESSION_KINDS[rawKind] : undefined) ?? 'other';
  put(out, 'kind_raw', rawKind);
  const loc = obj(a.location);
  const name = loc ? text(loc.name, 200) : null;
  put(out, 'location', name ? { name } : null);
  out.device = { maker: 'trackman' };
  const strokes = obj(node)?.strokes;
  out.shots = list(strokes)
    .map(stroke)
    .filter((x): x is Shot => x !== null);
  return out as unknown as Session;
}

// ---------------------------------------------------------------------------
// Rounds (scorecards of simulator rounds)
// ---------------------------------------------------------------------------

export function scorecard(sc: unknown): Round | null {
  const c = obj(sc);
  if (!c) return null;
  const ext = externalId(c.id);
  if (ext === null) return null;
  const stat = obj(c.stat) ?? {};
  const course = obj(c.course) ?? {};
  const out: Obj = { external_id: ext, kind: 'simulator' };
  put(out, 'played_at', when(c.startedAt) ?? when(c.createdAt));
  const courseName = text(course.displayName, 200);
  put(out, 'course', courseName ? { name: courseName } : null);
  const tee = text(c.teeName, 100);
  put(out, 'tee', tee ? { name: tee } : null);
  let listed = 0;
  const holes: Obj[] = [];
  for (const h0 of list(c.holes)) {
    const h = obj(h0);
    if (!h) continue;
    const no = integer(h.holeNumber);
    if (no === null || no < 1 || no > 36) continue;
    listed++;
    const score = integer(h.grossScore);
    // Listed, not played: Trackman lists every hole of the round, a hole nobody played with 0.
    if (score === null || score < 1) continue;
    const hole: Obj = { number: no };
    put(hole, 'par', integer(h.par));
    put(hole, 'score', score);
    put(hole, 'putts', integer(h.putts));
    put(hole, 'gir', typeof h.greenInRegulation === 'boolean' ? h.greenInRegulation : null);
    holes.push(hole);
  }
  const played = playedTotals(holes, listed, {
    holes_played: integer(c.numberOfHolesPlayed),
    par: integer(c.par),
    gross_score: integer(c.grossScore),
    to_par: integer(c.toPar),
  });
  if (!played) return null;
  for (const [k, v] of Object.entries(played)) put(out, k, v);
  const stats: Obj = {};
  put(stats, 'putts', integer(stat.numberOfPutts));
  put(stats, 'greens_in_regulation', integer(stat.greenInRegulation));
  put(stats, 'fairways_hit', integer(stat.fairwayHitFairway));
  put(stats, 'fairways_left', integer(stat.fairwayHitLeft));
  put(stats, 'fairways_right', integer(stat.fairwayHitRight));
  put(stats, 'drive_average_m', num(stat.driveAverage));
  put(out, 'stats', stats);
  put(out, 'holes', holes.length ? holes : null);
  return out as unknown as Round;
}

type Totals = { holes_played: number | null; par: number | null; gross_score: number | null; to_par: number | null };

/**
 * A round's totals of the holes played (olmd.md, *A round*; the reference's `played_totals`): Trackman counts the holes
 * it lists with 0 as played (five holes played at +1 came as nine holes at -11), so the holes count where it lists
 * them. The par where every hole played says its own, else Trackman's as long as no hole was left out; null for a
 * card without a stroke on any hole (a game such as Hit It!, which is no round), and Trackman's totals for a card that
 * lists no holes.
 */
export function playedTotals(holes: Obj[], listed: number, given: Totals): Totals | null {
  if (!holes.length) return listed || given.gross_score === 0 ? null : given;
  const whole = holes.length === listed;
  const pars = holes.map((h) => h.par);
  const known = pars.every((p) => typeof p === 'number' && p >= 1);
  const par = known ? (pars as number[]).reduce((a, b) => a + b, 0) : whole ? given.par : null;
  const gross = holes.reduce((a, h) => a + (h.score as number), 0);
  const toPar = par !== null ? gross - par : whole ? given.to_par : null;
  return { holes_played: holes.length, par, gross_score: gross, to_par: toPar };
}

// Strokes Trackman adds to a shot that aren't penalties: the putts the simulator plays for the
// player once the ball is on the green ("AutoPutt"), a gimme or a conceded putt, and what a pick-up
// fills in. Penalties come as "Drop" and "Rehit" (stroke and distance).
const NOT_PENALTY = /putt|gimme|concede|pickup/i;

/** No "-0" (some languages tell it from 0). */
const z = (x: number) => (x === 0 ? 0 : x);
/** To the centimetre. */
const cm = (x: number) => z(Math.round(x * 100) / 100);

/** Metres, or null where it isn't a plausible distance. */
function metres(v: unknown, most = 1000): number | null {
  const x = num(v);
  return x !== null && x >= 0 && x <= most ? cm(x) : null;
}

const holed = (...words: (string | null)[]) => words.some((w) => !!w && (w.toLowerCase().includes('hole') || w.toLowerCase().includes('cup')));

type XZ = [number, number];

/**
 * A point of the simulated course: x and z lie flat, y is the height. Metres: the distance between
 * a shot's launch and final position is Trackman's own `total` of it.
 */
function xz(p: unknown): XZ | null {
  const o = obj(p);
  if (!o) return null;
  const x = num(o.x);
  const zz = num(o.z);
  if (x === null || zz === null || Math.abs(x) > 1e6 || Math.abs(zz) > 1e6) return null;
  return [x, zz];
}

function from(a: XZ | null, b: XZ | null): number | null {
  return a && b ? metres(Math.hypot(a[0] - b[0], a[1] - b[1])) : null;
}

/**
 * Where a shot came to rest against the line from where it was played to the flag: metres right (+)
 * or left (-) of it, past (+) or short (-) of the flag along it. Trackman's course is left-handed
 * (x right, y up, z on), so right of the way forward f is (f.z, -f.x).
 */
function rest(launch: XZ | null, final: XZ | null, pin: XZ | null): [number | null, number | null] {
  if (!launch || !final || !pin) return [null, null];
  const fx = pin[0] - launch[0];
  const fz = pin[1] - launch[1];
  const d = Math.hypot(fx, fz);
  if (d < 0.5) return [null, null];
  const ux = fx / d;
  const uz = fz / d;
  const rx = final[0] - pin[0];
  const rz = final[1] - pin[1];
  const side = rx * uz - rz * ux;
  const long = rx * ux + rz * uz;
  return Math.abs(side) <= 1000 && Math.abs(long) <= 1000 ? [cm(side), cm(long)] : [null, null];
}

/**
 * Each shot of a round. How far from the flag each shot started and stopped: from where it was played
 * and where it came to rest against the hole's pin position. Trackman leaves its own distances empty
 * in simulator rounds; where the positions are missing they are read from the shot before (the start
 * where it stopped), from Trackman's target distance where nothing came before (the tee) or the ball
 * was dropped. A holed shot without a distance stopped at 0.
 */
export function roundShots(holes: unknown): RoundShot[] {
  const rows: RoundShot[] = [];
  for (const h0 of list(holes)) {
    const h = obj(h0);
    if (!h) continue;
    const no = integer(h.holeNumber);
    if (no === null || no < 1 || no > 36) continue;
    const pin = xz(h.pinPosition);
    const shots = new Map<number, Obj>();
    for (const s0 of list(h.shots)) {
      const s = obj(s0);
      const n = s ? integer(s.shotNumber) : null;
      if (s && n !== null && n >= 1 && n <= 30 && !shots.has(n)) shots.set(n, s);
    }
    let before: number | null = null; // where the ball lay, metres from the flag (null: not known)
    for (const n of [...shots.keys()].sort((a, b) => a - b)) {
      const s = shots.get(n) as Obj;
      const m = obj(s.measurement) ?? {};
      const result = text(s.shotResult, 40);
      const final = text(s.finalLie, 40);
      let end = from(xz(s.finalPosition), pin);
      if (end === null) end = metres(m.distanceFromPinTotal);
      if (end === null && holed(result, final)) end = 0;
      const target = metres(m.targetDistance);
      const drop = obj(s.dropPosition);
      const dropped = !!drop && Object.values(drop).some((v) => v !== null && v !== undefined);
      const added = Math.max(0, Math.min(5, integer(s.shotsToAdd) || 0));
      const penalty = result && NOT_PENALTY.test(result) ? 0 : added;
      const [club, clubRaw] = clubOf(s.club);
      // A drop with the penalty belongs to where this shot went (the next one starts there); a drop
      // alone to where this one was played from. Where the positions are, they say it.
      const launch = xz(s.launchPosition);
      const rested = xz(s.finalPosition);
      let start = from(launch, pin);
      if (start === null) start = before === null || (dropped && !penalty) ? target : before;
      const [side, long] = rest(launch, rested, pin);
      const row: Obj = { hole: no, number: n };
      put(row, 'club', club ? club.slice(0, 20) : null);
      put(row, 'club_raw', clubRaw);
      put(row, 'lie_before', text(s.launchLie, 40));
      put(row, 'lie_after', final);
      put(row, 'result', result);
      row.penalty_strokes = penalty;
      put(row, 'to_pin_before_m', start);
      put(row, 'to_pin_after_m', end);
      put(row, 'rest_side_m', side);
      put(row, 'rest_long_m', long);
      put(row, 'target_m', target);
      put(row, 'carry_m', metres(m.carry, 500));
      put(row, 'total_m', metres(m.total, 600));
      // Ball and club data where the shot's measurement has them (asked for since 1.4.0); carry and
      // total stay the round shot's own fields above.
      const [ball, head, flight] = measured(m);
      put(row, 'ball', ball);
      put(row, 'club_delivery', head);
      put(row, 'flight', flight);
      rows.push(row as unknown as RoundShot);
      // After a penalty or a drop the ball lies somewhere else than where it stopped.
      before = penalty || dropped ? null : end;
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// A batch
// ---------------------------------------------------------------------------

/** What one fetch brought, in Trackman's shapes. */
export interface Raw {
  sessions?: { activity: unknown; node: unknown }[];
  scorecards?: unknown[];
  /**
   * `measured`: asked for with each shot's ball and club data (the round says so: `shots_measured`);
   * `refused`, `said`: the fields Trackman refused by name and its words (the round's `extra`).
   */
  round_shots?: { id: unknown; holes: unknown; measured?: unknown; refused?: unknown; said?: unknown }[];
  shots_none?: unknown[];
}

/**
 * Sessions and rounds of a fetch. A round's shots may come without its scorecard (a round sent
 * earlier whose shots are fetched now): then the round carries only its id and its shots. A round
 * Trackman has no shots for carries `shots: []`; a round whose shots weren't fetched has none.
 */
export function toOlmd(fetched: Raw): { sessions: Session[]; rounds: Round[] } {
  const f = obj(fetched) ?? {};
  const sessions = list(f.sessions)
    .map((x) => {
      const o = obj(x);
      return o ? session(o.activity, o.node) : null;
    })
    .filter((s): s is Session => s !== null);
  const rounds: Round[] = [];
  const byId = new Map<string, Round>();
  for (const sc of list(f.scorecards)) {
    const r = scorecard(sc);
    if (r && !byId.has(r.external_id)) {
      byId.set(r.external_id, r);
      rounds.push(r);
    }
  }
  const roundOf = (ext: string) => {
    let r = byId.get(ext);
    if (!r) {
      r = { external_id: ext };
      byId.set(ext, r);
      rounds.push(r);
    }
    return r;
  };
  for (const e of list(f.round_shots)) {
    const entry = obj(e);
    const ext = entry ? externalId(entry.id) : null;
    if (!entry || ext === null) continue;
    const r = roundOf(ext);
    if (!('shots' in r)) {
      r.shots = roundShots(entry.holes);
      if (entry.measured === true) r.shots_measured = true;
      const told = refusal(entry);
      if (told) r.extra = { ...(r.extra ?? {}), ...told };
    }
  }
  for (const x of list(f.shots_none)) {
    const ext = externalId(x);
    if (ext === null) continue;
    const r = roundOf(ext);
    if (!('shots' in r)) r.shots = [];
  }
  return { sessions, rounds };
}

/**
 * What Trackman refused when the round's shots were asked for with their values, for the round's
 * `extra`: `round_shot_fields_refused` (the fields it named, left out) and `round_shots_refused` (its
 * words, at most 300 characters). Nothing when it refused nothing.
 */
export function refusal(entry: Obj): Obj | null {
  const fields = list(entry.refused).filter((f): f is string => typeof f === 'string' && /^[A-Za-z]{1,40}$/.test(f));
  const said = typeof entry.said === 'string' && entry.said.trim() ? entry.said.trim().slice(0, 300) : null;
  const out: Obj = {};
  if (fields.length) out.round_shot_fields_refused = [...new Set(fields)];
  if (said) out.round_shots_refused = said;
  return Object.keys(out).length ? out : null;
}

/** The reference's `batch`: what one fetch brought as an olmd/1 batch (the vectors' shape). */
export function batch(fetched: Raw, opts: { account_ref: string; generated_at: string }): Batch {
  return { format: 'olmd/1', provider: 'trackman', account_ref: opts.account_ref, generated_at: opts.generated_at, ...toOlmd(fetched) };
}
