# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The rules of a handicap target and its clients (spec/hcp.md): when a client reads the player's
handicap record, the lease that keeps two clients of one player from reading at once, and which
scorecards a client reads in one go.

Pure functions over plain values, so any target or client can port them and check itself against
spec/testvectors/hcp-plan.json. The record changes a few times a month at most: a target asks for it
at most once a day on its own, and whenever the player asks.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

RULES = json.loads((Path(__file__).resolve().parent.parent / "hcp" / "rules.json").read_text())

REASONS = ("connect", "open", "timer", "manual")


def parse(ts: Any) -> datetime | None:
    """A stored time; without a zone it is UTC; anything else is none."""
    if not ts or not isinstance(ts, str):
        return None
    try:
        t = datetime.fromisoformat(ts)
    except ValueError:
        return None
    return t.replace(tzinfo=UTC) if t.tzinfo is None else t


def is_due(last_sync_at: str | None, reason: str, now: str) -> bool:
    """`manual`: always (the player asked); `connect`: unless a read ran within connect_gap_s (pairing
    twice in a row reads once); `open` and `timer`: once daily_gap_h have passed since the last read,
    or there was none. An unknown reason is never due."""
    t, last = parse(now), parse(last_sync_at)
    if reason == "manual":
        return True
    if t is None or reason not in REASONS:
        return False
    if last is None:
        return True
    gap = (t - last).total_seconds()
    if reason == "connect":
        return gap >= RULES["connect_gap_s"]
    return gap >= RULES["daily_gap_h"] * 3600


def busy(lease: Any, reason: str, now_s: float) -> bool:
    """Another client of the player holds the lease (`{"until": seconds}`) of a due plan; `manual` is
    never busy (the player is waiting for it)."""
    if reason == "manual" or not isinstance(lease, dict):
        return False
    until = lease.get("until")
    return isinstance(until, int | float) and not isinstance(until, bool) and until > now_s


def cards_to_read(results: Any, cards_have: Any, most: int | None = None) -> list[str]:
    """The scorecards a client reads this time: those of results it saw with a `ref` the target has
    no card for (`cards_have`), not of a result nobody started (status NA), newest first (by day,
    then as listed), at most `most` (the plan's `max_cards`). The rest come with the next read."""
    limit = RULES["max_cards"] if most is None else most
    have = {c for c in cards_have if isinstance(c, str)} if isinstance(cards_have, list) else set()
    seen: list[tuple[str, int, str]] = []
    taken: set[str] = set()
    for i, r in enumerate(results if isinstance(results, list) else []):
        if not isinstance(r, dict):
            continue
        ref, day = r.get("ref"), r.get("played_on")
        if not isinstance(ref, str) or not ref or ref in have or ref in taken or r.get("status") == "NA":
            continue
        if not isinstance(day, str):
            continue
        taken.add(ref)
        seen.append((day, -i, ref))
    seen.sort(reverse=True)
    return [ref for _, _, ref in seen[: max(0, int(limit))]]
