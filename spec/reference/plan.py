# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The reference planning rules of a target (spec/planning.md): when a sync is due, how far back it
looks, which sessions to leave alone, when the older history stops, and the lease that keeps two
clients of one player from fetching at the same time.

A target decides when a client fetches (GET /plan); these are the rules a target is expected to
keep at least as gently. Pure functions over plain values, so any target can port them and check
itself against spec/testvectors/plan.json.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

RULES = json.loads((Path(__file__).resolve().parent.parent / "plan" / "rules.json").read_text())

REASONS = ("connect", "open", "timer", "manual", "backfill")


def parse(ts: Any) -> datetime | None:
    """A stored time; without a zone it is UTC."""
    if not ts:
        return None
    try:
        t = datetime.fromisoformat(str(ts))
    except ValueError:
        return None
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t


def iso(t: datetime) -> str:
    """UTC, to the millisecond, with 'Z' - what every language can read and write alike."""
    return t.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def next_due_at(last_sync_at: str, seed: str) -> str:
    """A regular sync is due 38-52 minutes after the last one. The minute is random per sync but the
    same however often a client asks: it comes from a hash of `seed`, which the target makes of
    something fixed for this sync (the player and the time of the last sync), so syncs never run on
    the beat."""
    last = parse(last_sync_at)
    assert last is not None
    lo, hi = RULES["regular_gap_min"]["min"], RULES["regular_gap_min"]["max"]
    u = int.from_bytes(hashlib.sha256(seed.encode()).digest()[:4], "big") / 0xFFFFFFFF
    return iso(last + timedelta(minutes=lo + (hi - lo) * u))


def here_due_at(last_sync_at: str | None, here: Any, now: str) -> str | None:
    """When the player being there makes a regular sync due (since 1.12.0), or None. `here` is what the
    target knows of its player, all times or null: `back_at` (they came back to the target app after
    at least `away_s` away - a session typically lies behind them), `seen_at` (the target app was last
    in front), `news_at` (the last sync that brought new sessions or rounds).

    - Back, and no sync since: due `back_gap_s` after the last sync - straight away, as a rule.
    - Still there (seen within `seen_s`), and no sync since the return brought anything: due
      `stay_gap_s` after the last sync - the session may take a moment to reach the provider.
    - Either only within `back_window_s` of the return; after that, or once something came, the regular
      rhythm again: new data won't be there again so soon."""
    if not isinstance(here, dict):
        return None
    last, t, back = parse(last_sync_at), parse(now), parse(here.get("back_at"))
    if last is None or t is None or back is None or back > t:
        return None
    end = back + timedelta(seconds=RULES["back_window_s"])
    if t >= end:
        return None
    if last < back:
        return iso(last + timedelta(seconds=RULES["back_gap_s"]))
    news, seen = parse(here.get("news_at")), parse(here.get("seen_at"))
    if news is not None and news >= back:
        return None
    if seen is None or (t - seen).total_seconds() >= RULES["seen_s"]:
        return None
    due = last + timedelta(seconds=RULES["stay_gap_s"])
    return iso(due) if due < end else None


def is_due(last_sync_at: str | None, history_done: bool, reason: str, now: str, seed: str,
           here: Any = None) -> bool:
    """`connect`: the player just connected or signed in again (due unless a sync ran within two
    minutes); `open`: the player's app was opened or came back to the front (due ten minutes after
    the last sync - typically straight after a session); `timer`: the regular rhythm; `manual`:
    always; `backfill`: while the older history isn't done. `here` (since 1.12.0, optional): what the
    target knows of its player being there (`here_due_at`); it makes any reason but `backfill` due
    sooner, never later."""
    if reason == "manual":
        return True
    if reason == "backfill":
        return not history_done
    last = parse(last_sync_at)
    if last is None:
        return True
    t = parse(now)
    assert t is not None
    if reason == "connect":
        return (t - last).total_seconds() >= RULES["connect_gap_s"]
    if reason == "open" and (t - last).total_seconds() >= RULES["open_gap_s"]:
        return True
    soon = parse(here_due_at(last_sync_at, here, now))
    if soon is not None and t >= soon:
        return True
    due = parse(next_due_at(last_sync_at, seed))  # type: ignore[arg-type]
    assert due is not None
    return t >= due


def tries(entry: Any) -> int:
    try:
        return int((entry or {}).get("n") or 0)
    except (TypeError, ValueError, AttributeError):
        return 0


def give_up(retry: dict[str, Any], reason: str) -> list[str]:
    """Sessions not to ask the provider for this time: a manual sync tries all of them, the history
    loader none of the waiting ones, a regular sync none that gave up (three tries)."""
    if reason == "manual":
        return []
    if reason == "backfill":
        return sorted(retry)
    return sorted(k for k, v in retry.items() if tries(v) >= RULES["max_tries"])


def first_days(now: str) -> int:
    """How far back a first sync asks (since 1.23.0): to 1 October of the previous year, the start of the last indoor
    season in the north, with the usual slack; at least `recent_days`, at most `first_max_days`. Many players play only
    from autumn to spring: at the end of October, 90 days hold this autumn's two or three rounds, while last winter's
    fifteen or more would wait for the history loader. A sync's caps hold as always."""
    t = parse(now)
    assert t is not None
    t = t.astimezone(UTC)  # the year of UTC's date, whatever offset `now` carries
    start = datetime(t.year - 1, RULES["first_season_month"], 1, tzinfo=UTC)
    days = (t - start).days + RULES["window_slack_days"]
    return max(RULES["recent_days"], min(RULES["first_max_days"], days))


def window_days(last_sync_at: str | None, reason: str, retry: dict[str, Any], skip: list[str], now: str) -> int:
    """How far back to ask: since the last sync with a few days of slack (for a first sync back to the last season,
    `first_days`), far enough for the sessions still waiting, or the whole history."""
    if reason == "backfill":
        return RULES["history_days"]
    t = parse(now)
    assert t is not None
    last = parse(last_sync_at)
    days = first_days(now) if last is None else min(RULES["max_window_days"],
                                                    (t - last).days + RULES["window_slack_days"])
    waiting = [w for k, v in retry.items() if k not in set(skip) and (w := parse((v or {}).get("t")))]
    if waiting:
        days = max(days, min(RULES["history_days"], (t - min(waiting)).days + RULES["window_slack_days"]))
    return days


def max_sessions(last_sync_at: str | None, reason: str) -> int:
    """New sessions a plan lets the client fetch (since 1.23.0): a history chunk its chunk, a first sync fewer than a
    regular one - its window reaches back to the last season, and the run's 40 requests (the guard) must leave room for
    the activity list, the scorecards and the newest rounds' shots after its sessions; the rest comes with the next."""
    if reason == "backfill":
        return RULES["history_chunk_sessions"]
    return RULES["first_max_sessions"] if parse(last_sync_at) is None else RULES["sync_max_sessions"]


def since(days: int, now: str) -> str:
    t = parse(now)
    assert t is not None
    return iso(t - timedelta(days=days))


def next_retry(old: dict[str, Any], fetched: list[str], failed: list[dict[str, Any]]) -> dict[str, Any]:
    """Sessions to try again: {id: {"t": its time, "n": tries}}. Fetched ones are done; failed ones
    count one more try. Waiting and given-up ones are capped separately (the newest kept): under one
    shared cap, a long list of broken sessions would push given-up ones out and make them unknown
    again, so the history loader would ask for them chunk after chunk."""
    out = {k: v for k, v in old.items() if k not in set(fetched)}
    for f in failed:
        prev = out.get(f["id"]) or {}
        out[f["id"]] = {"t": f.get("time") or prev.get("t"), "n": tries(prev) + 1}

    def newest(items: list[tuple[str, Any]], n: int) -> list[tuple[str, Any]]:
        return sorted(items, key=lambda kv: str((kv[1] or {}).get("t") or ""))[-n:] if len(items) > n else items

    waiting = [kv for kv in out.items() if tries(kv[1]) < RULES["max_tries"]]
    gave_up = [kv for kv in out.items() if tries(kv[1]) >= RULES["max_tries"]]
    return dict(newest(gave_up, RULES["max_given_up"]) + newest(waiting, RULES["max_waiting"]))


def barren(chunks: list[dict[str, int]]) -> list[bool]:
    """After each history chunk ({"brought", "failed"}): whether the history load of sessions ends -
    after five chunks in a row that brought nothing but failures. A chunk that brought something,
    or had no failures, starts the count again."""
    out, n = [], 0
    for c in chunks:
        if c.get("brought") or not c.get("failed"):
            n = 0
            out.append(False)
            continue
        n += 1
        out.append(n >= RULES["barren_chunks"])
    return out


def shots_idle(moved: list[int]) -> list[bool]:
    """After each history chunk of rounds' shots (rounds moved on): whether it ends - after five
    chunks in a row that moved no round on."""
    out, n = [], 0
    for m in moved:
        n = 0 if m else n + 1
        out.append(n >= RULES["barren_chunks"])
    return out


def lease_kind(reason: str) -> str:
    return "history" if reason == "backfill" else "sync"


def holder(lease: dict[str, Any] | None, reason: str, now_s: float, client: str | None) -> dict[str, Any] | None:
    """Who keeps a client from a plan of this kind (since 1.13.0): None when it may have one, else
    the lease's holder as the plan names it, `{"kind", "since"}`. `lease`: the lease of the plan's
    kind, `{"client", "kind", "since", "until"}` (seconds; `client` whatever the target knows a client
    by, its import token as a rule). The lease belongs to the client that took it: the same client
    asking again takes its own lease over - it runs its syncs one after the other, so its earlier
    one has ended without an import (it gave up, or its batch never arrived), and to wait for that
    one would be waiting for nothing. A manual sync is never held up."""
    if reason == "manual" or not lease:
        return None
    try:
        if float(lease.get("until") or 0) <= now_s:
            return None
    except (TypeError, ValueError):
        return None
    if client is not None and lease.get("client") == client:
        return None
    out: dict[str, Any] = {"kind": lease.get("kind") or "other"}
    if lease.get("since") is not None:
        out["since"] = lease["since"]
    return out


def leases(events: list[dict[str, Any]]) -> list[dict[str, Any] | None]:
    """The lease (5 minutes) of a due plan, per kind: while a plan of a kind is out, another client
    asking for one of that kind is told `busy`, with who holds it and since when (1.13.0). A regular
    sync and a history chunk don't hold each other up, a manual sync is never busy (the player waits
    for an answer), the client holding a lease takes it over when it asks again (`holder`), and the
    import answering the plan that holds it - or a new connect - releases it. An import names its
    plan by the index of the plan's event (`plan`); one without names none and releases the kind's
    lease, whoever holds it (a target that can't tell). An import of a plan whose lease was taken
    over since releases nothing.

    Events: {"t": seconds, "op": "plan" | "import" | "connect", "reason", "client", "kind", "plan"};
    out: for each plan `{"busy": false}` or `{"busy": true, "holder": {...}}` (None for the other
    events)."""
    held: dict[str, dict[str, Any]] = {}
    out: list[dict[str, Any] | None] = []
    for i, e in enumerate(events):
        t, op = float(e["t"]), e["op"]
        if op == "connect":
            held.clear()
            out.append(None)
        elif op == "import":
            kind = lease_kind(e["reason"])
            lease = held.get(kind)
            if lease is not None and (e.get("plan") is None or lease["plan"] == e["plan"]):
                del held[kind]
            out.append(None)
        else:
            kind = lease_kind(e["reason"])
            who = holder(held.get(kind), e["reason"], t, e.get("client"))
            if who is None:
                held[kind] = {"client": e.get("client"), "kind": e.get("kind"), "since": t,
                              "until": t + RULES["lease_s"], "plan": i}
                out.append({"busy": False})
            else:
                out.append({"busy": True, "holder": who})
    return out


# ---------------------------------------------------------------------------
# The whole history (since 1.20.0): the older scorecards, and sessions asked for again
# ---------------------------------------------------------------------------

#: What a client can do beyond what earlier versions could, told with every plan (`can`). A target
#: plans the parts below only for a client that names them: an older one would page the whole list
#: of scorecards with every history chunk, and never say where it ended.
CAN = ("older_rounds", "sessions_again")


def read_can(values: Any) -> list[str]:
    """The query parameter `can`, given as the list of its values (each may hold several words,
    comma-separated): the words this spec knows, once each, in the order of CAN; anything else is
    left out (a newer client's word means nothing to an older target)."""
    if not isinstance(values, list):
        return []
    words: set[str] = set()
    for v in values[:10]:
        if isinstance(v, str) and len(v) <= 200:
            words.update(w.strip() for w in v.split(","))
    return [w for w in CAN if w in words]


def rounds_skip(known_rounds: int) -> int:
    """Where a history chunk starts listing the scorecards (`rounds_skip`): the provider lists them
    newest first, and the target's rounds are as a rule the newest ones - the regular syncs brought
    them. So it skips about as many as the target has, less a margin for rounds the provider lists a
    little out of order, and no chunk pages again through what is there."""
    try:
        n = int(known_rounds)
    except (TypeError, ValueError):
        return 0
    return max(0, n - RULES["rounds_skip_slack"])


def sessions_wanted(sessions: list[dict[str, Any]], asked: dict[str, Any]) -> list[dict[str, Any]]:
    """The known sessions a history chunk asks for again (`sessions_wanted`): those the target holds
    without a single shot, of a kind a client may now fetch with its shots (the target's choice:
    e.g. kinds an earlier client asked for without their own type), newest first, each asked at most
    `sessions_again_tries` times, at most `sessions_wanted_history` a chunk. `sessions`: `{external_id,
    started_at, shots}` (shots: how many the target has); `asked`: how often each was asked so far.
    Out: `{external_id, started_at}` as the plan carries them."""
    def tries(ext: str) -> int:
        try:
            return max(0, int(asked.get(ext) or 0))
        except (TypeError, ValueError):
            return RULES["sessions_again_tries"]

    def started(s: dict[str, Any]) -> datetime:
        return parse(s.get("started_at")) or datetime.min.replace(tzinfo=UTC)

    out: list[dict[str, Any]] = []
    for s in sorted(sessions, key=started, reverse=True):
        ext = s.get("external_id")
        if not isinstance(ext, str) or not ext or s.get("shots"):
            continue
        if tries(ext) >= RULES["sessions_again_tries"]:
            continue
        item: dict[str, Any] = {"external_id": ext}
        if (t := parse(s.get("started_at"))) is not None:
            item["started_at"] = iso(t)
        out.append(item)
        if len(out) >= RULES["sessions_wanted_history"]:
            break
    return out
