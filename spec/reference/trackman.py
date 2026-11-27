# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Trackman's answers as olmd/1: the reference the TypeScript provider must match field for field.

Input is what a provider has after fetching, in Trackman's own shapes (the fields the web portal
itself requests): the activity list, each session's strokes, the scorecards and each shot of a
round. Output is an olmd/1 batch. These are pure functions over untrusted data - every field may be
missing or of the wrong type, and is mapped or dropped, never trusted.

Units Trackman sends are already SI: metres, m/s, degrees, rpm. Values are passed on as measured;
only what is worked out here (the distances to the flag in a round) is rounded.

Unofficial: Trackman's web API is not a public, documented API, and this project is not affiliated
with or endorsed by Trackman.
"""

from __future__ import annotations

import math
import re
from typing import Any

from clubs import UNKNOWN_CLUB, camel_club
from values import integer, num, put, text, when

# Activity kinds that are played rounds, not practice: they come in as scorecards.
GAME_KINDS = frozenset({"COURSE_PLAY", "ON_COURSE", "VIRTUAL_GOLF_PLAY"})

# Trackman's activity kinds -> olmd session kinds; anything else is "other" (kind_raw keeps it).
SESSION_KINDS = {
    "RANGE_PRACTICE": "range",
    "RANGE_FIND_MY_DISTANCE": "find_my_distance",
    "FIND_MY_DISTANCE": "find_my_distance",
    "SIMULATOR": "simulator",
    "SHOT_ANALYSIS": "shot_analysis",
    "MAP_MY_BAG": "map_my_bag",
    "VIRTUAL_RANGE": "virtual_range",
    "COMBINE": "combine",
    "TRACKMAN_COMBINE": "combine",
    "COURSE_PRACTICE": "course_practice",
}

DEVICE = {"maker": "trackman"}


def club_of(raw: Any) -> tuple[str | None, str | None]:
    """(canonical code, the name as sent): no code for a shot hit without a club set."""
    code = camel_club(raw)
    return (None if code == UNKNOWN_CLUB else code[:40]), text(raw, 100)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def measured(m: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """A measurement's ball, club delivery and flight (without carry and total, which the caller
    places): the same fields for a session's stroke and a round's shot."""
    # Range activities name the spin `ballSpin`, bay activities `spinRate`.
    spin = m.get("spinRate") if m.get("spinRate") is not None else m.get("ballSpin")
    ball: dict[str, Any] = {}
    put(ball, "speed_mps", num(m.get("ballSpeed")))
    put(ball, "launch_angle_deg", num(m.get("launchAngle")))
    put(ball, "spin_rpm", num(spin))
    put(ball, "spin_axis_deg", num(m.get("spinAxis")))
    head: dict[str, Any] = {}
    put(head, "speed_mps", num(m.get("clubSpeed")))
    put(head, "path_deg", num(m.get("clubPath")))
    put(head, "face_angle_deg", num(m.get("faceAngle")))
    put(head, "smash_factor", num(m.get("smashFactor")))
    flight: dict[str, Any] = {}
    put(flight, "side_m", num(m.get("carrySide")))
    put(flight, "total_side_m", num(m.get("totalSide")))
    put(flight, "curve_m", num(m.get("curve")))
    return ball, head, flight


def stroke(st: Any) -> dict[str, Any] | None:
    """One stroke as an olmd shot, or None when it has no ball flight at all (a putt, a misread)."""
    if not isinstance(st, dict):
        return None
    m = st.get("measurement")
    if not isinstance(m, dict):
        return None
    if m.get("carry") is None and m.get("ballSpeed") is None:
        return None
    club, club_raw = club_of(st.get("club"))
    shot: dict[str, Any] = {}
    put(shot, "played_at", when(st.get("time")))
    put(shot, "club", club)
    put(shot, "club_raw", club_raw)
    ball, head, rest = measured(m)
    put(shot, "ball", ball)
    put(shot, "club_delivery", head)
    flight: dict[str, Any] = {}
    put(flight, "carry_m", num(m.get("carry")))
    put(flight, "total_m", num(m.get("total")))
    put(shot, "flight", flight | rest)
    # Since 1.25.0: the distance a combine or a test set for the shot, where the stroke carries it.
    target: dict[str, Any] = {}
    put(target, "distance_m", num(m.get("targetDistance")))
    put(shot, "target", target)
    return shot


def session(activity: Any, node: Any) -> dict[str, Any] | None:
    """An activity and its fetched node as an olmd session; None for no session at all (no id, or
    a played round, which comes as a scorecard)."""
    if not isinstance(activity, dict):
        return None
    ext = external_id(activity.get("id"))
    if ext is None:
        return None
    raw_kind = text(activity.get("kind"), 100)
    if raw_kind in GAME_KINDS:
        return None
    out: dict[str, Any] = {"external_id": ext}
    put(out, "started_at", when(activity.get("time")))
    out["kind"] = SESSION_KINDS.get(raw_kind or "", "other")
    put(out, "kind_raw", raw_kind)
    loc = activity.get("location")
    put(out, "location", {"name": name} if isinstance(loc, dict) and (name := text(loc.get("name"), 200)) else None)
    out["device"] = dict(DEVICE)
    strokes = node.get("strokes") if isinstance(node, dict) else None
    out["shots"] = [s for s in (stroke(x) for x in (strokes if isinstance(strokes, list) else [])) if s]
    return out


def external_id(v: Any) -> str | None:
    """An id as text: a string, or a whole number written out; anything else is no id."""
    if isinstance(v, str) and v.strip():
        return v.strip()[:400]
    if isinstance(v, int) and not isinstance(v, bool):
        return str(v)
    return None


# ---------------------------------------------------------------------------
# Rounds (scorecards of simulator rounds)
# ---------------------------------------------------------------------------
def scorecard(sc: Any) -> dict[str, Any] | None:
    if not isinstance(sc, dict):
        return None
    ext = external_id(sc.get("id"))
    if ext is None:
        return None
    stat = sc.get("stat") if isinstance(sc.get("stat"), dict) else {}
    course = sc.get("course") if isinstance(sc.get("course"), dict) else {}
    out: dict[str, Any] = {"external_id": ext, "kind": "simulator"}
    put(out, "played_at", when(sc.get("startedAt")) or when(sc.get("createdAt")))
    put(out, "course", {"name": n} if (n := text(course.get("displayName"), 200)) else None)
    put(out, "tee", {"name": n} if (n := text(sc.get("teeName"), 100)) else None)
    listed = 0
    holes = []
    for h in sc.get("holes") if isinstance(sc.get("holes"), list) else []:
        if not isinstance(h, dict):
            continue
        no = integer(h.get("holeNumber"))
        if no is None or not 1 <= no <= 36:
            continue
        listed += 1
        score = integer(h.get("grossScore"))
        if score is None or score < 1:
            continue  # listed, not played: Trackman lists every hole of the round, a hole nobody played with 0
        hole: dict[str, Any] = {"number": no}
        put(hole, "par", integer(h.get("par")))
        put(hole, "score", score)
        put(hole, "putts", integer(h.get("putts")))
        put(hole, "gir", h.get("greenInRegulation") if isinstance(h.get("greenInRegulation"), bool) else None)
        holes.append(hole)
    totals = {"holes_played": integer(sc.get("numberOfHolesPlayed")), "par": integer(sc.get("par")),
              "gross_score": integer(sc.get("grossScore")), "to_par": integer(sc.get("toPar"))}
    played = played_totals(holes, listed, totals)
    if played is None:
        return None
    for k, v in played.items():
        put(out, k, v)
    stats: dict[str, Any] = {}
    put(stats, "putts", integer(stat.get("numberOfPutts")))
    put(stats, "greens_in_regulation", integer(stat.get("greenInRegulation")))
    put(stats, "fairways_hit", integer(stat.get("fairwayHitFairway")))
    put(stats, "fairways_left", integer(stat.get("fairwayHitLeft")))
    put(stats, "fairways_right", integer(stat.get("fairwayHitRight")))
    put(stats, "drive_average_m", num(stat.get("driveAverage")))
    put(out, "stats", stats)
    put(out, "holes", holes or None)
    return out


def played_totals(holes: list[dict[str, Any]], listed: int, given: dict[str, Any]) -> dict[str, Any] | None:
    """A round's totals of the holes played (olmd.md, *A round*): Trackman counts the holes it lists with 0 as played
    (five holes played at +1 came as nine holes at -11), so the holes count where it lists them. The par where every
    hole played says its own, else Trackman's as long as no hole was left out; None for a card without a stroke on any
    hole (a game such as Hit It!, which is no round), and Trackman's totals for a card that lists no holes."""
    if not holes:
        return None if listed or given["gross_score"] == 0 else given
    whole = len(holes) == listed
    pars = [h.get("par") for h in holes]
    par = sum(pars) if all(isinstance(p, int) and p >= 1 for p in pars) else given["par"] if whole else None
    gross = sum(h["score"] for h in holes)
    to_par = gross - par if par is not None else given["to_par"] if whole else None
    return {"holes_played": len(holes), "par": par, "gross_score": gross, "to_par": to_par}


# Strokes Trackman adds to a shot that aren't penalties: the putts the simulator plays for the
# player once the ball is on the green ("AutoPutt"), a gimme or a conceded putt, and what a pick-up
# fills in. Penalties come as "Drop" and "Rehit" (stroke and distance).
_NOT_PENALTY = re.compile(r"putt|gimme|concede|pickup", re.IGNORECASE)


def _m(v: Any, most: float = 1000.0) -> float | None:
    """Metres, or None where it isn't a plausible distance."""
    x = num(v)
    return round(float(x), 2) + 0.0 if x is not None and 0 <= x <= most else None


def _holed(*words: str | None) -> bool:
    return any(w and ("hole" in w.lower() or "cup" in w.lower()) for w in words)


def _xz(p: Any) -> tuple[float, float] | None:
    """A point of the simulated course: x and z lie flat, y is the height. Metres: the distance
    between a shot's launch and final position is Trackman's own `total` of it."""
    if not isinstance(p, dict):
        return None
    out = []
    for k in ("x", "z"):
        v = num(p.get(k))
        if v is None or abs(v) > 1e6:
            return None
        out.append(float(v))
    return out[0], out[1]


def _from(a: tuple[float, float] | None, b: tuple[float, float] | None) -> float | None:
    return _m(math.hypot(a[0] - b[0], a[1] - b[1])) if a and b else None


def _rest(launch: tuple[float, float] | None, final: tuple[float, float] | None,
          pin: tuple[float, float] | None) -> tuple[float | None, float | None]:
    """Where a shot came to rest against the line from where it was played to the flag: metres right
    (+) or left (-) of it, past (+) or short (-) of the flag along it. Trackman's course is
    left-handed (x right, y up, z on), so right of the way forward f is (f.z, -f.x)."""
    if not (launch and final and pin):
        return None, None
    fx, fz = pin[0] - launch[0], pin[1] - launch[1]
    d = math.hypot(fx, fz)
    if d < 0.5:
        return None, None
    ux, uz = fx / d, fz / d
    rx, rz = final[0] - pin[0], final[1] - pin[1]
    side, long_ = rx * uz - rz * ux, rx * ux + rz * uz
    ok = abs(side) <= 1000 and abs(long_) <= 1000
    # + 0.0: no "-0.0" in the vectors (some languages tell it from 0).
    return (round(side, 2) + 0.0, round(long_, 2) + 0.0) if ok else (None, None)


def round_shots(holes: Any) -> list[dict[str, Any]]:
    """Each shot of a round. How far from the flag each shot started and stopped: from where it was
    played and where it came to rest against the hole's pin position. Trackman leaves its own
    distances empty in simulator rounds; where the positions are missing they are read from the shot
    before (the start where it stopped), from Trackman's target distance where nothing came before
    (the tee) or the ball was dropped. A holed shot without a distance stopped at 0."""
    rows: list[dict[str, Any]] = []
    for h in holes if isinstance(holes, list) else []:
        if not isinstance(h, dict):
            continue
        no = integer(h.get("holeNumber"))
        if no is None or not 1 <= no <= 36:
            continue
        pin = _xz(h.get("pinPosition"))
        shots: dict[int, dict[str, Any]] = {}
        for s in h.get("shots") if isinstance(h.get("shots"), list) else []:
            n = integer(s.get("shotNumber")) if isinstance(s, dict) else None
            if n is not None and 1 <= n <= 30 and n not in shots:
                shots[n] = s
        before: float | None = None  # where the ball lay, metres from the flag (None: not known)
        for n in sorted(shots):
            s = shots[n]
            m = s.get("measurement") if isinstance(s.get("measurement"), dict) else {}
            result, final = text(s.get("shotResult"), 40), text(s.get("finalLie"), 40)
            end = _from(_xz(s.get("finalPosition")), pin)
            if end is None:
                end = _m(m.get("distanceFromPinTotal"))
            if end is None and _holed(result, final):
                end = 0.0
            target = _m(m.get("targetDistance"))
            drop = s.get("dropPosition")
            dropped = isinstance(drop, dict) and any(v is not None for v in drop.values())
            added = max(0, min(5, integer(s.get("shotsToAdd")) or 0))
            penalty = 0 if result and _NOT_PENALTY.search(result) else added
            club, club_raw = club_of(s.get("club"))
            # A drop with the penalty belongs to where this shot went (the next one starts there); a
            # drop alone to where this one was played from. Where the positions are, they say it.
            launch, rest = _xz(s.get("launchPosition")), _xz(s.get("finalPosition"))
            start = _from(launch, pin)
            if start is None:
                start = target if before is None or (dropped and not penalty) else before
            side, long_ = _rest(launch, rest, pin)
            row: dict[str, Any] = {"hole": no, "number": n}
            put(row, "club", club[:20] if club else None)
            put(row, "club_raw", club_raw)
            put(row, "lie_before", text(s.get("launchLie"), 40))
            put(row, "lie_after", final)
            put(row, "result", result)
            row["penalty_strokes"] = penalty
            put(row, "to_pin_before_m", start)
            put(row, "to_pin_after_m", end)
            put(row, "rest_side_m", side)
            put(row, "rest_long_m", long_)
            put(row, "target_m", target)
            put(row, "carry_m", _m(m.get("carry"), 500))
            put(row, "total_m", _m(m.get("total"), 600))
            # Ball and club data where the shot's measurement has them (asked for since 1.4.0); carry and
            # total stay the round shot's own fields above.
            ball, head, flight = measured(m)
            put(row, "ball", ball)
            put(row, "club_delivery", head)
            put(row, "flight", flight)
            rows.append(row)
            # After a penalty or a drop the ball lies somewhere else than where it stopped.
            before = None if penalty or dropped else end
    return rows


# ---------------------------------------------------------------------------
# A batch
def refusal(entry: dict[str, Any]) -> dict[str, Any] | None:
    """What Trackman refused when a round's shots were asked for with their values, for the round's `extra`:
    `round_shot_fields_refused` (the fields it named, left out from then on) and `round_shots_refused` (its words, at
    most 300 characters). None when it refused nothing."""
    fields = [f for f in (entry.get("refused") or []) if isinstance(f, str) and re.fullmatch(r"[A-Za-z]{1,40}", f)]
    said = entry.get("said")
    said = said.strip()[:300] if isinstance(said, str) and said.strip() else None
    out: dict[str, Any] = {}
    if fields:
        out["round_shot_fields_refused"] = list(dict.fromkeys(fields))
    if said:
        out["round_shots_refused"] = said
    return out or None


# ---------------------------------------------------------------------------
def batch(fetched: dict[str, Any], *, account_ref: str, generated_at: str) -> dict[str, Any]:
    """What one fetch brought, as an olmd/1 batch.

    `fetched`: {"sessions": [{"activity", "node"}], "scorecards": [...], "round_shots": [{"id",
    "holes", "measured", "refused", "said"}], "shots_none": [ids]}. `measured` true: the shots were asked for with
    their ball and club data (the round says so: `shots_measured`); `refused` and `said`: what Trackman refused of that
    question (the round's `extra`, `refusal`). A round's shots may come without its scorecard (a round sent
    earlier whose shots are fetched now): then the round carries only its id and its shots. A round
    Trackman has no shots for carries `shots: []`; a round whose shots weren't fetched has no
    `shots` at all."""
    sessions = [s for s in (session(x.get("activity"), x.get("node")) for x in fetched.get("sessions") or []
                            if isinstance(x, dict)) if s]
    rounds: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for sc in fetched.get("scorecards") or []:
        r = scorecard(sc)
        if r and r["external_id"] not in by_id:
            by_id[r["external_id"]] = r
            rounds.append(r)
    for entry in fetched.get("round_shots") or []:
        ext = external_id(entry.get("id")) if isinstance(entry, dict) else None
        if ext is None:
            continue
        r = by_id.get(ext)
        if r is None:
            r = by_id[ext] = {"external_id": ext}
            rounds.append(r)
        if "shots" not in r:
            r["shots"] = round_shots(entry.get("holes"))
            if entry.get("measured") is True:
                r["shots_measured"] = True
            told = refusal(entry)
            if told:
                r["extra"] = {**(r.get("extra") or {}), **told}
    for x in fetched.get("shots_none") or []:
        ext = external_id(x)
        if ext is None:
            continue
        r = by_id.get(ext)
        if r is None:
            r = by_id[ext] = {"external_id": ext}
            rounds.append(r)
        r.setdefault("shots", [])
    return {"format": "olmd/1", "provider": "trackman", "account_ref": account_ref, "generated_at": generated_at,
            "sessions": sessions, "rounds": rounds}
