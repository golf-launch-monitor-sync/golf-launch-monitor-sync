# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Club names: "7 Iron", "7i", "Eisen 7", "I7" -> "7i"; "Driver"/"Dr" -> "Dr" ...

The canonical codes of olmd/1 (spec/olmd.md, "Clubs"): Dr, nW, nH, ni, PW, GW, SW, LW, NN° (a
wedge by its loft) and Putter. A name none of the rules reads is kept as it came (trimmed), so
nothing a player named is lost; "unknown" means no club was set. Digits and the spaces inside a
name are ASCII only (re.ASCII), so every language reads a name alike.
"""

from __future__ import annotations

import re

_CLUB_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # "d": some monitors write the driver as one letter.
    (re.compile(r"^(driver|dr|d|1 ?w|1 ?wood|wood ?1|1 ?(?:er )?holz|holz ?1|madera ?1|hout ?1|1 ?hout)$", re.ASCII), "Dr"),
    (re.compile(r"^(putter|pt)$", re.ASCII), "Putter"),
    # A wedge's name alone ("Pitching", "Sand") or with a letter ("S Wedge"), as some monitors shorten it.
    (re.compile(r"^(pw|pitching ?wedge|pitching|p ?wedge|p)$", re.ASCII), "PW"),
    # AW and UW are GW: which of a player's wedges they mean is the target's question, not a code.
    (re.compile(r"^(gw|aw|uw|gap ?wedge|approach ?wedge|gap|approach|g ?wedge|a ?wedge)$", re.ASCII), "GW"),
    (re.compile(r"^(sw|sand ?wedge|sand|s ?wedge|s)$", re.ASCII), "SW"),
    (re.compile(r"^(lw|lob ?wedge|low ?wedge|lob|l ?wedge|l)$", re.ASCII), "LW"),  # "low": how dictation hears "lob"
]
# "7 Iron", "7i", "Eisen 7", "7er Eisen" / "7er" (an iron) / "3er Holz"; Spanish and Dutch:
# "Hierro 7", "Madera 3", "Híbrido 4", "IJzer 7", "Hout 3"; "I7", "W3"; "IRON7". A fairway wood
# ("3 FW", "Fairway 5") is a wood; a utility or driving iron ("4U", "UT 3", "Utility 4", "3 DI") the
# iron of its number.
_WOODS = ("w", "wood", "holz", "madera", "hout", "fw", "fwy", "fairway", "fairway wood")
_HYBRIDS = ("h", "hy", "hyb", "hybrid", "híbrido", "hibrido", "rescue")
_KINDS = ("fairway wood|fairway|fwy|fw|w|wood|holz|madera|hout|hyb|hybrid|hy|h|híbrido|hibrido|rescue|"
          "driving iron|utility iron|utility|util|ut|u|di|i|iron|eisen|hierro|ijzer")
_NUMBERED = re.compile(
    rf"^(?:(?P<n1>\d{{1,2}}) ?(?:er )?(?P<k1>{_KINDS})"
    rf"|(?P<k2>{_KINDS}) ?(?P<n2>\d{{1,2}})"
    r"|(?P<n3>\d{1,2}) ?er)$",
    re.ASCII,
)
_WEDGE_DEG = re.compile(r"^(?:(\d{2}) ?(?:°|deg|degree|grad)?(?: ?wedge)?|wedge ?(\d{2}) ?(?:°|deg|degree|grad)?)$", re.ASCII)
# A wedge named with its loft ("SW 56", "56° Sand Wedge", "LW60"): the loft says more than the name.
_WEDGE_NAMES = r"(?:pw|gw|aw|uw|sw|lw|pitching|gap|approach|sand|lob)(?: ?wedge)?"
_NAMED_DEG = re.compile(
    rf"^(?:(\d{{2}}) ?(?:°|deg|degree|grad)? ?{_WEDGE_NAMES}|{_WEDGE_NAMES} ?(\d{{2}}) ?(?:°|deg|degree|grad)?)$",
    re.ASCII,
)

UNKNOWN_CLUB = "unknown"
_NO_CLUB = {"", "unknown", "unbekannt", "none", "null", "n/a", "na", "?", "-", "kein", "no club", "other", "sonstige"}


def is_unknown_club(club: str | None) -> bool:
    return club is None or club.strip().lower() in _NO_CLUB


def normalize_club(raw: str) -> str:
    """A short canonical club code, or the cleaned input if no rule reads it."""
    if is_unknown_club(raw):
        return UNKNOWN_CLUB
    s = raw.strip().lower().replace("-", " ").replace("_", " ")
    s = re.sub(r"\s+", " ", s, flags=re.ASCII)
    for pattern, code in _CLUB_PATTERNS:
        if pattern.match(s):
            return code
    m = _NUMBERED.match(s)
    if m:
        n = m.group("n1") or m.group("n2") or m.group("n3")
        kind = m.group("k1") or m.group("k2") or "i"
        if kind in _WOODS:
            return f"{n}W"
        if kind in _HYBRIDS:
            return f"{n}H"
        if int(n) >= 40:  # "56er" is a wedge's loft, never an iron
            return f"{n}°"
        return f"{n}i"
    for pattern in (_WEDGE_DEG, _NAMED_DEG):
        m = pattern.match(s)
        if m and 40 <= int(m.group(1) or m.group(2)) <= 70:  # a wedge's loft ("12" is a shot number)
            return f"{m.group(1) or m.group(2)}°"
    return raw.strip()


# Trackman writes its clubs in CamelCase ("Iron7", "PitchingWedge", "Wood3"): split into words first.
_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z0-9])|(?<=[0-9])(?=[A-Za-z])", re.ASCII)


def camel_club(raw: object) -> str:
    """'Iron7' -> '7i', 'PitchingWedge' -> 'PW', 'Wood3' -> '3W', 'Driver' -> 'Dr'; anything that is
    no name at all -> 'unknown'."""
    if not isinstance(raw, str) or not raw.strip():
        return UNKNOWN_CLUB
    return normalize_club(_CAMEL.sub(" ", raw.strip()))
