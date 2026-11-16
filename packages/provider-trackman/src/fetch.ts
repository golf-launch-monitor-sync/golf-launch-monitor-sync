// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * Fetching the player's own Trackman data, on their device, against a target's plan.
 *
 * The pace is a person's: every request goes through the load guard of the context (one at a time,
 * a pause of 1–3 s × the plan's pace before each further one, the run's, hour's and day's limits).
 * A sync that meets trouble stops instead of asking on: a refused sign-in, a refusal, a timeout, a
 * lost connection or the guard end the whole fetch, and what it has so far is handed over with a
 * notice; only an answer that lacks the one thing asked for counts against that one session.
 *
 * The target says what to ask for (how far back, what it has, what to leave alone, which rounds'
 * shots it lacks); this module decides nothing about *when*.
 */

import {
  Cancelled,
  externalId,
  GuardLimitError,
  GuardStorageError,
  ms,
  noticeFor,
  ProviderAuthError,
  ProviderBlockedError,
  ProviderError,
  ProviderUnavailableError,
  stopsTheFetch,
  when,
  type Fetched,
  type Plan,
  type ProviderContext,
} from '@glmsync/core';
import { PLAN_RULES } from '@glmsync/spec';
import { query } from './client.ts';
import { GAME_KINDS, toOlmd, type Raw } from './mapping.ts';
import { ACTIVITIES_QUERY, PROFILE_QUERY, ROUND_SHOTS_QUERY, ROUNDS_QUERY, SESSION_QUERY, WHO_QUERY } from './queries.ts';

const DAY = 86_400_000;
const PAGE = 100;
const ROUNDS_PAGE = 50; // a first sync or the history: whole pages
const ROUNDS_PAGE_ROUTINE = 10; // a regular sync only needs the newest few scorecards
const MAX_ROUNDS = 200;
/** More than a session ever holds; the rest of a broken answer stays on the device. */
export const MAX_STROKES_PER_SESSION = 2000;
/** Each shot of a round: five rounds a request; a regular sync asks at most twice, a history chunk five times. */
const SHOT_PAGE = 5;
const SHOT_PAGES = 2;
const SHOT_PAGES_HISTORY = 5;
/** Trackman lists the scorecards newest first, but the time kept (started, else created) may sit a
 * little out of that order: "past it" and "would be listed here" leave this much room. */
const SHOT_SLACK_MS = 2 * DAY;
/** New rounds of one sync whose shots are fetched with it (the newest); the rest come later. */
const SHOT_ROUNDS_NEW = 10;
/** After the shots couldn't be fetched, none for a while in regular syncs (a changed schema would
 * fail every sync the same way, and each try is a request to Trackman for nothing). */
export const SHOTS_OFF_MS = 6 * 3600_000;
/** How long a history chunk may reuse the activity list of the chunk before: the older history
 * doesn't change, and paging a long list again for every chunk would spend the guard's day on it. */
const LIST_REUSE_MS = 12 * 3600_000;

export type Activity = { id: unknown; time?: unknown; kind?: unknown; location?: { name?: unknown } | null };
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

/** What a provider instance keeps between syncs, in memory only. */
export interface TrackmanState {
  shotsOffUntil: number;
  list: { since: string; items: Activity[]; at: number } | null;
}

export function freshState(): TrackmanState {
  return { shotsOffUntil: 0, list: null };
}

/** The earlier of two times, as RFC 3339 (unreadable ones don't count). */
function earlier(a: string | null, b: unknown): string | null {
  const t = when(b);
  if (!t) return a;
  return a === null || ms(t) < ms(a) ? t : a;
}

/** Trouble with Trackman itself or the guard, not with one answer. */
const troubleWithTrackman = (e: unknown) =>
  e instanceof ProviderAuthError ||
  e instanceof ProviderBlockedError ||
  e instanceof ProviderUnavailableError ||
  e instanceof GuardLimitError ||
  e instanceof GuardStorageError;

/**
 * All activities (sessions, games) since `since`, newest first, page by page. A page has to come
 * complete: one Trackman answered with an error must not pass for the end of the list.
 */
export async function listActivities(ctx: ProviderContext, token: string, since: string): Promise<Activity[]> {
  const items: Activity[] = [];
  for (let skip = 0; ; skip += PAGE) {
    const data = await query<{ me?: { activities?: { totalCount?: unknown; items?: unknown } } }>(
      ctx, 'list', token, ACTIVITIES_QUERY, { skip, take: PAGE, timeFrom: since }, { partialOk: false },
    );
    const block = obj(obj(data.me)?.activities);
    if (!block || !Array.isArray(block.items)) throw new ProviderError('Trackman sent no activity list.');
    for (const i of block.items) {
      const a = obj(i);
      if (a && externalId(a.id) !== null) items.push(a as Activity);
    }
    const total = block.totalCount;
    if (block.items.length < PAGE || (typeof total === 'number' && skip + PAGE >= total)) return items;
  }
}

/**
 * One session with its strokes; null when Trackman answered without it (then it isn't handed over,
 * and the target asks again later). Trouble with the connection, the sign-in or the guard ends the
 * fetch instead: each session would fail the same way, and each would burn one of its tries.
 */
async function fetchSession(ctx: ProviderContext, token: string, item: Activity): Promise<{ activity: Activity; node: Obj } | null> {
  type Answer = { node?: unknown };
  let node: unknown;
  try {
    try {
      // Complete, or else once more right away and take what Trackman can send.
      node = (await query<Answer>(ctx, 'session', token, SESSION_QUERY, { id: item.id }, { partialOk: false })).node;
    } catch (e) {
      if (stopsTheFetch(e)) throw e;
      node = (await query<Answer>(ctx, 'session', token, SESSION_QUERY, { id: item.id })).node;
    }
  } catch (e) {
    if (stopsTheFetch(e)) throw e;
    return null;
  }
  const n = obj(node);
  if (!n) return null;
  if (!('strokes' in n)) return { activity: item, node: { strokes: [] } }; // a kind this query doesn't know: kept without shots
  if (!Array.isArray(n.strokes)) return null; // the shots themselves failed at Trackman: asked again later
  // (A stroke Trackman couldn't send comes as null in an otherwise good answer.)
  const strokes = n.strokes.filter((s) => !!obj(s)).slice(0, MAX_STROKES_PER_SESSION);
  return { activity: item, node: { strokes } };
}

async function fetchRounds(ctx: ProviderContext, token: string, since: string, known: Set<string>, page: number) {
  const rounds: Obj[] = [];
  let oldest: string | null = null;
  let more = false;
  const from = ms(since);
  for (let skip = 0; rounds.length < MAX_ROUNDS; skip += page) {
    const data = await query<{ me?: { scorecards?: unknown } }>(ctx, 'rounds', token, ROUNDS_QUERY, { skip, take: page });
    const cards = obj(data.me)?.scorecards;
    const list = Array.isArray(cards) ? cards : [];
    let reachedStart = false;
    for (const c of list) {
      const sc = obj(c);
      const id = sc ? externalId(sc.id) : null;
      if (!sc || id === null) continue; // one Trackman couldn't send
      const played = when(sc.startedAt) ?? when(sc.createdAt);
      if (played && ms(played) < from) {
        reachedStart = true;
        continue;
      }
      if (!known.has(id)) {
        if (rounds.length >= MAX_ROUNDS) {
          more = true; // the rest next time
          break;
        }
        rounds.push(sc);
      }
      oldest = earlier(oldest, played);
    }
    if (list.length < page || reachedStart || more) break;
  }
  return { rounds, more, oldest };
}

/** A round whose shots are wanted: when it was played, and about where it stands in the list. */
type Wanted = { played: string | null; at: number | null };

/**
 * Each shot of the rounds asked for, five rounds a request, at most `pages` requests. It starts a page
 * before where the target placed the newest of them (at the top when one has no place) and goes back a
 * page or two if that was already past it, then forward until each is listed, the list ends, or it is
 * past the oldest.
 *
 * `none`: wanted rounds Trackman doesn't list any more, so the target doesn't ask again - those whose
 * time lies within the stretch of the list seen (and beyond it at the top or the end of the list), but
 * which weren't in it. A round listed without its holes is never one of them, and those not reached
 * come again later.
 */
async function fetchRoundShots(ctx: ProviderContext, token: string, want: Map<string, Wanted>, pages: number) {
  const got: { id: string; holes: unknown }[] = [];
  const found = new Set<string>();
  const listed = new Set<string>();
  const times = [...want.values()].map((w) => ms(w.played));
  const dated = times.length > 0 && times.every((t) => !Number.isNaN(t));
  const newest = dated ? Math.max(...times) : Number.NaN;
  const oldest = dated ? Math.min(...times) : Number.NaN;
  const places = [...want.values()].map((w) => w.at);
  const placed = places.length > 0 && places.every((at) => typeof at === 'number' && Number.isFinite(at) && at >= 0);
  const start = placed ? Math.max(0, Math.floor(Math.min(...(places as number[])) / SHOT_PAGE) - 1) : 0;
  let seenNewest = Number.NEGATIVE_INFINITY;
  let seenOldest = Number.POSITIVE_INFINITY;
  let asked = 0;

  const read = async (page: number) => {
    asked += 1;
    const data = await query<{ me?: { scorecards?: unknown } }>(ctx, 'round_shots', token, ROUND_SHOTS_QUERY, { skip: page * SHOT_PAGE, take: SHOT_PAGE });
    const cards = obj(data.me)?.scorecards;
    const list = Array.isArray(cards) ? cards : [];
    let top = Number.NaN;
    let bottom = Number.NaN;
    for (const c of list) {
      const sc = obj(c);
      const id = sc ? externalId(sc.id) : null;
      if (!sc || id === null) continue;
      const t = ms(when(sc.startedAt) ?? when(sc.createdAt));
      if (!Number.isNaN(t)) {
        top = Number.isNaN(top) ? t : Math.max(top, t);
        bottom = Number.isNaN(bottom) ? t : Math.min(bottom, t);
      }
      listed.add(id);
      // A round whose holes Trackman couldn't send now waits for a later sync.
      if (!want.has(id) || found.has(id) || !Array.isArray(sc.holes)) continue;
      found.add(id);
      got.push({ id, holes: sc.holes });
    }
    if (!Number.isNaN(top)) {
      seenNewest = Math.max(seenNewest, top);
      seenOldest = Math.min(seenOldest, bottom);
    }
    return { top, bottom, end: list.length < SHOT_PAGE };
  };
  const allListed = () => [...want.keys()].every((id) => listed.has(id));

  let lo = start;
  let hi = start;
  const first = await read(start);
  // Already older than the newest wanted round (or past the end of the list): back a page, at most twice.
  let back = first;
  while (dated && lo > 0 && start - lo < 2 && asked < pages && !allListed() && !(back.top >= newest)) {
    lo -= 1;
    back = await read(lo);
  }
  let last = first;
  while (!last.end && asked < pages && !allListed() && !(dated && last.bottom < oldest - SHOT_SLACK_MS)) {
    hi += 1;
    last = await read(hi);
  }
  const covered = (t: number) => (lo === 0 || t < seenNewest - SHOT_SLACK_MS) && (last.end || t > seenOldest + SHOT_SLACK_MS);
  return {
    got,
    none: [...want.entries()].filter(([id, w]) => !listed.has(id) && covered(ms(w.played))).map(([id]) => id),
  };
}

/**
 * One sync's worth of fetching against the target's plan, with the sign-in it started with.
 *
 * A history chunk (`backfill`) reuses the activity list of the chunk before for 12 hours, so the
 * whole list isn't paged through again; once the older sessions are over the target's plan allows
 * none (`max_sessions` 0): then nothing is listed, and the chunk asks only for the shots of the
 * older rounds the target names.
 */
export async function fetchForPlan(plan: Plan, token: string, ctx: ProviderContext, state: TrackmanState): Promise<Fetched> {
  const now = ctx.now();
  const since = plan.since ?? new Date(now - PLAN_RULES.recent_days * DAY).toISOString();
  const days = (now - ms(since)) / DAY;
  const known = new Set(plan.known_ids);
  const skipIds = new Set(plan.give_up);
  const maxSessions = Math.min(plan.max_sessions ?? PLAN_RULES.sync_max_sessions, 1000);
  const backfill = ctx.reason === 'backfill';
  const shotsOnly = backfill && maxSessions === 0;

  const raw: Required<Raw> = { sessions: [], scorecards: [], round_shots: [], shots_none: [] };
  const failed: Fetched['failed'] = [];
  let skippedKnown = 0;
  let more = false;
  let oldest: string | null = null;
  let notice: Fetched['notice'];

  try {
    let activities: Activity[] = [];
    if (!shotsOnly) {
      const cached = state.list;
      const reuse =
        backfill && cached && now - cached.at < LIST_REUSE_MS && now >= cached.at && Math.abs(ms(cached.since) - ms(since)) < 2 * DAY;
      if (reuse) activities = cached.items;
      else {
        activities = await listActivities(ctx, token, since);
        if (backfill) state.list = { since, items: activities, at: now };
      }
    }

    let asked = 0;
    for (const item of activities) {
      const id = externalId(item.id) as string;
      if (typeof item.kind === 'string' && GAME_KINDS.has(item.kind)) {
        oldest = earlier(oldest, item.time);
        continue; // rounds come in as scorecards
      }
      if (known.has(id)) {
        skippedKnown += 1;
        oldest = earlier(oldest, item.time);
        continue;
      }
      if (skipIds.has(id)) {
        oldest = earlier(oldest, item.time);
        continue;
      }
      if (asked >= maxSessions) {
        more = true; // the rest next time (`oldest`: as far back as this one got)
        break;
      }
      asked += 1;
      const got = await fetchSession(ctx, token, item);
      oldest = earlier(oldest, item.time);
      if (got) raw.sessions.push(got);
      else {
        const started = when(item.time);
        failed.push({ external_id: id, ...(started ? { started_at: started } : {}) });
      }
    }

    if (plan.rounds && !shotsOnly) {
      const got = await fetchRounds(ctx, token, since, known, days <= 30 ? ROUNDS_PAGE_ROUTINE : ROUNDS_PAGE);
      raw.scorecards = got.rounds;
      more = more || got.more;
      oldest = earlier(oldest, got.oldest);
    }

    // Each shot of the new rounds and of the known ones the target names, once per round. What goes
    // wrong here costs the shots, not the sync: the sessions and rounds above are handed over anyway.
    const want = new Map<string, Wanted>();
    if (plan.round_shots && (backfill || now >= state.shotsOffUntil)) {
      // The rounds a history chunk brings are old ones, not at the top of the list: the target names
      // them with their place in a later chunk.
      if (!backfill) {
        for (const sc of raw.scorecards.slice(0, SHOT_ROUNDS_NEW)) {
          const o = sc as Obj;
          want.set(externalId(o.id) as string, { played: when(o.startedAt) ?? when(o.createdAt), at: null });
        }
      }
      for (const w of plan.rounds_wanted) want.set(w.external_id, { played: w.played_at ?? null, at: w.newer ?? null });
    }
    if (want.size) {
      try {
        const got = await fetchRoundShots(ctx, token, want, backfill ? SHOT_PAGES_HISTORY : SHOT_PAGES);
        raw.round_shots = got.got;
        raw.shots_none = got.none;
      } catch (e) {
        if (e instanceof Cancelled) throw e;
        // A history chunk that brought nothing else stops as a session's trouble stops a sync.
        const nothingElse = !raw.sessions.length && !failed.length && !raw.scorecards.length;
        if ((backfill && troubleWithTrackman(e) && nothingElse) || e instanceof GuardLimitError || e instanceof GuardStorageError) throw e;
        state.shotsOffUntil = now + SHOTS_OFF_MS;
        notice = { code: 'partial', message: 'The shots of the rounds could not be fetched this time.' };
      }
    }
  } catch (e) {
    if (e instanceof Cancelled) throw e;
    // The fetch stops; what it has goes on, and the target hears why.
    notice = noticeFor(e, ctx.now());
    more = true;
  }

  const { sessions, rounds } = toOlmd(raw);
  const progress: NonNullable<Fetched['progress']> = { more_available: more, skipped_known: skippedKnown };
  if (oldest) progress.oldest_seen = oldest;
  return { sessions, rounds, failed, progress, ...(notice ? { notice } : {}) };
}

/** Whose account a sign-in opens, for "Is this you?": the name, and what the account holds. */
export interface Who {
  player: string | null;
  /** How many activities (sessions and rounds) and the newest one; null: Trackman didn't say. */
  activities: { count: number; last: string | null; place: string | null } | null;
}

/** Before any activity an account can hold, so the count is the whole account's. */
const EVER = '2000-01-01T00:00:00.000Z';

const nameOf = (profile: unknown) => {
  const p = obj(profile);
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : null);
  return pick(p?.fullName) ?? pick(p?.playerName);
};

/**
 * Whose account a sign-in opens, asked before a first connect (nothing is sent anywhere before the
 * player says yes). The name alone doesn't tell a player's own accounts apart, so the count and the
 * newest activity come along, in the same request. Should Trackman refuse that question as a whole,
 * the name alone; trouble with Trackman itself is passed on. Every request through the guard.
 */
export async function who(ctx: ProviderContext, token: string): Promise<Who> {
  let data: { me?: unknown };
  try {
    data = await query(ctx, 'who', token, WHO_QUERY, { timeFrom: EVER });
  } catch (e) {
    if (stopsTheFetch(e)) throw e;
    const p = await query<{ me?: unknown }>(ctx, 'who', token, PROFILE_QUERY);
    return { player: nameOf(obj(p.me)?.profile), activities: null };
  }
  const me = obj(data.me);
  const block = obj(me?.activities);
  const count = typeof block?.totalCount === 'number' && Number.isSafeInteger(block.totalCount) && block.totalCount >= 0 ? block.totalCount : null;
  const newest = (Array.isArray(block?.items) ? block.items : []).map(obj).find((i): i is Obj => !!i);
  const last = count ? when(newest?.time) : null;
  const placeRaw = obj(newest?.location)?.name;
  const place = count && typeof placeRaw === 'string' && placeRaw.trim() ? placeRaw.trim().slice(0, 200) : null;
  return { player: nameOf(me?.profile), activities: count === null ? null : { count, last, place } };
}
