# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Reading untrusted values: what a provider answered may be missing or of any type.

Every helper maps a value or drops it (None); none of them raises. They are deliberately
narrow so that the TypeScript port can match them exactly: numbers are JSON numbers only
(a number written as text is dropped), times are RFC 3339 only, and digits are ASCII digits
(Python's \\d would also take other scripts' digits, which no other language reads alike).
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

# RFC 3339 date-time; a time without a zone is read as UTC (spec/olmd.md, "Times").
_TIME = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})?$", re.ASCII)


def num(v: Any) -> float | int | None:
    """A finite JSON number, as it came (an int stays an int)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if math.isfinite(v) else None


def integer(v: Any) -> int | None:
    """A whole number: an int, a float without a fraction, or digits written as text."""
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return int(v) if math.isfinite(v) and v == int(v) else None
    if isinstance(v, str) and re.fullmatch(r"\s*[+-]?\d{1,9}\s*", v, re.ASCII):
        return int(v)
    return None


def text(v: Any, n: int) -> str | None:
    """A non-empty string, trimmed and cut to n characters."""
    return v.strip()[:n] if isinstance(v, str) and v.strip() else None


def when(v: Any) -> str | None:
    """An RFC 3339 time with its zone, or None. Without a zone it is UTC: 'Z' is added."""
    if not isinstance(v, str):
        return None
    s = v.strip()
    m = _TIME.match(s)
    if not m:
        return None
    try:
        datetime(*(int(m.group(i)) for i in range(1, 7)))
    except ValueError:
        return None  # 30 February, hour 25 ...
    zone = m.group(8)
    if zone and zone != "Z":
        hh, mm = int(zone[1:3]), int(zone[4:6])
        if hh > 23 or mm > 59:
            return None
    return s if zone else s + "Z"


def put(out: dict[str, Any], key: str, value: Any) -> None:
    """olmd leaves out what is unknown: no nulls, no empty groups."""
    if value is None or value == {}:
        return
    out[key] = value
