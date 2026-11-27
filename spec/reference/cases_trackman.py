# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Synthetic Trackman answers for spec/testvectors/trackman-olmd.json.

Made up for the vectors, in the shapes the web portal's own queries return - never recorded from a
real account. Broken answers are on purpose: a provider must map or drop every field, never fail.
"""

from __future__ import annotations

from typing import Any

REF = "Xq3c0mB1v4Lr2kq9WzT8yA5nE6pH7sJ0dF1gK2lM3oN"
AT = "2026-11-16T12:00:00Z"


def _act(id_: Any, kind: Any, time: Any = "2026-11-10T17:05:00Z", place: Any = "Example Golf Hall") -> dict[str, Any]:
    out: dict[str, Any] = {"id": id_, "time": time, "kind": kind}
    if place is not None:
        out["location"] = {"name": place}
    return out


def _shot(n: Any, club: Any, launch: Any, final: Any, *, end: Any = None, target: Any = None, carry: Any = None,
          penalty: Any = 0, result: Any = None, drop: Any = None, flight: Any = None, **points: Any) -> dict[str, Any]:
    s: dict[str, Any] = {"shotNumber": n, "club": club, "launchLie": launch, "finalLie": final,
                         "shotsToAdd": penalty, "shotResult": result,
                         "measurement": {"carry": carry, "targetDistance": target, "distanceFromPinTotal": end,
                                         **(flight or {})}}
    if drop is not None:
        s["dropPosition"] = drop
    s.update(points)
    return s


def _at(x: Any, z: Any, y: float = 50.0) -> dict[str, Any]:
    return {"x": x, "y": y, "z": z}


SIM_STROKES = [
    {"time": "2026-11-10T17:06:12Z", "club": "Iron7",
     "measurement": {"carry": 140.2, "total": 148.0, "carrySide": -3.4, "totalSide": -4.1, "ballSpeed": 50.0,
                     "clubSpeed": 36.0, "smashFactor": 1.389, "launchAngle": 17.1, "spinRate": 6812.4,
                     "spinAxis": 2.6, "curve": 3.2, "clubPath": -2.3, "faceAngle": -0.8}},
    {"time": "2026-11-10T17:07:40Z", "club": "Driver",
     "measurement": {"carry": 205.0, "carrySide": 7.9, "ballSpeed": 64.0, "spinRate": 2600}},
    {"time": "2026-11-10T17:08:02Z", "club": "Putter", "measurement": {}},  # no ball flight: left out
    {"time": "2026-11-10T17:09:30Z", "club": "PitchingWedge",
     "measurement": {"carry": None, "ballSpeed": 31.25, "launchAngle": 31.0}},  # speed without carry: kept
]

RANGE_STROKES = [
    {"time": "2026-11-11T08:00:05Z", "club": "PitchingWedge",
     "measurement": {"carry": 105.0, "totalSide": 1.5, "ballSpeed": 38.0, "ballSpin": 8900}},
    {"time": "2026-11-11T08:01:00Z", "club": "SandWedge",
     "measurement": {"carry": 72.5, "spinRate": 9400, "ballSpin": 9999}},  # spinRate wins over ballSpin
]

JUNK_STROKES = [
    None, "stroke", 17,
    {"club": "Iron8"},                                             # no measurement
    {"club": "Iron8", "measurement": "fast"},                       # not an object
    {"time": "yesterday", "club": True, "measurement": {"carry": "140", "ballSpeed": False, "total": 150.5}},
    {"time": "2026-02-30T10:00:00Z", "club": {"name": "7i"}, "measurement": {"carry": 98.0, "spinRate": "high",
                                                                          "launchAngle": [12]}},
    {"time": 1731250000, "club": "", "measurement": {"ballSpeed": 44.0, "carry": None, "clubSpeed": None}},
    {"time": "  2026-11-10T18:00:00  ", "club": "  Hybrid4  ", "measurement": {"carry": 180, "ballSpeed": 59}},
    {"time": "2026-11-10T18:01:00+01:00", "club": "Unknown", "measurement": {"carry": 0, "ballSpeed": 0}},
    {"time": "2026-11-10T18:02:00.123456789-05:30", "club": "Wedge56", "measurement": {"carry": 88.8}},
    {"time": "2026-11-10", "club": "Wood3", "measurement": {"carry": 210.0}},             # a date alone: no time
    {"time": "2026-11-10T18:03Z", "club": "Wood5", "measurement": {"carry": 195.0}},      # no seconds: no time
    {"time": "2026-11-10T18:04:00+25:00", "club": "Iron4", "measurement": {"carry": 170.0}},  # no such zone
    {"club": "Chipper", "measurement": {"carry": 30.0}},           # a name no rule reads: kept as it came
]

CLUB_NAMES = ["Driver", "Wood2", "Wood3", "Wood5", "Wood7", "Hybrid2", "Hybrid3", "Hybrid4", "Hybrid5", "Iron1",
              "Iron2", "Iron3", "Iron4", "Iron5", "Iron6", "Iron7", "Iron8", "Iron9", "PitchingWedge", "GapWedge",
              "ApproachWedge", "SandWedge", "LobWedge", "Wedge46", "Wedge50", "Wedge56", "Wedge60", "Putter",
              "Unknown", "UtilityWood19", "", None, 7]


def _club_strokes() -> list[dict[str, Any]]:
    return [{"time": f"2026-11-12T09:{i:02d}:00Z", "club": c, "measurement": {"carry": 100.0 + i}}
            for i, c in enumerate(CLUB_NAMES)]


SCORECARD = {
    "id": "SC-1001", "createdAt": "2026-10-19T20:10:00Z", "startedAt": "2026-10-19T18:00:00Z",
    "course": {"displayName": "Example Links"}, "teeName": "Yellow", "par": 72, "numberOfHolesPlayed": 18,
    "grossScore": 94, "toPar": 22,
    "stat": {"driveAverage": 201.4, "numberOfPutts": 36, "greenInRegulation": 4,
             "fairwayHitFairway": 6, "fairwayHitLeft": 3, "fairwayHitRight": 5},
    "holes": [{"holeNumber": 1, "par": 4, "grossScore": 5, "putts": 2, "greenInRegulation": False},
              {"holeNumber": 2, "par": 3, "grossScore": 3, "putts": 1, "greenInRegulation": True}],
}

BROKEN_SCORECARD = {
    "id": 4711, "createdAt": "2026-10-20T11:00:00Z", "startedAt": "soon", "course": "Example Links",
    "teeName": 7, "par": "72", "numberOfHolesPlayed": 9.0, "grossScore": 45.5, "toPar": None,
    "stat": [1, 2], "holes": [None, "x", {"holeNumber": 0, "par": 4}, {"holeNumber": "3", "par": "four",
                                                                      "grossScore": 6, "greenInRegulation": "no"}],
}

# Five holes played of nine listed: Trackman lists every hole of the round, those nobody played with 0, and counts
# them in its totals (9 holes, par 39, -11 for five holes at +1).
PARTLY_PLAYED = {
    "id": "SC-1101", "createdAt": "2026-10-18T17:00:00Z", "startedAt": "2026-10-18T15:00:00Z",
    "course": {"displayName": "Example Dunes"}, "teeName": "Black", "par": 39, "numberOfHolesPlayed": 9,
    "grossScore": 28, "toPar": -11,
    "holes": [{"holeNumber": n, "par": p, "grossScore": x, "putts": 0 if x == 0 else 2}
              for n, p, x in ((5, 4, 5), (6, 4, 4), (7, 5, 5), (8, 4, 4), (9, 4, 4), (10, 5, 0), (11, 4, 0),
                              (12, 4, 0), (13, 5, 0))],
}
# A game on the simulator (Hit It!, beside Longest Drive) comes as a scorecard of one hole without a stroke.
GAME_CARD = {
    "id": "SC-1102", "createdAt": "2026-11-22T16:30:00Z", "startedAt": "2026-11-22T16:30:00Z",
    "course": {"displayName": "Example Range Game"}, "par": 3, "numberOfHolesPlayed": 1, "grossScore": 0, "toPar": -3,
    "holes": [{"holeNumber": 1, "par": 3, "grossScore": 0, "putts": 0}],
}

CHAIN_HOLES = [{"holeNumber": 1, "shots": [
    _shot(2, "Iron8", "Fairway", "Green", end=6.4, target=150.0, carry=139.5),  # out of order: sorted
    _shot(1, "Driver", "Tee", "Fairway", end=142.0, target=230.0, carry=221.0),  # aimed short of the flag
    _shot(3, "Putter", "Green", "Green", end=0.8),
    _shot(4, "Putter", "Green", "Hole", result="Holed"),
]}, {"holeNumber": 7, "shots": [
    _shot(1, "Iron7", "Tee", "Water", end=12.0, target=145.0, penalty=1, drop={"x": 3.2}),
    _shot(2, "Wedge56", "Fairway", "Green", end=3.1, target=35.0),   # played from the drop
    _shot(3, "Putter", "Green", "Green", end=0.4, drop={"x": 1.0}),  # a drop alone: from where it was dropped
]}]

POINT_HOLES = [{"holeNumber": 4, "pinPosition": _at(1000.0, 500.0, 57.3), "shots": [
    _shot(1, "Driver", "Tee", "Fairway", result="NormalShot", launchPosition=_at(1000.0, 850.0, 61.0),
          finalPosition=_at(1054.0, 572.0, 52.0)),
    _shot(2, "Wedge52", "Fairway", "Green", penalty=2, result="AutoPutt", launchPosition=_at(1054.0, 572.0),
          finalPosition=_at(1003.0, 504.0, 57.6)),
]}, {"holeNumber": 5, "pinPosition": _at(10.0, 10.0), "shots": [
    _shot(1, "Iron7", "Tee", "Green", end=7.5, target=150.0),  # no positions: read as before
    _shot(2, "Putter", "Green", "Hole", result="Holed", launchPosition={"x": "far", "z": 1}, finalPosition=None),
]}, {"holeNumber": 6, "pinPosition": _at(0.0, 0.0), "shots": [
    _shot(1, "Iron7", "Tee", "Water", penalty=1, result="Water", launchPosition=_at(0.0, 150.0),
          finalPosition=_at(3.0, 20.0)),
    _shot(2, "Wedge56", "Green", "Green", penalty=1, result="Gimme", launchPosition=_at(0.0, 30.0),
          finalPosition=_at(0.0, 0.6)),
    _shot(3, "Putter", "Green", "Green", launchPosition=_at(0.2, 0.3), finalPosition=_at(0.0, 0.0)),  # too close
]}, {"holeNumber": 8, "pinPosition": _at(100.0, 100.0), "shots": [
    _shot(1, "Iron7", "Rough", "HoleCup", result="Pickup", penalty=2),   # a pick-up: no penalty
    _shot(2, "Iron6", "Tee", "Fairway", penalty=9, result="Rehit"),      # at most 5
    _shot(3, "Iron5", "Tee", "Fairway", launchPosition=_at(100.0, 1100.0), finalPosition=_at(2100.0, 100.0)),
]}]

# Asked with the ball and club data (1.4.0): each shot's measurement as a bay stroke's, a putt without it.
MEASURED_HOLES = [{"holeNumber": 1, "shots": [
    _shot(1, "Hybrid4", "Tee", "Fairway", end=150.0, target=380.0, carry=183.4,
          flight={"total": 201.0, "ballSpeed": 66.2, "clubSpeed": 45.1, "smashFactor": 1.468, "launchAngle": 11.9,
                  "spinRate": 2950.0, "spinAxis": -4.2, "carrySide": -6.1, "totalSide": -9.8, "curve": -5.5,
                  "clubPath": 1.9, "faceAngle": -1.2}),
    _shot(2, "Hybrid4", "Fairway", "Green", end=9.0, target=150.0, carry=158.0,
          flight={"total": 166.5, "ballSpeed": 55.9, "launchAngle": 15.2, "ballSpin": 4100.0}),  # range's spin name
    _shot(3, "Putter", "Green", "Hole", result="Holed", flight={"ballSpeed": None, "spinRate": "fast"}),
]}]

JUNK_HOLES = [None, "x", {"holeNumber": 99, "shots": [_shot(1, "Iron7", "Tee", "Green")]},
              {"holeNumber": "3", "shots": [None, {"shotNumber": "x"},
                                            _shot(1, None, 5, "Green", end="far", target=-3, carry=1e9),
                                            _shot(1, "Iron9", "Tee", "Green", end=2.0)]},
              {"holeNumber": 9, "shots": "none"}, {"holeNumber": True, "shots": []},
              {"holeNumber": 10, "pinPosition": _at(1e7, 0.0),
               "shots": [_shot(31, "Iron7", "Tee", "Green"), _shot(0, "Iron7", "Tee", "Green"),
                         _shot(1.0, "Iron8", "Tee", "Green", launchPosition=_at(0.0, 100.0),
                               finalPosition=_at(0.0, 0.0), carry=501, penalty="1")]}]


def cases() -> list[dict[str, Any]]:
    def case(name: str, why: str, **fetched: Any) -> dict[str, Any]:
        return {"name": name, "why": why, "input": {"fetched": fetched, "account_ref": REF, "generated_at": AT}}

    return [
        case("simulator_session", "A bay session: ball and club data, a stroke without flight left out.",
             sessions=[{"activity": _act("ACT-1", "SIMULATOR"), "node": {"strokes": SIM_STROKES}}]),
        case("range_session", "A range session names its spin ballSpin and may send only the total side; "
             "where both spins come, spinRate wins.",
             sessions=[{"activity": _act("ACT-2", "RANGE_PRACTICE", "2026-11-11T08:00:00Z", "Example Range"),
                        "node": {"strokes": RANGE_STROKES}}]),
        case("session_kinds", "Kinds map to olmd's; unknown ones are 'other'; played rounds and sessions without "
             "an id are no sessions; a number as id is written out.",
             sessions=[{"activity": _act("ACT-3", "VIRTUAL_RANGE"), "node": {"strokes": []}},
                       {"activity": _act("ACT-4", "SHOT_ANALYSIS", place=None), "node": {"strokes": []}},
                       {"activity": _act("ACT-5", "PERFORMANCE_CENTER", place="  "), "node": {"strokes": []}},
                       {"activity": _act("ACT-6", "SOMETHING_NEW"), "node": {"strokes": []}},
                       {"activity": _act("ACT-7", None, time=None), "node": {}},
                       {"activity": _act("ACT-8", "COURSE_PLAY"), "node": {"strokes": []}},
                       {"activity": _act(None, "SIMULATOR"), "node": {"strokes": []}},
                       {"activity": _act(9001, "MAP_MY_BAG"), "node": {"strokes": []}},
                       {"activity": _act("ACT-10", "RANGE_FIND_MY_DISTANCE"), "node": None},
                       {"activity": _act("ACT-11", "SIMULATOR"), "node": {"strokes": "failed"}},
                       {"activity": "ACT-12", "node": {"strokes": []}}]),
        case("junk_strokes", "Every field may be missing or of the wrong type: mapped or dropped, never fatal. "
             "Numbers written as text are dropped; times are RFC 3339 only.",
             sessions=[{"activity": _act("ACT-20", "SIMULATOR"), "node": {"strokes": JUNK_STROKES}}]),
        case("club_names", "Trackman's club names and their canonical codes.",
             sessions=[{"activity": _act("ACT-30", "MAP_MY_BAG"), "node": {"strokes": _club_strokes()}}]),
        case("scorecard", "A simulator round's scorecard; its totals are those of the holes it lists.",
             scorecards=[SCORECARD]),
        case("scorecard_played", "Only the holes played count: a hole listed with 0 strokes is left out and the totals "
             "are those of the holes played; a scorecard without a stroke on any hole (a game such as Hit It!) is no "
             "round. A hole without its par leaves the par to Trackman only while no hole was left out.",
             scorecards=[PARTLY_PLAYED, GAME_CARD,
                         {**PARTLY_PLAYED, "id": "SC-1103", "holes": [{"holeNumber": 1, "par": 4, "grossScore": 5},
                                                                      {"holeNumber": 2, "grossScore": 3}],
                          "par": 7, "numberOfHolesPlayed": 2, "grossScore": 8, "toPar": 1},
                         {**PARTLY_PLAYED, "id": "SC-1104", "holes": [{"holeNumber": 1, "par": 4, "grossScore": 5},
                                                                      {"holeNumber": 2, "grossScore": 3},
                                                                      {"holeNumber": 3, "par": 4, "grossScore": 0}],
                          "par": 11, "numberOfHolesPlayed": 3, "grossScore": 8, "toPar": -3}]),
        case("broken_scorecard", "Text where numbers belong, a course that is no object, holes that are no holes.",
             scorecards=[BROKEN_SCORECARD, None, {"id": ""}, {"id": True}, {"id": "SC-1001"}]),
        case("round_shots_chain", "Without positions each shot starts where the one before stopped; after a "
             "penalty or a drop at Trackman's target distance; a holed shot ends at 0.",
             scorecards=[{**SCORECARD, "id": "SC-2001"}], round_shots=[{"id": "SC-2001", "holes": CHAIN_HOLES}]),
        case("round_shots_points", "With positions the distances to the flag and where each shot came to rest "
             "against the line to it are worked out from x and z; putts the simulator adds, gimmes and "
             "pick-ups are no penalties.",
             round_shots=[{"id": "SC-1999", "holes": POINT_HOLES}]),
        case("round_shots_junk", "Holes and shots that are none are left out; the first shot of a number wins.",
             round_shots=[{"id": "SC-1998", "holes": JUNK_HOLES}, {"id": None, "holes": []}, "SC-1997"]),
        case("rounds_merged", "Shots join their scorecard; shots for a round sent earlier come with its id only; "
             "a round without shots at Trackman carries shots: [].",
             scorecards=[{**SCORECARD, "id": "SC-3001"}, {**SCORECARD, "id": "SC-3002"}],
             round_shots=[{"id": "SC-3001", "holes": CHAIN_HOLES[:1]}, {"id": "SC-2500", "holes": CHAIN_HOLES[1:]},
                          {"id": "SC-3001", "holes": POINT_HOLES}],
             shots_none=["SC-3002", "SC-2400", 2300, None, "SC-3001"]),
        case("round_shots_measured", "Asked with ball and club data: each shot carries them as a bay stroke "
             "does (carry and total stay the shot's own fields), and the round says it was asked "
             "(shots_measured). Shots asked without them carry none, and their round says nothing.",
             round_shots=[{"id": "SC-4001", "holes": MEASURED_HOLES, "measured": True},
                          {"id": "SC-4002", "holes": CHAIN_HOLES[:1], "measured": False},
                          {"id": "SC-4003", "holes": MEASURED_HOLES, "measured": "yes"}]),
        case("round_shots_refused", "What Trackman refused of the question goes with the round in its extra: the fields "
             "it named (names only; anything else is dropped) and its words, at most 300 characters. A round "
             "asked without the values at all carries Trackman's words alone.",
             round_shots=[{"id": "SC-4101", "holes": MEASURED_HOLES, "measured": True,
                           "refused": ["spinRate", "curve", 7, "a b", "spinRate"],
                           "said": "  The field `spinRate` does not exist on the type `ShotMeasurement`. " + "x" * 400},
                          {"id": "SC-4102", "holes": CHAIN_HOLES[:1], "measured": False,
                           "said": "Unexpected Execution Error"},
                          {"id": "SC-4103", "holes": CHAIN_HOLES[:1], "measured": True, "refused": [], "said": "  "}]),
        case("nothing_new", "A sync that found nothing new is an empty batch, not an error."),
    ]
