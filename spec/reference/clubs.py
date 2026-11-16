# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Club names: "7 Iron", "7i", "Eisen 7", "I7" -> "7i"; "Driver"/"Dr" -> "Dr" ...

The canonical codes of olmd/1 (spec/olmd.md, "Clubs"): Dr, nW, nH, ni, PW, GW, SW, LW, NN° (a
wedge by its loft) and Putter. A name none of the rules reads is kept as it came (trimmed), so
nothing a player named is lost; "unknown" means no club was set.
"""

from __future__ import annotations

import re

_CLUB_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # "d": some monitors write the driver as one letter.
    (re.compile(r"^(driver|dr|d|1 ?w|1 ?wood|wood ?1|1 ?(?:er )?holz|holz ?1|madera ?1|hout ?1|1 ?hout)$"), "Dr"),
    (re.compile(r"^(putter|pt)$"), "Putter"),
    (re.compile(r"^(pw|pitching ?wedge|p)$"), "PW"),
    (re.compile(r"^(gw|aw|uw|gap ?wedge|approach ?wedge)$"), "GW"),
    (re.compile(r"^(sw|sand ?wedge|s)$"), "SW"),
    (re.compile(r"^(lw|lob ?wedge|low ?wedge|l)$"), "LW"),  # "low": how dictation hears "lob"
]
# "7 Iron", "7i", "Eisen 7", "7er Eisen" / "7er" (an iron) / "3er Holz"; Spanish and Dutch:
# "Hierro 7", "Madera 3", "Híbrido 4", "IJzer 7", "Hout 3"; "I7", "W3"; "IRON7".
_KINDS = r"w|wood|holz|madera|hout|h|hy|hybrid|híbrido|hibrido|rescue|i|iron|eisen|hierro|ijzer"
_NUMBERED = re.compile(
    rf"^(?:(?P<n1>\d{{1,2}}) ?(?:er )?(?P<k1>{_KINDS})"
    rf"|(?P<k2>{_KINDS}) ?(?P<n2>\d{{1,2}})"
    r"|(?P<n3>\d{1,2}) ?er)$"
)
_WEDGE_DEG = re.compile(r"^(?:(\d{2}) ?(?:°|deg|degree|grad)?(?: ?wedge)?|wedge ?(\d{2}) ?(?:°|deg|degree|grad)?)$")

UNKNOWN_CLUB = "unknown"
_NO_CLUB = {"", "unknown", "unbekannt", "none", "null", "n/a", "na", "?", "-", "kein", "no club", "other", "sonstige"}


def is_unknown_club(club: str | None) -> bool:
    return club is None or club.strip().lower() in _NO_CLUB


def normalize_club(raw: str) -> str:
    """A short canonical club code, or the cleaned input if no rule reads it."""
    if is_unknown_club(raw):
        return UNKNOWN_CLUB
    s = raw.strip().lower().replace("-", " ").replace("_", " ")
    s = re.sub(r"\s+", " ", s)
    for pattern, code in _CLUB_PATTERNS:
        if pattern.match(s):
            return code
    m = _NUMBERED.match(s)
    if m:
        n = m.group("n1") or m.group("n2") or m.group("n3")
        kind = m.group("k1") or m.group("k2") or "i"
        if kind in ("w", "wood", "holz", "madera", "hout"):
            return f"{n}W"
        if kind in ("h", "hy", "hybrid", "híbrido", "hibrido", "rescue"):
            return f"{n}H"
        if int(n) >= 40:  # "56er" is a wedge's loft, never an iron
            return f"{n}°"
        return f"{n}i"
    m = _WEDGE_DEG.match(s)
    if m and 40 <= int(m.group(1) or m.group(2)) <= 70:  # a wedge's loft ("12" is a shot number)
        return f"{m.group(1) or m.group(2)}°"
    return raw.strip()


# Trackman writes its clubs in CamelCase ("Iron7", "PitchingWedge", "Wood3"): split into words first.
_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z0-9])|(?<=[0-9])(?=[A-Za-z])")


def camel_club(raw: object) -> str:
    """'Iron7' -> '7i', 'PitchingWedge' -> 'PW', 'Wood3' -> '3W', 'Driver' -> 'Dr'; anything that is
    no name at all -> 'unknown'."""
    if not isinstance(raw, str) or not raw.strip():
        return UNKNOWN_CLUB
    return normalize_club(_CAMEL.sub(" ", raw.strip()))
