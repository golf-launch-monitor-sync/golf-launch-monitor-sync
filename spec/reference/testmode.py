# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""A target's test scenario as a client reads it (spec/test-mode.md). Since 1.8.0.

`GET /test-scenario` answers with made-up answers of a provider, in the provider's own shapes, which a
client plays back to its real provider code instead of asking the provider. The answer is untrusted like
everything a target sends: read strictly, the required parts must be right or the scenario is refused; a
bad response time is dropped (it only shapes the pace) - never an exception, never a guess.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import values

#: A scenario larger than this (bytes of the answer's body) a client refuses before reading it.
MAX_BYTES = 64 * 1024 * 1024
#: The longest response time a scenario may ask for, median or spread (seconds).
MAX_LATENCY_S = 60
#: At most this many queries with a response time of their own; the rest are dropped.
MAX_QUERIES = 50

_PROVIDER = re.compile(r"[a-z][a-z0-9_-]{1,39}", re.ASCII)
_SUBJECT = re.compile(r"[\x21-\x7e]{1,200}", re.ASCII)
_QUERY = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,63}", re.ASCII)
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_ZONED = re.compile(r".*(Z|[+-][0-9]{2}:[0-9]{2})", re.ASCII)


def instant_ms(t: str) -> int:
    """An RFC 3339 time (already checked) as milliseconds since 1970; a fraction counts to the millisecond,
    so that every language compares alike."""
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})", t, re.ASCII)
    assert m is not None
    base = datetime(*(int(m.group(i)) for i in range(1, 7)), tzinfo=timezone.utc)
    ms = int((m.group(7) or "0")[:3].ljust(3, "0"))
    zone = m.group(8)
    if zone != "Z":
        sign = 1 if zone[0] == "+" else -1
        base -= sign * timedelta(hours=int(zone[1:3]), minutes=int(zone[4:6]))
    return int((base - datetime(1970, 1, 1, tzinfo=timezone.utc)).total_seconds()) * 1000 + ms


def _latency(v: Any) -> dict[str, Any] | None:
    if not isinstance(v, dict):
        return None
    median, spread = values.num(v.get("median_s")), values.num(v.get("spread_s"))
    if median is None or spread is None or not (0 <= median <= MAX_LATENCY_S) or not (0 <= spread <= MAX_LATENCY_S):
        return None
    return {"median_s": median, "spread_s": spread}


def _time(v: Any) -> str | None:
    """A time with its zone: a scenario's end is no time to guess the zone of."""
    t = values.when(v)
    return t if t is not None and isinstance(v, str) and t == v and _ZONED.fullmatch(v) else None


def read_scenario(answer: Any, now: str) -> dict[str, Any]:
    """The answer of GET /test-scenario -> {ok: true, scenario} or {ok: false, error}. `now`: the client's clock."""
    if not isinstance(answer, dict):
        return {"ok": False, "error": "invalid:scenario"}
    name = answer.get("name")
    if not isinstance(name, str) or not 1 <= len(name) <= 100 or _CONTROL.search(name) or not name.strip(" "):
        return {"ok": False, "error": "invalid:name"}
    provider = answer.get("provider")
    if not isinstance(provider, str) or not _PROVIDER.fullmatch(provider):
        return {"ok": False, "error": "invalid:provider"}
    subject = answer.get("subject")
    if not isinstance(subject, str) or not _SUBJECT.fullmatch(subject):
        return {"ok": False, "error": "invalid:subject"}
    for key in ("profile", "data"):
        if not isinstance(answer.get(key), dict):
            return {"ok": False, "error": f"invalid:{key}"}
    until = _time(answer.get("valid_until"))
    if until is None:
        return {"ok": False, "error": "invalid:valid_until"}
    # A clock that can't be read counts as past every end: better no test than one past its end.
    if _time(now) is None or instant_ms(now) >= instant_ms(until):
        return {"ok": False, "error": "expired"}
    latency: dict[str, Any] = {"queries": {}}
    raw = answer.get("latency")
    if isinstance(raw, dict):
        default = _latency(raw.get("default"))
        if default is not None:
            latency["default"] = default
        queries = raw.get("queries")
        for q, v in (queries.items() if isinstance(queries, dict) else []):
            entry = _latency(v)
            if entry is not None and _QUERY.fullmatch(q) and len(latency["queries"]) < MAX_QUERIES:
                latency["queries"][q] = entry
    return {"ok": True, "scenario": {"name": name, "provider": provider, "subject": subject,
                                     "profile": answer["profile"], "data": answer["data"], "latency": latency,
                                     "valid_until": until}}
