# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""A professional's own pages (spec/prores.md, since 1.15.0): the rules a client and a target share.

- `place_of`: the text a page writes for the player's finish ("T17", "36T", "MC", "CUT", "BP") -> the place, whether
  it was tied, or the result without a place; anything else is no place at all (a bonus line, a dash).
- `tour_of`: the short name a world ranking's page writes for a tournament's tour ("DPWT", "LPGA") -> a tour key of
  prores/1, or none (a major, a tour this version doesn't know: the tournament then names no tour).
- `same_name`: whether the name a page writes is the player's (the target's check; it keeps nothing of it).
- `iso_week`: whether a week is written as prores/1 wants it ("2026-W47").

Pure functions over plain values; spec/testvectors/prores-examples.json pins them.
"""

from __future__ import annotations

import json
import re
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any

TOURS = ("pro_golf_tour", "alps", "hotelplanner", "dp_world", "korn_ferry", "pga_tour", "let_access", "let", "epson",
         "lpga", "other")
SITES = ("owgr", "rolex")  # the world rankings a client reads since 1.15.0; tours (`tour:<key>`) come by module
RESULTS = ("MC", "WD", "DQ", "DNS")

# What a world ranking's own table writes in its tour column (spec/prores/tours.json, normative).
TOUR_CODES: dict[str, dict[str, str]] = {k: v for k, v in json.loads(
    (Path(__file__).resolve().parent.parent / "prores" / "tours.json").read_text()).items() if not k.startswith("$")}

_PLACE = re.compile(r"^(?:T(\d{1,3})|(\d{1,3})(T?))$", re.ASCII)
_RESULT = {"MC": "MC", "CUT": "MC", "WD": "WD", "RTD": "WD", "DQ": "DQ", "DSQ": "DQ", "DNS": "DNS"}
_WEEK = re.compile(r"^(\d{4})-W(\d{2})$", re.ASCII)


def place_of(text: Any) -> dict[str, Any] | None:
    """{"place": n, "tied": true?} or {"result": code}, or None."""
    if not isinstance(text, str):
        return None
    s = re.sub(r"\s+", "", text).upper()
    if s in _RESULT:
        return {"result": _RESULT[s]}
    m = _PLACE.match(s)
    if not m:
        return None
    n = int(m.group(1) or m.group(2))
    if not 1 <= n <= 999:
        return None
    return {"place": n, "tied": True} if m.group(1) or m.group(3) else {"place": n}


def tour_of(site: Any, code: Any) -> str | None:
    if not isinstance(site, str) or not isinstance(code, str):
        return None
    return TOUR_CODES.get(site, {}).get(code.strip().upper())


def iso_week(week: Any) -> bool:
    """A week as prores/1 writes it: the ISO year and week, `YYYY-Www`, a week that exists in that year."""
    m = _WEEK.match(week) if isinstance(week, str) else None
    if not m:
        return False
    year, n = int(m.group(1)), int(m.group(2))
    return 1 <= n <= date(year, 12, 28).isocalendar()[1]


_UMLAUTS = (("ä", "ae"), ("ö", "oe"), ("ü", "ue"))


def _parts(name: Any) -> set[str]:
    """A name's parts made plain: lower case, ß and umlauts spelled out, accents dropped, anything but a-z and 0-9 a
    gap (hyphens, commas, dots)."""
    if not isinstance(name, str):
        return set()
    s = name.lower().replace("ß", "ss")
    for a, b in _UMLAUTS:
        s = s.replace(a, b)
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
    return {p for p in re.split(r"[^a-z0-9]+", s) if p}


def same_name(page: Any, player: Any) -> bool:
    """Every part of the shorter name among the other's parts, and at least two of them: "MUSTERFRAU, Lena" is
    "Lena Marie Musterfrau", "Musterfrau" alone isn't."""
    a, b = _parts(page), _parts(player)
    short, other = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 2 and short <= other
