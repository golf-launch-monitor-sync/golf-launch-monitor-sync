# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The load guard (spec/guard.md): the limits a client never exceeds against a provider, whatever a
target's plan says - a faulty or hostile target must not be able to make it hammer a provider.

Counted per provider account: every request started, kept across restarts (here: in memory, the
reference only; packages/core stores the counts through a storage interface). Windows are rolling:
the last 60 minutes, the last 24 hours. Times are seconds on one clock.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

LIMITS = json.loads((Path(__file__).resolve().parent.parent / "guard" / "limits.json").read_text())


def bad(status: int) -> bool:
    """A response that asks for less load: 429, a server error, or none at all (timeout, network)."""
    return status == 0 or status == 429 or 500 <= status <= 599


@dataclass
class Account:
    starts: list[float] = field(default_factory=list)  # every request started within the day window
    run: int = 0                                       # requests in the current sync run
    in_flight: bool = False
    last_end: float | None = None
    streak: int = 0                                    # bad responses in a row
    blocked_until: float | None = None                 # backoff or Retry-After


class Guard:
    def __init__(self, limits: dict[str, Any] | None = None) -> None:
        self.limits = limits or LIMITS
        self.accounts: dict[str, Account] = {}

    def _acc(self, account: str) -> Account:
        return self.accounts.setdefault(account, Account())

    def begin_run(self, account: str) -> None:
        """A new sync run: the per-run count starts again (the hourly and daily ones don't)."""
        self._acc(account).run = 0

    def check(self, account: str, now: float) -> dict[str, Any]:
        """{"ok": true}, or {"ok": false, "reasons": [...], "until": t | None}: the reasons sorted,
        `until` the earliest time all reasons that have one are over (None when none has: `busy`
        ends when the request in flight does, `per_run` with the run)."""
        L, a = self.limits, self._acc(account)
        reasons: list[str] = []
        untils: list[float] = []

        def window(name: str, most: int, length: float) -> None:
            inside = [s for s in a.starts if now - s < length]
            if len(inside) >= most:
                reasons.append(name)
                untils.append(inside[len(inside) - most] + length)

        if a.in_flight:
            reasons.append("busy")
        if a.blocked_until is not None and now < a.blocked_until:
            reasons.append("backoff")
            untils.append(a.blocked_until)
        if a.run >= L["per_run"]:
            reasons.append("per_run")
        window("per_hour", L["per_hour"], L["hour_window_s"])
        window("per_day", L["per_day"], L["day_window_s"])
        if a.last_end is not None and now < a.last_end + L["pause_s"]["min"]:
            reasons.append("pause")
            untils.append(a.last_end + L["pause_s"]["min"])
        if not reasons:
            return {"ok": True}
        return {"ok": False, "reasons": sorted(reasons), "until": max(untils) if untils else None}

    def start(self, account: str, now: float) -> None:
        if not self.check(account, now)["ok"]:
            raise RuntimeError("the guard refused this request")
        a = self._acc(account)
        a.in_flight = True
        a.run += 1
        a.starts = [s for s in a.starts if now - s < self.limits["day_window_s"]] + [now]

    def finish(self, account: str, now: float, status: int, retry_after_s: float | None = None) -> None:
        """The request ended with `status` (0: no response). After a bad one the next waits the
        backoff (60 s, doubled each time, at most an hour); Retry-After holds whenever it is longer,
        even past the hour."""
        L, a = self.limits, self._acc(account)
        a.in_flight = False
        a.last_end = now
        if not bad(status):
            a.streak = 0
            return
        a.streak += 1
        b = L["backoff"]
        wait = min(b["max_s"], b["first_s"] * b["factor"] ** (a.streak - 1))
        if retry_after_s is not None and retry_after_s > wait:
            wait = retry_after_s
        a.blocked_until = now + wait
