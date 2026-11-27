# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The question and the answer (since 1.22.0; spec/target-api.md, *Asking and answering*; spec/deep-links.md,
*The answer over the binding*; spec/planning.md, *Who asks when*).

A target leads: it asks its client to fetch (a wake, a nudge over the Android binding, a sync link, its page), and the
client answers what came of the plan. Everything here reads untrusted input - a query parameter a client sent, a
Bundle another app passed over a binding - strictly, and answers None for anything it can't take: never an exception,
never a guess.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import Any

#: Why a client asks for a plan now, beside its reason (`cause` on GET /plan): the target's own ask, answered. A wake
#: still asks with reason `timer`, a nudge with the reason its binding named; `cause` says it was the answer to one.
CAUSES = ("wake", "nudge", "link", "page")

#: What a client tells about its system with every plan (`env` on GET /plan): the key and the values it may take.
#: `background`: whether the system runs the client's own background work (iOS: Background App Refresh; Android:
#: whether the player restricted the app's background activity). `battery` (Android): whether the system's battery
#: optimisation holds the app back. `push`: whether the client has a push address the target may wake it at.
ENV = {
    "os": ("android", "ios", "other"),
    "background": ("available", "restricted", "denied"),
    "battery": ("optimized", "exempt"),
    "push": ("on", "off"),
}
ENV_MAX = 200

#: The client's version (`version` on GET /plan), as in its pairing (`client.version`).
_VERSION = re.compile(r"[0-9A-Za-z.+-]{1,50}", re.ASCII)

#: The answer over the Android binding (spec/deep-links.md, *The answer over the binding*): a Bundle of strings.
ANSWER_V = "1"
#: What a final answer may say; `accepted` comes first, at once, and says only that the client took the ask.
STATES = ("accepted", "started", "not_due", "busy", "signin", "outdated", "blocked", "failed")
#: Why a client can't fetch although it would (`blocked`): its load guard holds back, the provider paused or refused
#: the account, or the system keeps it from running its sync (data saver, background restricted).
BLOCKED = ("guard", "provider", "system")
#: Why an ask came to nothing (`failed`): the target's plan couldn't be asked, the client isn't paired with that target,
#: the player ended the connection, or anything else.
FAILED = ("target", "unpaired", "disconnected", "error")
CLIENT_KINDS = ("extension", "web", "companion", "cli", "other")
SIGN_IN_NOT_READY = ("none", "confirm", "expired", "other")
#: A target waits this long for `accepted` before it takes the ask as not started (the service never ran).
ACCEPT_S = 5
#: ... and this long for the final answer (the plan's request may be slow) before it takes the ask as failed.
ANSWER_S = 60

#: A client's own timer asks no plan before the target's `next_at` - but never waits longer than this from the plan
#: that said it (6 hours): a target that leads but stops asking must not leave a connection without syncs.
OWN_MAX_S = 6 * 3600

_TIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})",
                   re.ASCII)


def _one(values: Any) -> str | None:
    """A query parameter given as the list of its values in the request: exactly one string, else nothing."""
    if not isinstance(values, list) or len(values) != 1 or not isinstance(values[0], str):
        return None
    return values[0]


def read_cause(values: Any) -> str | None:
    v = _one(values)
    return v if v in CAUSES else None


def read_version(values: Any) -> str | None:
    v = _one(values)
    return v if v is not None and _VERSION.fullmatch(v) else None


def read_env(values: Any) -> dict[str, str]:
    """`env=os:android,background:available,battery:optimized,push:off`: the pairs this spec knows, in the order of ENV.
    A pair of an unknown key or value is left out (a newer client's means nothing here); a known key given twice is
    left out altogether (which one would be meant?). Not one value of at most ENV_MAX characters: nothing."""
    v = _one(values)
    if v is None or len(v) > ENV_MAX:
        return {}
    seen: dict[str, list[str]] = {}
    for pair in v.split(","):
        key, sep, value = pair.partition(":")
        if sep and key in ENV:
            seen.setdefault(key, []).append(value)
    return {k: seen[k][0] for k in ENV if len(seen.get(k, [])) == 1 and seen[k][0] in ENV[k]}


def _time(v: Any) -> str | None:
    return v if isinstance(v, str) and len(v) <= 40 and _TIME.fullmatch(v) else None


def read_answer(data: Any) -> dict[str, Any] | None:
    """The companion app's answer over the binding: the strings of the Bundle it sent (`v`, `state` and the fields of
    that state). Unknown keys are ignored; a known field that is wrong makes it no answer."""
    if not isinstance(data, dict) or data.get("v") != ANSWER_V:
        return None
    state = data.get("state")
    if not isinstance(state, str) or state not in STATES:
        return None
    out: dict[str, Any] = {"state": state}
    if "until" in data:
        if state not in ("not_due", "blocked"):
            return None
        until = _time(data["until"])
        if until is None:
            return None
        out["until"] = until
    if state == "busy":
        by = data.get("by")
        if not isinstance(by, str) or by not in CLIENT_KINDS:
            return None
        out["by"] = by
        if "since" in data:
            since = _time(data["since"])
            if since is None:
                return None
            out["since"] = since
    elif state == "signin":
        signin = data.get("signin")
        # Signed in and confirmed is no reason not to fetch.
        if not isinstance(signin, str) or signin not in SIGN_IN_NOT_READY:
            return None
        out["signin"] = signin
    elif state in ("blocked", "failed"):
        why = data.get("why")
        if not isinstance(why, str) or why not in (BLOCKED if state == "blocked" else FAILED):
            return None
        out["why"] = why
    return out


def _parse(ts: Any) -> datetime | None:
    if _time(ts) is None:
        return None
    try:
        t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:  # a 30 February reads as no time
        return None
    return t if t.tzinfo else t.replace(tzinfo=UTC)


def _iso(t: datetime) -> str:
    return t.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def own_ask_at(own_at: str, next_at: Any, received_at: str) -> str | None:
    """When the client's own timer may next ask a plan (reason `timer`, no cause): its own time `own_at`, but not
    before the target's `next_at` of the last plan, received at `received_at` - and that wait at most OWN_MAX_S from
    then. A `next_at` that isn't a time is none. None only when `own_at` or `received_at` isn't one."""
    own, got = _parse(own_at), _parse(received_at)
    if own is None or got is None:
        return None
    nxt = _parse(next_at)
    if nxt is None:
        return _iso(own)
    return _iso(max(own, min(nxt, got + timedelta(seconds=OWN_MAX_S))))


def may_ask(reason: Any, cause: Any, now: str, next_at: Any, received_at: Any) -> bool:
    """Whether a client asks for a plan now. Only its own regular look waits for `next_at` (and at most OWN_MAX_S): the
    target's ask (any cause), the player's (`manual`, `open`, `connect`) and the older history (`backfill`, which has
    `wait_s`) always go. Without a readable `next_at` or `received_at`, or `now` unreadable: as before, it asks."""
    if cause in CAUSES or reason != "timer":
        return True
    t, nxt, got = _parse(now), _parse(next_at), _parse(received_at)
    if t is None or nxt is None or got is None:
        return True
    return t >= min(nxt, got + timedelta(seconds=OWN_MAX_S))
