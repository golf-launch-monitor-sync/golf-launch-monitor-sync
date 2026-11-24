# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The client's sign-in as a target hears it, and the browser extension's bridge on a target's page
(spec/target-api.md, *The client's sign-in*; spec/page-bridge.md). Since 1.5.0.

Everything here reads untrusted input: a query parameter a client sent, a message a page posted, a
reply the extension posted into a page. It reads strictly and answers None for anything it can't
take - never an exception, never a guess.
"""

from __future__ import annotations

import re
from typing import Any

#: What a client says about its provider sign-in (`signin` on GET /plan and GET /status).
SIGN_IN = ("none", "confirm", "ready", "expired", "other")
#: What a page may ask the extension.
ASKS = ("state", "fetch")
#: Why the page asks for a fetch (since 1.12.0): `manual` (the player tapped, the default) or `open` (the player came
#: back to the target app; the extension asks the plan with `reason=open`, so the target decides).
FETCH_REASONS = ("manual", "open")
#: How a fetch the page started ended (the `finished` reply).
OUTCOMES = ("synced", "not_due", "other_account", "failed", "guard", "signin")
#: The bridge's protocol version: a message of another is not this protocol's.
VERSION = 1
#: Between two fetches a page starts for the same pairing, at least this long (seconds).
FETCH_GAP_S = 10

_ID = re.compile(r"[A-Za-z0-9_-]{1,64}", re.ASCII)
_TIME = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})",
                   re.ASCII)


def read_signin(values: Any) -> str | None:
    """The `signin` query parameter, given as the list of its values in the request: exactly one, and one
    of SIGN_IN; anything else (missing, twice, another spelling) is no answer."""
    if not isinstance(values, list) or len(values) != 1:
        return None
    v = values[0]
    return v if isinstance(v, str) and v in SIGN_IN else None


def _is_one(v: Any) -> bool:
    # JSON has one kind of number: 1 and 1.0 are the same message in every language.
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == 1


def _id(v: Any) -> str | None:
    return v if isinstance(v, str) and _ID.fullmatch(v) else None


def _time(v: Any) -> str | None:
    return v if isinstance(v, str) and len(v) <= 40 and _TIME.fullmatch(v) else None


def _signin(v: Any) -> str | None:
    return v if isinstance(v, str) and v in SIGN_IN else None


def read_request(data: Any) -> dict[str, Any] | None:
    """A page's request to the extension: {"glmsync": "request", "v": 1, "id", "ask"}, a fetch with its
    `reason` (since 1.12.0; missing or unknown: `manual`). Unknown keys are ignored (a later version may add
    some)."""
    if not isinstance(data, dict) or data.get("glmsync") != "request" or not _is_one(data.get("v")):
        return None
    rid, ask = _id(data.get("id")), data.get("ask")
    if rid is None or not isinstance(ask, str) or ask not in ASKS:
        return None
    if ask != "fetch":
        return {"id": rid, "ask": ask}
    # A reason this version doesn't know is the old meaning: a manual fetch (1.11.0 and earlier sent none).
    reason = data.get("reason")
    return {"id": rid, "ask": ask, "reason": reason if reason in FETCH_REASONS else "manual"}


def read_reply(data: Any) -> dict[str, Any] | None:
    """The extension's reply to a request: {"glmsync": "reply", "v": 1, "id", "answer", ...}. An answer
    this version doesn't know, or one without the fields it needs, is no reply."""
    if not isinstance(data, dict) or data.get("glmsync") != "reply" or not _is_one(data.get("v")):
        return None
    rid, answer = _id(data.get("id")), data.get("answer")
    if rid is None or not isinstance(answer, str):
        return None
    out: dict[str, Any] = {"id": rid, "answer": answer}
    if answer == "state":
        signin, fetching = _signin(data.get("signin")), data.get("fetching")
        if signin is None or not isinstance(fetching, bool):
            return None
        out.update(signin=signin, fetching=fetching)
    elif answer in ("started", "busy", "unpaired"):
        pass
    elif answer == "signin":
        signin = _signin(data.get("signin"))
        # Signed in is no reason not to fetch.
        if signin is None or signin == "ready":
            return None
        out["signin"] = signin
    elif answer == "guard":
        until = _time(data.get("until"))
        if until is None:
            return None
        out["until"] = until
    elif answer == "finished":
        outcome = data.get("outcome")
        if not isinstance(outcome, str) or outcome not in OUTCOMES:
            return None
        out["outcome"] = outcome
        if "until" in data:
            until = _time(data.get("until"))
            if until is None:
                return None
            out["until"] = until
    else:
        return None
    return out
