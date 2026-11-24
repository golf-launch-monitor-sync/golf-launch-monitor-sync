# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The wake (spec/wake.md, since 1.9.0): a target that can push to a client's phone may wake it when
a plan is due, so the client asks for the plan without waiting for the system to wake it.

Three rules, each reading untrusted input strictly (None or False for anything it can't take, never
an exception): what a client registers (`read_wake`), whether a target wakes a client now
(`should_wake`), and whether a push is a wake (`is_wake`).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

#: The push services a client may name. `expo`: an Expo push token of the client app's own project.
SERVICES = ("expo",)
#: Between two wakes of the same client, at least this long (seconds): the platforms advise two or three
#: silent pushes an hour at most, and throttle an app that gets more.
GAP_S = 1200
#: The first wake after the player came back to the target app (since 1.12.0) may come this long after the last
#: one: it is the wake the player waits for, and it comes once per return.
BACK_GAP_S = 300
#: The whole of a wake's data. Nothing of the player, no id, no address: a wake only says "ask for the plan".
PAYLOAD = {"kind": "lm_plan"}
#: An address longer than this is no address.
ADDRESS_MAX = 256

_EXPO = re.compile(r"(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,200}\]", re.ASCII)
_TIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})",
                   re.ASCII)


def read_wake(body: Any) -> dict[str, str] | None:
    """The body of `PUT /wake`: {"service": "expo", "address": "ExponentPushToken[…]"}. Unknown keys are
    ignored (a later version may add some); anything else is no registration."""
    if not isinstance(body, dict):
        return None
    service, address = body.get("service"), body.get("address")
    if not isinstance(service, str) or service not in SERVICES:
        return None
    if not isinstance(address, str) or len(address) > ADDRESS_MAX or not _EXPO.fullmatch(address):
        return None
    return {"service": service, "address": address}


def _time(v: Any) -> datetime | None:
    if not isinstance(v, str) or len(v) > 40 or not _TIME.fullmatch(v):
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def should_wake(now: Any, signin: Any, due_at: Any, woken_at: Any, quiet_until: Any, back_at: Any = None) -> bool:
    """Whether a target wakes a client now.

    - `signin`: what the client last said of its provider sign-in; only a client that can fetch (`ready`)
      is woken - one that can't would only ask for a plan it can't follow.
    - `due_at`: when the earliest plan the client would follow (a regular sync, the next history chunk)
      is due, as the target reckons it; null: nothing is due.
    - `woken_at`: the last wake sent to this client; a wake goes GAP_S after it at the earliest, also when
      the platform dropped the last one (a target can't know).
    - `quiet_until`: a time the client reported it can't fetch before (a guard limit, the provider's pause);
      no wake until it has passed.
    - `back_at` (since 1.12.0, optional): when the player last came back to the target app (planning.md,
      *When the player is there*). Not woken since then: BACK_GAP_S is enough instead of GAP_S.
    """
    t = _time(now)
    if t is None or signin != "ready":
        return False
    due = _time(due_at)
    if due is None or due > t:
        return False
    if woken_at is not None:
        last = _time(woken_at)
        back = _time(back_at) if back_at is not None else None
        gap = BACK_GAP_S if back is not None and last is not None and last < back <= t else GAP_S
        if last is None or (t - last).total_seconds() < gap:
            return False
    if quiet_until is not None:
        quiet = _time(quiet_until)
        if quiet is None or quiet > t:
            return False
    return True


def is_wake(data: Any) -> bool:
    """Whether a push's data is a wake: exactly {"kind": "lm_plan"} (other keys are ignored, so a push
    service's own keys don't hide it)."""
    return isinstance(data, dict) and data.get("kind") == PAYLOAD["kind"]
