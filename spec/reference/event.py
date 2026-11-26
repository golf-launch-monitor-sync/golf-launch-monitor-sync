# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""One tournament from the golf.de page the player has open (spec/hcp.md, *Taking one tournament*, 1.19.0): what a
client makes of the page's lines, by their label, as dgvevent/1's `event`.

The input is the page as a client sees it: its address, its heading and the lines under *Turnierinformationen*
(*Tournament Information* on golf.de's English page) as pairs of label and value, in the page's order. How a client
finds them in the page is its own; what it makes of them is this rule, checked by every client against
spec/testvectors/dgvevent-page.json.

- Only a tournament's page: `https://www.golf.de/sport/turnierkalender/<calendar>.html#/<number>`, maybe with the
  search the player came from after a `?` (left out of `url`: it would say where they searched). A result list
  (`#/<number>/ergebnisse`), the list itself or any other page is `not_a_tournament`.
- A line is read by its label (German or English, as golf.de's pages wrote them on 26 Nov 2026), never by its place;
  a label it doesn't know is never read, a known one twice counts the first time.
- A value that doesn't read as its field is left out, never bent: a text longer than its field, a number out of
  range, a yes/no that is neither.
- No heading or no first day it can read: `changed_page` (golf.de changed its page; nothing is sent).

Pure, standard library only.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

# What JavaScript's \s is, so both languages split the same way (Python's \s knows a few more).
WS = "[ \t\n\r\f\v   -     　﻿]"
_WS = re.compile(WS + "+")
PAGE = re.compile(r"^https://www\.golf\.de/sport/turnierkalender/([A-Za-z0-9_-]{1,60})\.html#/([0-9]{1,12})"
                  r"(?:\?[^#]*)?$")
ADDRESS_MOST = 2048
LINES_MOST = 60
VALUE_MOST = 500

# The labels, lower case with single spaces and no colon, and the field each is.
LABELS = {
    "turnierdatum": "date", "tournament date": "date",
    "turnierort": "venue", "tournament location": "venue",
    "turnierart": "play_form", "tournament type": "play_form",
    "handicap-relevant": "hcp_relevant", "handicap relevant": "hcp_relevant",
    "starttee": "tee", "start tee": "tee",
    "startzeit": "time", "start time": "time",
    "teilnehmer maximal": "max_players", "participants maximum": "max_players",
    "geschlecht": "gender", "gender": "gender",
    "gäste": "guests", "guests": "guests",
    "offenes / geschlossenes turnier": "open", "open / closed tournament": "open",
    "altersklasse": "age_class", "age group": "age_class",
    "meldeschluss online": "entry_close_online", "registration deadline online": "entry_close_online",
    "meldeschluss club": "entry_close_club", "registration deadline club": "entry_close_club",
}
TEXTS = {"venue": 200, "tee": 60, "gender": 60, "age_class": 60}
NAME_MOST = 200
PLAY_FORM_MOST = 100
PLAYERS_MOST = 9999
YES = {"ja", "yes"}
NO = {"nein", "no"}
OPEN = {"offenes turnier", "offen", "open tournament", "open"}
CLOSED = {"geschlossenes turnier", "geschlossen", "closed tournament", "closed"}
# A dash where the page has nothing to say
NOTHING = {"-", "–", "—"}
# 'Sa 28.11.2026 um 10:00 Uhr', 'Fr 27.11.2026', 'Sat 28.11.2026 at 10:00', '27.11.2026, 08:00 Uhr'
_DAY = re.compile(r"([0-9]{1,2})\.([0-9]{1,2})\.([0-9]{4})")
_TIME = re.compile(r"([0-9]{1,2}):([0-9]{2})")
# '…; 18 Löcher' in *Turnierart*: the separator before it goes with it. No look-behind: older web views lack it.
_HOLES = re.compile(r"(^|[^0-9])([0-9]{1,2})" + WS + r"*(?:löcher|loch|holes|hole)(?![a-zäöü])", re.IGNORECASE)
_TRIM = " \t\n\r\f\v;,-–—"
FIELDS = ("id", "url", "name", "date", "time", "venue", "play_form", "holes", "hcp_relevant", "tee", "max_players",
          "gender", "guests", "open", "age_class", "entry_close_online", "entry_close_club")


def plain(v: Any) -> str | None:
    """A text of the page with its spaces made single and trimmed; None for anything else or nothing."""
    if not isinstance(v, str) or len(v) > VALUE_MOST:
        return None
    s = _WS.sub(" ", v).strip(" ")
    return None if not s or s in NOTHING else s


def label_of(v: Any) -> str | None:
    s = plain(v)
    if s is None:
        return None
    s = s.rstrip(":").rstrip(" ").lower()
    return LABELS.get(s)


def page_of(address: Any) -> tuple[str, str] | None:
    """(the tournament's number, its page without the search) for a tournament's page, else None."""
    if not isinstance(address, str) or len(address) > ADDRESS_MOST:
        return None
    m = PAGE.match(address)
    if not m:
        return None
    return m.group(2), f"https://www.golf.de/sport/turnierkalender/{m.group(1)}.html#/{m.group(2)}"


def day_of(s: str) -> str | None:
    m = _DAY.search(s)
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
    except ValueError:
        return None


def time_of(s: str) -> str | None:
    """The first HH:MM in `s` that is a time of day."""
    for m in _TIME.finditer(s):
        h, mi = int(m.group(1)), int(m.group(2))
        if h <= 23 and mi <= 59:
            return f"{h:02d}:{mi:02d}"
        return None
    return None


def after_day(s: str) -> str:
    """What follows the day in a value (its time, if any)."""
    m = _DAY.search(s)
    return s[m.end():] if m else ""


def deadline_of(s: str) -> str | None:
    d = day_of(s)
    if d is None:
        return None
    t = time_of(after_day(s))
    return f"{d}T{t}" if t else d


def form_of(s: str) -> tuple[str | None, int | None]:
    """*Turnierart*: the form of play as written, and the holes it names (9 or 18; any other number: none)."""
    m = _HOLES.search(s)
    if not m:
        form = s.strip(_TRIM)
        return (form or None), None
    n = int(m.group(2))
    holes = n if n in (9, 18) else None
    rest = (s[: m.start()] + m.group(1)).rstrip(_TRIM) + " " + s[m.end():].lstrip(_TRIM)
    form = _WS.sub(" ", rest).strip(_TRIM)
    return (form or None), holes


def read_page(page: Any) -> dict[str, Any]:
    """{address, heading, lines: [[label, value], …]} -> {"event": {...}} or {"refused": "not_a_tournament" |
    "changed_page"}."""
    p = page if isinstance(page, dict) else {}
    where = page_of(p.get("address"))
    if where is None:
        return {"refused": "not_a_tournament"}
    key, url = where
    name = plain(p.get("heading"))
    lines = p.get("lines")
    seen: dict[str, str] = {}
    if isinstance(lines, list):
        for line in lines[:LINES_MOST]:
            if not isinstance(line, list) or len(line) != 2:
                continue
            field = label_of(line[0])
            value = plain(line[1])
            if field and field not in seen and value is not None:
                seen[field] = value
    first = day_of(seen["date"]) if "date" in seen else None
    if not name or len(name) > NAME_MOST or first is None:
        return {"refused": "changed_page"}
    ev: dict[str, Any] = {"id": key, "url": url, "name": name, "date": first}
    clock = time_of(seen["time"]) if "time" in seen else None
    ev["time"] = clock or time_of(after_day(seen["date"]))
    for k, most in TEXTS.items():
        if k in seen and len(seen[k]) <= most:
            ev[k] = seen[k]
    if "play_form" in seen:
        form, holes = form_of(seen["play_form"])
        if form and len(form) <= PLAY_FORM_MOST:
            ev["play_form"] = form
        if holes:
            ev["holes"] = holes
    for k in ("hcp_relevant", "guests"):
        if k in seen:
            v = seen[k].lower()
            ev[k] = True if v in YES else False if v in NO else None
    if "open" in seen:
        v = seen["open"].lower()
        ev["open"] = True if v in OPEN else False if v in CLOSED else None
    if "max_players" in seen and re.fullmatch(r"[0-9]{1,4}", seen["max_players"]):
        n = int(seen["max_players"])
        if 1 <= n <= PLAYERS_MOST:
            ev["max_players"] = n
    for k in ("entry_close_online", "entry_close_club"):
        if k in seen:
            ev[k] = deadline_of(seen[k])
    return {"event": {k: ev[k] for k in FIELDS if ev.get(k) is not None}}


def body(event: dict[str, Any], generator: dict[str, str] | None = None) -> dict[str, Any]:
    """The dgvevent/1 a client sends for `event`."""
    out: dict[str, Any] = {"format": "dgvevent/1", "provider": "golfde"}
    if generator:
        out["generator"] = generator
    out["event"] = event
    return out
