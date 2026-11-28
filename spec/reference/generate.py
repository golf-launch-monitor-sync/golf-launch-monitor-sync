# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Writes spec/testvectors/*.json from the reference implementation in this folder.

    python3 spec/reference/generate.py          # write
    python3 spec/reference/generate.py --check  # fail if a file differs from what would be written

Standard library only. Every implementation of a rule (packages/core, a provider, a target) reads
these files instead of keeping its own idea of the rule.
"""

from __future__ import annotations

import copy
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import account  # noqa: E402
import ask  # noqa: E402
import bridge  # noqa: E402
import cases_event  # noqa: E402
import cases_trackman  # noqa: E402
import clubs  # noqa: E402
import deeplinks  # noqa: E402
import event  # noqa: E402
import guard  # noqa: E402
import handover  # noqa: E402
import hcp  # noqa: E402
import plan  # noqa: E402
import cases_prores  # noqa: E402
import prores  # noqa: E402
import testmode  # noqa: E402
import trackman  # noqa: E402
import values  # noqa: E402
import wake  # noqa: E402

SPEC = HERE.parent
OUT = SPEC / "testvectors"
VERSION = (SPEC / "VERSION").read_text().strip()


def doc(comment: str, cases: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"$comment": comment, "spec_version": VERSION, "generated_by": "spec/reference/generate.py",
            **extra, "cases": cases}


# ---------------------------------------------------------------------------
def trackman_vectors() -> dict[str, Any]:
    out = []
    for c in cases_trackman.cases():
        i = c["input"]
        out.append({**c, "expected": trackman.batch(copy.deepcopy(i["fetched"]), account_ref=i["account_ref"],
                                                    generated_at=i["generated_at"])})
    return doc("Trackman's answers (synthetic) -> olmd/1 batches. input.fetched: {sessions: [{activity, node}], "
               "scorecards, round_shots: [{id, holes}], shots_none}. Compare as JSON values; numbers exactly, "
               "except in rounds[].shots[] where a number may differ by compare.round_shot_tolerance (rounding "
               "to centimetres differs between languages at exact halves).", out,
               compare={"round_shot_tolerance": 0.011})


def club_vectors() -> dict[str, Any]:
    camel = [{"raw": r, "code": clubs.camel_club(r)} for r in cases_trackman.CLUB_NAMES + [
        "  Iron7 ", "IRON7", "Iron10", "Wedge12", "Wedge72", {"x": 1}, True,
        # Only ASCII digits are digits; the ends are trimmed of what Python calls a space (not U+FEFF).
        "Iron\u0667", "\x1cIron7\u2003", "\ufeffDriver"]]
    generic = ["7 Iron", "7i", "I7", "Eisen 7", "7er Eisen", "7er", "3er Holz", "Hierro 7", "Madera 3",
               "Híbrido 4", "IJzer 7", "Hout 3", "W3", "3 wood", "Rescue 5", "56", "56°", "56 deg", "Wedge 52",
               "52 Grad", "56er", "12", "D", "dr", "1W", "Pitching Wedge", "AW", "Gap-Wedge", "sand_wedge", "lob wedge",
               "low wedge", "PT", "unknown", "N/A", "-", "", "  ", "Chipper", "Hybrid", "Iron 10", "10 iron",
               "Eisen \u0667", "\u0665\u0666", "7\u00a0Iron", "\u00a07 Iron\u2003", "7\tiron", "\ufeff7 Iron",
               "\U0001d7d5 iron", "Wedge \u0665\u0666", "Pitching\u200aWedge",
               # Utility and driving irons are the iron of their number; fairway woods are woods.
               "4U", "U4", "Utility 4", "4 Utility", "UT 3", "3 DI", "Driving Iron 2", "2 Utility Iron",
               "3 FW", "FW3", "Fairway 5", "5 Fairway Wood", "3 Fwy", "4 Hyb",
               # A wedge's name alone or with a letter; a wedge with its loft in the name is the loft.
               "Sand", "Pitching", "Lob", "Gap", "Approach", "S Wedge", "P-Wedge", "UW", "SW 56", "56 SW",
               "56° Sand Wedge", "LW60", "50 Gap Wedge", "Approach 52", "SW 12",
               # A maker's or a player's own name stays as it came: the target asks what it is.
               "Stealth 7i", "TSR3", "Mein 7er", "Vokey"]
    # A grid of numbers and kinds in both orders, so a rule that reads one spelling differently in one language (or
    # newly reads a name an older rule read as something else) shows beyond the hand-picked names above.
    grid_kinds = ["", "u", "ut", "utility", "di", "driving iron", "fw", "fwy", "fairway", "fairway wood", "hyb",
                  "h", "hybrid", "w", "wood", "i", "iron", "er", "deg", "°", "wedge", "sw", "pw", "gw", "lw", "aw",
                  "sand", "lob", "gap", "approach", "pitching", "s wedge", "sand wedge", "d", "dr", "pt"]
    grid: list[str] = []
    for n in ("3", "7", "12", "56"):
        for k in grid_kinds:
            for name in (f"{n} {k}".strip(), f"{k}{n}".upper()):
                if name not in generic and name not in grid:
                    grid.append(name)
    norm = [{"raw": r, "code": clubs.normalize_club(r)} for r in generic + grid]
    return doc("Club names -> canonical codes. camel: a provider's CamelCase names (Trackman); normalize: names "
               "as other monitors and people write them.", [{"rule": "camel", **c} for c in camel] +
               [{"rule": "normalize", **c} for c in norm])


def value_vectors() -> dict[str, Any]:
    times = ["2026-11-10T17:06:12Z", "2026-11-10T17:06:12.5Z", "2026-11-10T17:06:12.123456789Z",
             "2026-11-10T17:06:12+01:00", "2026-11-10T17:06:12-05:30", "2026-11-10T17:06:12",
             "  2026-11-10T17:06:12Z  ", "2026-11-10t17:06:12z", "2026-11-10 17:06:12Z", "2026-11-10",
             "2026-11-10T17:06Z", "2026-02-29T10:00:00Z", "2028-02-29T10:00:00Z", "2026-13-01T00:00:00Z",
             "2026-11-10T24:00:00Z", "2026-11-10T17:60:00Z", "2026-11-10T17:06:61Z", "2026-11-10T17:06:12+24:00",
             "2026-11-10T17:06:12+0100", "20261110T170612Z", "", "soon", None, 1731250000, True,
             "\u0662\u0660\u0662\u0666-11-10T17:06:12Z", "2026-11-10T17:06:12\u00a0", "\u20282026-11-10T17:06:12Z",
             "\ufeff2026-11-10T17:06:12Z"]
    ints = [3, -2, 0, 9.0, 9.5, "3", " 12 ", "+4", "-1", "3.0", "x", "", None, True, False, [1], 1e12,
            "-0", "\u0663", "\u00a012", "\t7\n", "1234567890", "007"]
    nums = [1, 1.5, -0.25, 0, "1.5", None, True, [1], {"v": 1}]
    cases = [{"rule": "when", "value": v, "expected": values.when(v)} for v in times]
    cases += [{"rule": "integer", "value": v, "expected": values.integer(v)} for v in ints]
    cases += [{"rule": "num", "value": v, "expected": values.num(v)} for v in nums]
    return doc("Reading untrusted values (spec/reference/values.py): when -> an RFC 3339 time with zone or null "
               "(no zone: UTC, 'Z' added); integer -> whole number or null; num -> finite JSON number or null "
               "(text is never a number).", cases)


def account_vectors() -> dict[str, Any]:
    inputs = [("s4lt-0001", "trackman", "7c1d2e3f-0000-4000-8000-000000000001"),
              ("s4lt-0001", "trackman", "7c1d2e3f-0000-4000-8000-000000000002"),
              ("s4lt-0002", "trackman", "7c1d2e3f-0000-4000-8000-000000000001"),
              ("s4lt-0001", "demo", "7c1d2e3f-0000-4000-8000-000000000001"),
              ("", "trackman", "user|with|bars"), ("sälz", "trackman", "ünïcödé")]
    return doc("account_ref = base64url (unpadded) of SHA-256('olmd-account-v1|' + salt + '|' + provider + '|' + "
               "subject), UTF-8.", [{"salt": s, "provider": p, "subject": u, "expected": account.account_ref(s, p, u)}
                                    for s, p, u in inputs])


def plan_vectors() -> dict[str, Any]:
    last = "2026-11-16T10:00:00+00:00"
    seed = "player-1|" + last
    cases: list[dict[str, Any]] = []
    for s in [seed, "player-2|" + last, "player-1|2026-11-16T10:00:00.250000+00:00", ""]:
        cases.append({"rule": "next_due_at", "input": {"last_sync_at": last, "seed": s},
                      "expected": plan.next_due_at(last, s)})
    due = plan.parse(plan.next_due_at(last, seed))
    assert due is not None
    just_before = plan.iso(due - plan.timedelta(milliseconds=5))
    just_after = plan.iso(due + plan.timedelta(milliseconds=5))
    for reason in plan.REASONS:
        for now in ["2026-11-16T10:01:59Z", "2026-11-16T10:02:00Z", "2026-11-16T10:09:59Z", "2026-11-16T10:10:00Z",
                    just_before, just_after, "2026-11-17T10:00:00Z"]:
            for history_done in ([False, True] if reason == "backfill" else [False]):
                cases.append({"rule": "is_due", "input": {"last_sync_at": last, "history_done": history_done,
                                                         "reason": reason, "now": now, "seed": seed},
                              "expected": plan.is_due(last, history_done, reason, now, seed)})
        cases.append({"rule": "is_due", "input": {"last_sync_at": None, "history_done": False, "reason": reason,
                                                 "now": "2026-11-16T10:00:00Z", "seed": "x"},
                      "expected": plan.is_due(None, False, reason, "2026-11-16T10:00:00Z", "x")})
    # When the player is there (1.12.0). The first case: back after a session, the last sync 15 minutes ago - the
    # regular rhythm says not yet, the return says now.
    h_last = "2026-11-23T20:00:00Z"
    h_seed = "player-1|" + h_last
    back = "2026-11-23T20:15:00Z"
    heres: list[tuple[str | None, Any, str]] = [
        (h_last, {"back_at": back, "seen_at": back, "news_at": None}, "2026-11-23T20:15:00Z"),
        (h_last, {"back_at": back, "seen_at": back, "news_at": None}, "2026-11-23T20:15:00.000Z"),
        ("2026-11-23T20:14:00Z", {"back_at": back, "seen_at": back, "news_at": None}, "2026-11-23T20:15:30Z"),
        ("2026-11-23T20:14:00Z", {"back_at": back, "seen_at": back, "news_at": None}, "2026-11-23T20:16:00Z"),
        ("2026-11-23T20:15:10Z", {"back_at": back, "seen_at": "2026-11-23T20:19:00Z", "news_at": None},
         "2026-11-23T20:20:09Z"),
        ("2026-11-23T20:15:10Z", {"back_at": back, "seen_at": "2026-11-23T20:19:00Z", "news_at": None},
         "2026-11-23T20:20:10Z"),
        ("2026-11-23T20:15:10Z", {"back_at": back, "seen_at": "2026-11-23T20:19:00Z",
                                  "news_at": "2026-11-23T20:15:10Z"}, "2026-11-23T20:21:00Z"),
        ("2026-11-23T20:15:10Z", {"back_at": back, "seen_at": "2026-11-23T20:19:00Z",
                                  "news_at": "2026-11-23T19:00:00Z"}, "2026-11-23T20:21:00Z"),
        ("2026-11-23T20:15:10Z", {"back_at": back, "seen_at": "2026-11-23T20:05:00Z", "news_at": None},
         "2026-11-23T20:21:00Z"),
        ("2026-11-23T20:15:10Z", {"back_at": back, "seen_at": "2026-11-23T20:11:00Z", "news_at": None},
         "2026-11-23T20:21:00Z"),
        ("2026-11-23T20:42:00Z", {"back_at": back, "seen_at": "2026-11-23T20:44:00Z", "news_at": None},
         "2026-11-23T20:44:30Z"),
        ("2026-11-23T20:38:00Z", {"back_at": back, "seen_at": "2026-11-23T20:44:00Z", "news_at": None},
         "2026-11-23T20:44:30Z"),
        (h_last, {"back_at": back, "seen_at": back, "news_at": None}, "2026-11-23T20:45:00Z"),
        (h_last, {"back_at": "2026-11-23T20:30:00Z", "seen_at": None, "news_at": None}, "2026-11-23T20:15:00Z"),
        (h_last, {"back_at": None, "seen_at": back, "news_at": None}, "2026-11-23T20:15:00Z"),
        (h_last, {"back_at": "soon", "seen_at": back}, "2026-11-23T20:15:00Z"),
        (h_last, {"seen_at": back}, "2026-11-23T20:15:00Z"),
        (h_last, {}, "2026-11-23T20:15:00Z"),
        (h_last, None, "2026-11-23T20:15:00Z"),
        (h_last, "back", "2026-11-23T20:15:00Z"),
        (None, {"back_at": back, "seen_at": back}, "2026-11-23T20:15:00Z"),
    ]
    for lst, here, now in heres:
        cases.append({"rule": "here_due_at", "input": {"last_sync_at": lst, "here": here, "now": now},
                      "expected": plan.here_due_at(lst, here, now)})
        for reason in plan.REASONS:
            cases.append({"rule": "is_due", "input": {"last_sync_at": lst, "history_done": True, "reason": reason,
                                                     "now": now, "seed": h_seed, "here": here},
                          "expected": plan.is_due(lst, True, reason, now, h_seed, here)})
    retry = {"S1": {"t": "2026-11-01T09:00:00Z", "n": 1}, "S2": {"t": "2026-06-01T09:00:00Z", "n": 3},
             "S3": {"t": None, "n": 2}, "S4": {"t": "2025-01-01T09:00:00Z", "n": "x"}}
    for reason in plan.REASONS:
        cases.append({"rule": "give_up", "input": {"retry": retry, "reason": reason},
                      "expected": plan.give_up(retry, reason)})
    now = "2026-11-16T12:00:00Z"
    for lst, reason, rt, skip in [(None, "timer", {}, []), ("2026-11-16T11:00:00Z", "timer", {}, []),
                                  ("2026-11-02T11:00:00Z", "manual", {}, []), ("2024-01-01T00:00:00Z", "timer", {}, []),
                                  ("2026-11-16T11:00:00Z", "timer", retry, plan.give_up(retry, "timer")),
                                  ("2026-11-16T11:00:00Z", "manual", retry, []),
                                  ("2026-11-16T11:00:00Z", "backfill", retry, list(retry)),
                                  ("2026-11-16T11:00:00", "open", {}, [])]:
        days = plan.window_days(lst, reason, rt, skip, now)
        cases.append({"rule": "window_days", "input": {"last_sync_at": lst, "reason": reason, "retry": rt,
                                                      "skip": skip, "now": now}, "expected": days})
        cases.append({"rule": "since", "input": {"days": days, "now": now}, "expected": plan.since(days, now)})
    # A first sync back to the last season (1.23.0): late October (last winter and this October), January and February
    # (this season), the end of September, November and December (the cap), a leap day, an offset
    # (UTC's date counts: half past midnight on New Year in Berlin is still the old year).
    for n in ["2026-10-31T12:00:00Z", "2026-10-01T00:00:00Z", "2027-01-05T08:00:00Z", "2027-02-27T18:30:00Z",
              "2027-09-30T23:59:59Z", "2026-11-05T09:00:00Z", "2026-12-31T22:00:00Z", "2028-02-29T12:00:00Z",
              "2026-04-15T10:00:00+02:00", "2027-01-01T00:30:00+02:00"]:
        cases.append({"rule": "first_days", "input": {"now": n}, "expected": plan.first_days(n)})
        cases.append({"rule": "window_days", "input": {"last_sync_at": None, "reason": "connect", "retry": {}, "skip": [],
                                                      "now": n}, "expected": plan.window_days(None, "connect", {}, [], n)})
    for lst, reason in [(None, "connect"), (None, "manual"), (None, "backfill"), ("2026-11-16T11:00:00Z", "connect"),
                        ("2026-11-16T11:00:00Z", "timer"), ("2026-11-16T11:00:00Z", "backfill"), ("soon", "timer")]:
        cases.append({"rule": "max_sessions", "input": {"last_sync_at": lst, "reason": reason},
                      "expected": plan.max_sessions(lst, reason)})
    old = {"A": {"t": "2026-11-01T00:00:00Z", "n": 1}, "B": {"t": "2026-10-01T00:00:00Z", "n": 2},
           "C": {"t": "2026-09-01T00:00:00Z", "n": 3}}
    for fetched, failed in [([], []), (["A"], []), ([], [{"id": "A", "time": None}]),
                            (["C"], [{"id": "B", "time": "2026-10-02T00:00:00Z"}, {"id": "D", "time": "2026-11-10T00:00:00Z"}]),
                            ([], [{"id": "E", "time": None}])]:
        cases.append({"rule": "next_retry", "input": {"old": old, "fetched": fetched, "failed": failed},
                      "expected": plan.next_retry(old, fetched, failed)})
    many = {f"W{i:03d}": {"t": f"2026-{1 + i % 12:02d}-{1 + i % 28:02d}T00:00:{i % 60:02d}Z", "n": 1} for i in range(205)}
    cases.append({"rule": "next_retry", "input": {"old": many, "fetched": [], "failed": []},
                  "expected": plan.next_retry(many, [], [])})
    chunks = [{"brought": 0, "failed": 2}] * 4 + [{"brought": 1, "failed": 3}] + [{"brought": 0, "failed": 1}] * 5 + \
             [{"brought": 0, "failed": 0}, {"brought": 0, "failed": 1}]
    cases.append({"rule": "barren", "input": {"chunks": chunks}, "expected": plan.barren(chunks)})
    moved = [0, 0, 3, 0, 0, 0, 0, 0, 0, 2]
    cases.append({"rule": "shots_idle", "input": {"moved": moved}, "expected": plan.shots_idle(moved)})
    # Two clients of one player: an extension (E) and a companion app (C).
    ext, comp = {"client": "E", "kind": "extension"}, {"client": "C", "kind": "companion"}
    events = [{"t": 0, "op": "plan", "reason": "timer", **ext}, {"t": 10, "op": "plan", "reason": "open", **comp},
              {"t": 20, "op": "plan", "reason": "backfill", **comp}, {"t": 30, "op": "plan", "reason": "backfill", **ext},
              {"t": 40, "op": "plan", "reason": "manual", **comp}, {"t": 50, "op": "import", "reason": "timer"},
              {"t": 60, "op": "plan", "reason": "timer", **ext}, {"t": 299.9, "op": "plan", "reason": "connect", **comp},
              {"t": 320, "op": "plan", "reason": "backfill", **ext}, {"t": 330, "op": "connect", "reason": "connect"},
              {"t": 331, "op": "plan", "reason": "backfill", **ext}, {"t": 360, "op": "plan", "reason": "timer", **comp},
              {"t": 660, "op": "plan", "reason": "timer", **ext}]
    cases.append({"rule": "leases", "input": {"events": events}, "expected": plan.leases(events)})
    # The same client asking again takes its own lease over (1.13.0): a companion app's sync whose batch never
    # arrived holds nobody up but others - not itself two and a half minutes later. The late import of its first
    # plan releases nothing then; the import of the plan that holds the lease does.
    events = [{"t": 0, "op": "plan", "reason": "open", **comp}, {"t": 150, "op": "plan", "reason": "open", **comp},
              {"t": 160, "op": "plan", "reason": "timer", **ext}, {"t": 170, "op": "import", "reason": "open", "plan": 0},
              {"t": 175, "op": "plan", "reason": "timer", **ext}, {"t": 180, "op": "import", "reason": "open", "plan": 1},
              {"t": 185, "op": "plan", "reason": "timer", **ext}]
    cases.append({"rule": "leases", "input": {"events": events}, "expected": plan.leases(events)})
    # Two phones are two clients of one kind: each holds the other up.
    events = [{"t": 0, "op": "plan", "reason": "timer", **comp},
              {"t": 5, "op": "plan", "reason": "open", "client": "C2", "kind": "companion"}]
    cases.append({"rule": "leases", "input": {"events": events}, "expected": plan.leases(events)})
    lease = {"client": "C", "kind": "companion", "since": 100.0, "until": 400.0}
    for ls, reason, now, client in [(None, "timer", 100.0, "E"), (lease, "timer", 200.0, "E"), (lease, "timer", 200.0, "C"),
                                    (lease, "manual", 200.0, "E"), (lease, "open", 400.0, "E"),
                                    ({"client": "C", "until": 400.0}, "open", 200.0, "E"), (lease, "open", 200.0, None),
                                    ({"until": "soon"}, "timer", 200.0, "E")]:
        cases.append({"rule": "holder", "input": {"lease": ls, "reason": reason, "now_s": now, "client": client},
                      "expected": plan.holder(ls, reason, now, client)})
    # The whole history (1.20.0): which client may be planned its parts, where the scorecards start, which sessions
    # come again. A teaching pro on the simulator: tests and a combine without their shots, a video that has none.
    for values in [["older_rounds,sessions_again"], ["sessions_again", "older_rounds"], ["older_rounds, later_thing"],
                   ["later_thing"], [], None, "older_rounds", [7, "sessions_again"], ["x" * 201]]:
        cases.append({"rule": "read_can", "input": {"values": values}, "expected": plan.read_can(values)})
    for known in [0, 5, 10, 11, 12, 405, -3, "x"]:
        cases.append({"rule": "rounds_skip", "input": {"known_rounds": known}, "expected": plan.rounds_skip(known)})
    # Since 1.26.0: at least where a chunk without a new round got to (a list of games before the missing cards).
    for known, passed in [(12, 92), (12, 0), (405, 92), (12, -5), (12, "92"), (12, None), (12, True), (0, 182)]:
        cases.append({"rule": "rounds_skip", "input": {"known_rounds": known, "passed": passed},
                      "expected": plan.rounds_skip(known, passed)})
    # A player with 12 rounds and 270 games before his two older cards: 2, 92, 182 - then the list ends.
    for passed, skip, ended, new in [(0, 2, False, 0), (92, 92, False, 0), (182, 182, True, 2), (0, 2, False, 3),
                                     (0, 2, None, 0), (0, 2, True, 0), (92, 2, False, 0), (0, "2", False, 0),
                                     (0, 2, False, False), (0, 2, False, "0"), (0, 2, 0, 0), ("x", 2, False, 0)]:
        cases.append({"rule": "rounds_passed", "input": {"passed": passed, "skip": skip, "ended": ended,
                                                         "new_rounds": new},
                      "expected": plan.rounds_passed(passed, skip, ended, new)})
    pro = [{"external_id": f"T{i:02d}", "started_at": f"2026-02-{i:02d}T10:00:00Z", "shots": 0} for i in range(1, 15)]
    pro += [{"external_id": "C1", "started_at": "2026-11-11T09:00:00Z", "shots": 0},
            {"external_id": "S1", "started_at": "2026-11-22T09:00:00Z", "shots": 23},
            {"external_id": "V1", "started_at": None, "shots": 0}, {"external_id": "", "shots": 0},
            {"started_at": "2026-11-01T00:00:00Z", "shots": 0}]
    for asked in [{}, {"C1": 1, "T14": 3, "T13": 9}, {"C1": "x"}, {"T12": -1}]:
        cases.append({"rule": "sessions_wanted", "input": {"sessions": pro, "asked": asked},
                      "expected": plan.sessions_wanted(pro, asked)})
    return doc("The reference planning rules of a target (spec/planning.md; here_due_at and is_due's `here` since "
               "1.12.0, a case without `here` has none; `holder`, and `leases` with clients and holders, since 1.13.0; "
               "read_can, rounds_skip and sessions_wanted since 1.20.0; rounds_skip's `passed` and rounds_passed since 1.26.0). Times compare as instants within "
               "compare.time_tolerance_s; dict results compare without regard to key order.", cases,
               rules=plan.RULES, compare={"time_tolerance_s": 0.001})


def guard_vectors() -> dict[str, Any]:
    """Scenarios replayed step by step: every `check` must answer `expected`."""
    L = guard.LIMITS

    def run(name: str, why: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
        g = guard.Guard()
        out = []
        for s in steps:
            s = dict(s)
            acc = s.get("account", "A")
            if s["op"] == "run":
                g.begin_run(acc)
            elif s["op"] == "check":
                s["expected"] = g.check(acc, s["t"])
            elif s["op"] == "start":
                g.start(acc, s["t"])
            elif s["op"] == "finish":
                g.finish(acc, s["t"], s["status"], s.get("retry_after_s"))
            out.append(s)
        return {"name": name, "why": why, "steps": out}

    def req(t: float, status: int = 200, account: str = "A", took: float = 0.5,
            retry_after: float | None = None) -> list[dict[str, Any]]:
        fin: dict[str, Any] = {"op": "finish", "t": t + took, "status": status, "account": account}
        if retry_after is not None:
            fin["retry_after_s"] = retry_after
        return [{"op": "check", "t": t, "account": account}, {"op": "start", "t": t, "account": account}, fin]

    scenarios = []
    steps: list[dict[str, Any]] = [{"op": "run"}, *req(0), {"op": "check", "t": 0.2}, {"op": "check", "t": 1.2},
                                   {"op": "check", "t": 1.5}, *req(1.5)]
    scenarios.append(run("one_at_a_time", "Busy while a request is out; at least pause_s.min after the last ended.",
                         steps))
    steps = [{"op": "run"}]
    t = 0.0
    for _ in range(L["per_run"]):
        steps += req(t)
        t += 2
    steps += [{"op": "check", "t": t}, {"op": "run"}, {"op": "check", "t": t + 1}, *req(t + 1)]
    scenarios.append(run("per_run", "At most per_run requests in one sync run; a new run may go on.", steps))
    steps = []
    t = 0.0
    for i in range(L["per_hour"]):
        if i % L["per_run"] == 0:
            steps.append({"op": "run"})
        steps += req(t)
        t += 30
    steps += [{"op": "run"}, {"op": "check", "t": t}, {"op": "check", "t": 3599.9}, {"op": "check", "t": 3600},
              *req(3600), {"op": "check", "t": 3602}]
    scenarios.append(run("per_hour_rolling", "The last 60 minutes, rolling: the oldest request leaving the window "
                         "frees one place.", steps))
    steps = []
    t = 0.0
    for i in range(L["per_day"]):
        if i % 30 == 0:
            steps.append({"op": "run"})
        steps += req(t)
        t += 61 if i % 30 else 3600  # 30 an hour, then a pause: stays under the hourly limit
    steps += [{"op": "run"}, {"op": "check", "t": t}, {"op": "check", "t": 86400}, *req(86400),
              {"op": "check", "t": 86410}, {"op": "check", "t": 86400 + 3600 + 61}]
    scenarios.append(run("per_day_rolling", "The last 24 hours, rolling, history included.", steps))
    steps = [{"op": "run"}, *req(0, 429), {"op": "check", "t": 30}, {"op": "check", "t": 60.5}, *req(60.5, 503),
             {"op": "check", "t": 150}, {"op": "check", "t": 181}, *req(181, 0), {"op": "check", "t": 400},
             {"op": "check", "t": 421.5}, *req(421.5, 200), *req(423, 500), {"op": "check", "t": 483.4},
             {"op": "check", "t": 483.5}]
    scenarios.append(run("backoff", "After 429, 5xx or no answer: 60 s, doubled each time in a row; a good answer "
                         "starts again at 60 s.", steps))
    steps = [{"op": "run"}]
    t = 0.0
    for _ in range(8):
        steps += req(t, 500)
        steps.append({"op": "check", "t": t + 0.5})
        t += 4000
    scenarios.append(run("backoff_cap", "The backoff never grows past max_s.", steps))
    steps = [{"op": "run"}, *req(0, 429, retry_after=7200), {"op": "check", "t": 3700}, {"op": "check", "t": 7200.5},
             *req(7200.5, 503, retry_after=5), {"op": "check", "t": 7262}, *req(8000, 200, retry_after=999),
             {"op": "check", "t": 8002}]
    scenarios.append(run("retry_after", "Retry-After holds when it is longer than the backoff, even past the "
                         "hour; a shorter one doesn't shorten the backoff; on a good answer it means nothing.", steps))
    steps = [{"op": "run", "account": "A"}, {"op": "run", "account": "B"}, *req(0, account="A"),
             {"op": "check", "t": 0.1, "account": "B"}, *req(0.1, account="B", retry_after=None),
             *req(2, 429, account="A"), {"op": "check", "t": 4, "account": "B"}]
    scenarios.append(run("per_account", "Counts and pauses are kept per provider account.", steps))
    return doc("The load guard (spec/guard.md). Replay the steps in order with a fresh guard per scenario: "
               "run = begin a sync run, start/finish = a request (status 0: no answer), check = must answer "
               "`expected` ({ok: true} or {ok: false, reasons sorted, until: seconds or null}).",
               scenarios, limits=L)


def deep_link_vectors() -> dict[str, Any]:
    t = "https%3A%2F%2Fapp.example.org%2Flm%2Fv1"
    links = [f"glmsync://pair?target={t}&code=K7M2-PQ9X", f"glmsync://pair/?target={t}&code=K7M2PQ9X&provider=trackman",
             f"glmsync://pair?code=K7M2PQ9X&target={t}&utm=x", f"glmsync://pair?target={t}",
             "glmsync://pair?code=K7M2PQ9X", f"glmsync://pair?target={t}&code=K7M2",
             f"glmsync://pair?target={t}&code=K7M2+PQ9X", f"glmsync://pair?target={t}&code=K7M2PQ9X&code=AAAAAAAA",
             f"glmsync://pair?target={t}&code=", "glmsync://pair?target=http%3A%2F%2Fapp.example.org&code=K7M2PQ9X",
             "glmsync://pair?target=http%3A%2F%2Flocalhost%3A8000%2Flm%2Fv1&code=K7M2PQ9X",
             "glmsync://pair?target=https%3A%2F%2Fuser%40app.example.org&code=K7M2PQ9X",
             "glmsync://pair?target=https%3A%2F%2Fapp.example.org%2F%3Fx%3D1&code=K7M2PQ9X",
             "glmsync://pair?target=javascript%3Aalert(1)&code=K7M2PQ9X",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=Trackman",
             f"glmsync://pair?target={t}&code=K7M2PQ9X%ZZ", f"glmsync://pair?target={t}&code=K7M2PQ9X%C3",
             f"glmsync://pair?target={t}&code=K7M2PQ9X#frag",
             "glmsync:pair?code=K7M2PQ9X", "GLMSYNC://pair?code=K7M2PQ9X", "glmsync://unpair?x=1", "https://example.org",
             "glmsync://sync", f"glmsync://sync?target={t}&return=exampleapp%3A%2F%2Fsynced",
             "glmsync://sync?return=https%3A%2F%2Fapp.example.org%2Fprofile%3Ftab%3Dlm",
             "glmsync://sync?return=javascript%3Aalert(1)", "glmsync://sync?return=data%3Atext%2Fhtml%2Cx",
             "glmsync://sync?return=exampleapp%3Asynced", "glmsync://sync?return=http%3A%2F%2Fevil.example",
             "glmsync://sync?return=glmsync%3A%2F%2Fsync", "glmsync://sync?return=https%3A%2F%2Fa.example%2F%20x",
             "glmsync://sync?target=ftp%3A%2F%2Fx&return=exampleapp%3A%2F%2Fsynced", "glmsync://sync?return=%2Frelative",
             f"glmsync://pair?target={t}%0A&code=K7M2PQ9X", f"glmsync://pair?target={t}&code=K7M2PQ9X\n",
             "glmsync://sync?return=https%3A%2F%2Fapp.example.org", "glmsync://sync?return=http%3A%2F%2Flocalhost%3A8081",
             # 1.2.0: a pair link may name where to jump back to once paired
             f"glmsync://pair?target={t}&code=K7M2PQ9X&return=exampleapp%3A%2F%2Fprofile%3Ffocus%3Dlm",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman&return=https%3A%2F%2Fapp.example.org%2Fprofile",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&return=javascript%3Aalert(1)",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&return=glmsync%3A%2F%2Fsync",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&return=",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&return=exampleapp%3A%2F%2Fa&return=exampleapp%3A%2F%2Fb",
             # 1.8.0: a test code for a pairing (spec/test-mode.md)
             "glmsync://test?code=T7K2M9QX", f"glmsync://test/?target={t}&code=T7K2-M9QX&utm=x",
             f"glmsync://test?target={t}", "glmsync://test", "glmsync://test?code=T7K2", "glmsync://test?code=T7K2+M9QX",
             "glmsync://test?code=T7K2M9QX&code=AAAAAAAA", "glmsync://test?code=",
             "glmsync://test?target=http%3A%2F%2Fapp.example.org&code=T7K2M9QX", "glmsync://test?code=T7K2M9QX#frag",
             "glmsync://test?code=T7K2M9QX&return=exampleapp%3A%2F%2Fback", "glmsync://test?code=T7K2M9QX&token=x",
             "glmsync://test?code=T7K2M9QX%ZZ", "glmsync://test?code=T7K2M9QX\n", "GLMSYNC://test?code=T7K2M9QX",
             "glmsync://tests?code=T7K2M9QX",
             # 1.10.0: which target API the base URL speaks
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=golfde&kind=hcp",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=lm",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=HCP",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=egr",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=hcp&kind=lm",
             f"glmsync://sync?target={t}&kind=hcp&return=exampleapp%3A%2F%2Fsynced",
             # 1.11.0: open the client's way of reading along (the handicap record)
             "glmsync://read?kind=hcp", "glmsync://read/?kind=hcp&utm=x", "glmsync://read", "glmsync://read?kind=lm",
             "glmsync://read?kind=HCP", "glmsync://read?kind=", "glmsync://read?kind=hcp&kind=hcp",
             f"glmsync://read?kind=hcp&target={t}&return=exampleapp%3A%2F%2Fback", "glmsync://read?kind=hcp#frag",
             "glmsync://read?kind=hcp\n", "GLMSYNC://read?kind=hcp", "glmsync://reads?kind=hcp",
             "glmsync://read?kind=hcp%ZZ",
             # 1.15.0: a professional's own pages (spec/prores.md)
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=pro&kind=pro", f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=PRO",
             "glmsync://read?kind=pro", "glmsync://read?kind=pro&kind=hcp",
             # 1.18.0: several launch monitors a target takes; and a way back after a handicap or pro pairing too
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman%2Cdemo",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman,demo&kind=lm",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman,trackman",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman,",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=,trackman",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman%2C%20demo",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman,Demo",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=" + ",".join(f"p{i}x" for i in range(11)),
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=golfde&kind=hcp&return=exampleapp%3A%2F%2Fprofile%3Ffocus%3Dhcp",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=pro&kind=pro&return=https%3A%2F%2Fapp.example.org%2Fprofile",
             f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=hcp&return=javascript%3Aalert(1)"]
    # 1.27.0: only signing in for a connection, and the sealed handover (spec/deep-links.md, *Signing in for a target*)
    k, n, back = HANDOVER_KEY, HANDOVER_NONCE, "exampleapp%3A%2F%2Fsignedin"
    links += [f"glmsync://signin?provider=trackman&key={k}&nonce={n}&return={back}",
              f"glmsync://signin/?target={t}&provider=trackman&key={k}&nonce={n}&return={back}&utm=x",
              f"glmsync://signin?provider=trackman&key={k}&nonce={n}&return=https%3A%2F%2Fapp.example.org%2Fsignedin%23card",
              f"glmsync://signin?key={k}&nonce={n}&return={back}", f"glmsync://signin?provider=trackman&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}&return={back}", f"glmsync://signin?provider=trackman&key={k}&nonce={n}",
              f"glmsync://signin?provider=trackman,demo&key={k}&nonce={n}&return={back}",
              f"glmsync://signin?provider=Trackman&key={k}&nonce={n}&return={back}",
              f"glmsync://signin?target=http%3A%2F%2Fapp.example.org&provider=trackman&key={k}&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k[:-1]}&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}A&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k[:-1]}B&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}%3D&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k[:20]}%2B{k[21:]}&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}&nonce={n[:-1]}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}&nonce={n}&return=javascript%3Aalert(1)",
              f"glmsync://signin?provider=trackman&key={k}&nonce={n}&return=glmsync%3A%2F%2Fsync",
              f"glmsync://signin?provider=trackman&key={k}&key={k}&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key=&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}&nonce={n}&return={back}#frag",
              f"GLMSYNC://signin?provider=trackman&key={k}&nonce={n}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=trackman&mode=signin&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&key={k}&nonce={n}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&kind=lm&key={k}&nonce={n}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&key={k}&nonce={n}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&key={k}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&nonce={n}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&key=AAAA&nonce={n}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&key={k}&nonce=AAAA&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&key={k}&nonce={n}&return={back}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&nonce={n}",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=fetch",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=SIGNIN",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&mode=signin&mode=signin",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=golfde&kind=hcp&mode=signin",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&provider=pro&kind=pro&mode=signin",
              f"glmsync://sync?target={t}&mode=signin&key={k}&nonce={n}&return={back}"]
    cases: list[dict[str, Any]] = [{"rule": "parse_link", "input": u, "expected": deeplinks.parse_link(u)} for u in links]
    frags = [f"#target={t}&code=K7M2PQ9X", f"target={t}&code=K7M2PQ9X&provider=demo", "#code=K7M2PQ9X", "#",
             f"#target={t}&code=K7M2PQ9X&target={t}",
             f"#target={t}&code=K7M2PQ9X&return=exampleapp%3A%2F%2Fprofile",
             f"#target={t}&code=K7M2PQ9X&kind=hcp", f"#target={t}&code=K7M2PQ9X&kind=lm",
             f"#kind=hcp&target={t}&code=K7M2PQ9X&provider=golfde", f"#target={t}&code=K7M2PQ9X&kind=other",
             f"#target={t}&code=K7M2PQ9X&kind=hcp&kind=hcp", f"#target={t}&code=K7M2PQ9X&kind=pro",
             f"#target={t}&code=K7M2PQ9X&provider=trackman%2Cdemo", f"#target={t}&code=K7M2PQ9X&provider=trackman,,demo",
             f"#target={t}&code=K7M2PQ9X&mode=signin&key={k}&nonce={n}"]
    cases += [{"rule": "parse_pair_fragment", "input": f, "expected": deeplinks.parse_pair_fragment(f)} for f in frags]
    prefixes = ["https://app.example.org/", "exampleapp://", "https://app.example.net"]
    for u in ["https://app.example.org/profile", "https://app.example.org.evil.test/", "exampleapp://synced",
              "exampleapp:synced", "https://app.example.net/x", "javascript://app.example.org/", "otherapp://x"]:
        cases.append({"rule": "return_allowed", "input": {"url": u, "prefixes": prefixes},
                      "expected": deeplinks.return_allowed(u, prefixes)})
    for v in [None, "trackman", "trackman,demo", "demo,trackman", "trackman,trackman", "trackman,", "Trackman", "a",
              ",".join(f"p{i}x" for i in range(10)), ",".join(f"p{i}x" for i in range(11))]:
        cases.append({"rule": "providers_of", "input": v, "expected": deeplinks.providers_of(v)})
    sync = f"glmsync://sync?target={t}"
    intents: list[tuple[Any, Any]] = [
        (sync, "open"), (sync, "manual"), (sync, None), (sync, "timer"), (sync, "backfill"), (sync, "OPEN"),
        (sync, 1), (f"glmsync://sync/?target={t}&utm=x", "open"), ("glmsync://sync", "open"),
        (f"glmsync://sync?target={t}&return=exampleapp%3A%2F%2Fsynced", "manual"),
        (f"glmsync://pair?target={t}&code=K7M2PQ9X", "manual"), ("glmsync://sync?target=ftp%3A%2F%2Fx", "open"),
        (f"glmsync://sync?target={t}&target={t}", "open"), (None, "open"), ("", "open"),
        (f"https://app.example.org/sync?target={t}", "open"), (f"glmsync://test?target={t}&code=T7K2M9QX", "open"),
        ("glmsync://read?kind=hcp", "open")]
    cases += [{"rule": "parse_sync_intent", "input": {"data": d, "reason": r},
               "expected": deeplinks.parse_sync_intent(d, r)} for d, r in intents]
    # 1.22.0: the result in the way back, and the universal links
    for u, r in [("exampleapp://synced", "new"), ("exampleapp://synced", "nothing"),
                 ("https://app.example.org/profile?tab=lm", "not_due"),
                 ("https://app.example.org/profile?tab=lm&result=new#card", "failed"),
                 ("https://app.example.org/profile?result=new&result=nothing", "signin"),
                 ("https://app.example.org/profile?", "outdated"), ("https://app.example.org/profile#x?y", "new"),
                 ("exampleapp://synced", "done"), ("exampleapp://synced", "New"), ("exampleapp://synced", None),
                 ("javascript:alert(1)", "new"), ("glmsync://sync", "new"), ("", "new"), (None, "new"),
                 ("https://app.example.org/" + "x" * 2020, "nothing"), ("https://app.example.org/" + "x" * 2030, "new")]:
        cases.append({"rule": "with_result", "input": {"url": u, "result": r}, "expected": deeplinks.with_result(u, r)})
    for u in ["exampleapp://synced?result=new", "exampleapp://synced?a=1&result=nothing#result=new",
              "https://app.example.org/profile?tab=lm&result=not_due", "exampleapp://synced?result=signin&result=new",
              "exampleapp://synced?result=", "exampleapp://synced?result=NEW", "exampleapp://synced?results=new",
              "exampleapp://synced#result=new", "exampleapp://synced", "exampleapp://synced?result=outdated",
              "exampleapp://synced?result=failed&x", "exampleapp://synced?result=new%20", None, 5]:
        cases.append({"rule": "read_result", "input": u, "expected": deeplinks.read_result(u)})
    ub = deeplinks.UNIVERSAL_BASE
    for u in [f"{ub}sync#target={t}&return=exampleapp%3A%2F%2Fsynced", f"{ub}sync", f"{ub}sync/", f"{ub}sync#",
              f"{ub}pair#target={t}&code=K7M2-PQ9X&provider=trackman&return=exampleapp%3A%2F%2Fprofile",
              f"{ub}pair#target={t}", f"{ub}pair/#target={t}&code=K7M2PQ9X&kind=hcp",
              f"{ub}sync?target={t}", f"{ub}sync?x=1#target={t}", f"{ub}sync#target={t}#x",
              f"{ub}test#code=T7K2M9QX", f"{ub}read#kind=hcp", f"{ub}Sync#target={t}",
              f"https://golf-launch-monitor-sync.github.io/link/sync#target={t}",
              f"https://evil.example/golf-launch-monitor-sync/link/sync#target={t}",
              f"http://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/sync#target={t}",
              f"https://golf-launch-monitor-sync.github.io.evil.test/golf-launch-monitor-sync/link/sync#target={t}",
              f"{ub}sync#return=javascript%3Aalert(1)", f"{ub}sync#target={t}&target={t}", f"{ub}sync#target={t}\n",
              f"glmsync://sync?target={t}", None,
              f"{ub}signin#provider=trackman&key={k}&nonce={n}&return={back}", f"{ub}signin/#provider=trackman",
              f"{ub}signin?provider=trackman#key={k}"]:
        cases.append({"rule": "parse_universal", "input": u, "expected": deeplinks.parse_universal(u)})
    for u in [f"glmsync://sync?target={t}&return=exampleapp%3A%2F%2Fsynced", "glmsync://sync",
              f"glmsync://pair?target={t}&code=K7M2PQ9X&kind=hcp", f"glmsync://pair/?target={t}&code=K7M2PQ9X",
              "glmsync://test?code=T7K2M9QX", "glmsync://read?kind=hcp", f"glmsync://pair?target={t}",
              "glmsync://sync?return=javascript%3Aalert(1)", f"https://app.example.org/sync?target={t}", None,
              f"glmsync://signin?provider=trackman&key={k}&nonce={n}&return={back}",
              f"glmsync://signin?provider=trackman&key={k}&nonce={n}"]:
        cases.append({"rule": "universal_link", "input": u, "expected": deeplinks.universal_link(u)})
    return doc("Deep links and the pairing fragment (spec/deep-links.md). parse_link / parse_pair_fragment -> "
               "{ok: true, action, target?, code?, provider?, kind?, return?} or {ok: false, error}; action is pair, "
               "sync, (1.8.0) test or (1.11.0) read; kind (1.10.0) lm, hcp or (1.15.0) pro, only where the link names it "
               "(read: always, and only hcp or pro). parse_sync_intent "
               "(the Android sync service: the intent's data and its extra glmsync.extra.REASON) -> "
               "{ok: true, target, reason} or {ok: false, error}. provider (1.18.0) may name several, separated by "
               "commas, and stays the string as given; providers_of (that string, or null: none named) -> the list of "
               "ids ([]: any the client can connect), or null when it names none validly. Since 1.22.0: with_result "
               "({url, result}) -> the return URL with the sync's result, or null; read_result (the address a target "
               "was opened at) -> the result or null; parse_universal (https://…/link/pair|sync#…) -> as parse_link; "
               "universal_link (a glmsync:// pair or sync link) -> its universal form, or null. Since 1.27.0: action "
               "signin {ok: true, action, target?, provider, key, nonce, return}; a pair link's mode (only signin), key "
               "and nonce (both, only with mode, with a return); the universal form of a signin link (…/link/signin#…).",
               cases,
               universal={"base": deeplinks.UNIVERSAL_BASE}, results=list(deeplinks.RESULTS))


def signin_vectors() -> dict[str, Any]:
    values: list[Any] = [[s] for s in bridge.SIGN_IN] + [
        [], ["ready", "ready"], ["ready", "none"], ["Ready"], ["READY"], [""], [" ready"], ["ready "], ["signed_in"],
        ["expired\n"], ["ready\u0000"], [1], [None], "ready", None]
    cases = [{"rule": "read_signin", "input": v, "expected": bridge.read_signin(v)} for v in values]
    return doc("The client's sign-in as a target reads it (spec/target-api.md, *The client's sign-in*; 1.5.0): input is "
               "the list of the values the query parameter `signin` has in the request (a string or null: not a "
               "list); expected the sign-in, or null for no answer.", cases)


def bridge_vectors() -> dict[str, Any]:
    req = {"glmsync": "request", "v": 1, "id": "r-1", "ask": "fetch"}
    requests: list[Any] = [
        req, {**req, "ask": "state"}, {**req, "v": 1.0}, {**req, "extra": {"x": 1}},
        {**req, "v": 2}, {**req, "v": "1"}, {**req, "v": True}, {**req, "glmsync": "reply"}, {**req, "ask": "sync"},
        {**req, "ask": "Fetch"}, {**req, "id": ""}, {**req, "id": "x" * 64}, {**req, "id": "x" * 65},
        {**req, "id": "r 1"}, {**req, "id": "r-1\n"}, {**req, "id": 7}, {k: v for k, v in req.items() if k != "id"},
        {k: v for k, v in req.items() if k != "ask"}, {k: v for k, v in req.items() if k != "v"},
        ["glmsync", "request"], "fetch", None, {"glmsync-extension": req},
        {**req, "reason": "open"}, {**req, "reason": "manual"}, {**req, "reason": "timer"}, {**req, "reason": "Open"},
        {**req, "reason": None}, {**req, "reason": ["open"]}, {**req, "ask": "state", "reason": "open"}]
    cases: list[dict[str, Any]] = [{"rule": "read_request", "input": r, "expected": bridge.read_request(r)}
                                   for r in requests]
    rep = {"glmsync": "reply", "v": 1, "id": "r-1"}
    replies: list[Any] = [
        {**rep, "answer": "state", "signin": "ready", "fetching": False},
        {**rep, "answer": "state", "signin": "confirm", "fetching": True},
        {**rep, "answer": "state", "signin": "ready"}, {**rep, "answer": "state", "signin": "Ready", "fetching": False},
        {**rep, "answer": "state", "signin": "ready", "fetching": "no"},
        {**rep, "answer": "started"}, {**rep, "answer": "busy", "extra": 1}, {**rep, "answer": "unpaired"},
        {**rep, "answer": "signin", "signin": "expired"}, {**rep, "answer": "signin", "signin": "none"},
        {**rep, "answer": "signin", "signin": "ready"}, {**rep, "answer": "signin"},
        {**rep, "answer": "guard", "until": "2026-11-18T22:30:00Z"},
        {**rep, "answer": "guard", "until": "2026-11-18T23:30:00.250+01:00"},
        {**rep, "answer": "guard"}, {**rep, "answer": "guard", "until": "2026-11-18"},
        {**rep, "answer": "guard", "until": "tomorrow"}, {**rep, "answer": "guard", "until": 1763505000},
        {**rep, "answer": "finished", "outcome": "synced"}, {**rep, "answer": "finished", "outcome": "not_due"},
        {**rep, "answer": "finished", "outcome": "guard", "until": "2026-11-18T22:30:00Z"},
        {**rep, "answer": "finished", "outcome": "guard", "until": "soon"},
        {**rep, "answer": "finished", "outcome": "signin"}, {**rep, "answer": "finished", "outcome": "done"},
        {**rep, "answer": "finished"}, {**rep, "answer": "later"}, {**rep, "answer": 1},
        {**rep, "v": 2, "answer": "started"}, {**rep, "glmsync": "request", "answer": "started"},
        {"glmsync": "reply", "v": 1, "answer": "started"}, {**rep, "id": "", "answer": "started"}, None, []]
    cases += [{"rule": "read_reply", "input": r, "expected": bridge.read_reply(r)} for r in replies]
    return doc("The browser extension's bridge on a paired target's page (spec/page-bridge.md; 1.5.0, a fetch's reason "
               "1.12.0): read_request "
               "(what the extension takes from the page) and read_reply (what the page takes from the extension) -> "
               "the message read, or null when it is none of this protocol's.", cases,
               protocol={"version": bridge.VERSION, "fetch_gap_s": bridge.FETCH_GAP_S, "sign_in": list(bridge.SIGN_IN),
                         "outcomes": list(bridge.OUTCOMES), "fetch_reasons": list(bridge.FETCH_REASONS)})


def olmd_examples() -> dict[str, Any]:
    good = trackman.batch({"sessions": [{"activity": cases_trackman._act("ACT-1", "SIMULATOR"),
                                         "node": {"strokes": cases_trackman.SIM_STROKES[:1]}}]},
                          account_ref=cases_trackman.REF, generated_at=cases_trackman.AT)
    full = {**copy.deepcopy(good), "generator": {"name": "golf-launch-monitor-sync", "version": "0.1.0"},
            "sync": {"plan_id": "pl_7d1c", "reason": "timer"},
            "progress": {"more_available": True, "oldest_seen": "2025-03-01T10:00:00Z", "skipped_known": 12,
                         "sessions_left": 140, "oldest_listed": "2023-03-04T09:00:00Z", "rounds_end": False,
                         "sessions_asked": ["ACT-7", "ACT-8"]},
            "notice": {"code": "guard_limit", "message": "Enough asked of the provider today; tomorrow it goes on."},
            "failed": [{"external_id": "ACT-9", "started_at": "2026-11-09T10:00:00Z"}],
            "extra": {"anything": ["is", "kept", 1]}}
    full["sessions"][0]["shots"][0]["target"] = {"distance_m": 140.0}
    full["sessions"][0]["shots"][0]["extra"] = {"note": "read, never run"}

    def bad(name: str, why: str, change: Any) -> dict[str, Any]:
        b = copy.deepcopy(good)
        change(b)
        return {"name": name, "why": why, "valid": False, "batch": b}

    def drop(key: str) -> Any:
        return lambda b: b.pop(key)

    cases = [{"name": "minimal", "why": "No sessions, no rounds.", "valid": True,
              "batch": {"format": "olmd/1", "provider": "demo", "account_ref": cases_trackman.REF,
                        "generated_at": cases_trackman.AT, "sessions": [], "rounds": []}},
             {"name": "simulator_session", "why": "As the Trackman provider writes it.", "valid": True, "batch": good},
             {"name": "everything", "why": "Every optional part at once.", "valid": True, "batch": full},
             {"name": "measured_round", "why": "1.4.0: a round's shots with their ball and club data.", "valid": True,
              "batch": trackman.batch({"round_shots": [{"id": "SC-4001", "holes": cases_trackman.MEASURED_HOLES,
                                                        "measured": True}]},
                                      account_ref=cases_trackman.REF, generated_at=cases_trackman.AT)},
             {"name": "test_batch", "why": "1.8.0: made from a test scenario, not from the provider.", "valid": True,
              "batch": {**copy.deepcopy(good), "test": True}},
             bad("wrong_format", "Another format version.", lambda b: b.update(format="olmd/2")),
             bad("no_provider", "provider is required.", drop("provider")),
             bad("provider_case", "Provider ids are lower case.", lambda b: b.update(provider="Trackman")),
             bad("no_account_ref", "account_ref is required.", drop("account_ref")),
             bad("short_account_ref", "Too short to be a hash.", lambda b: b.update(account_ref="abc")),
             bad("local_time", "Times carry their zone.", lambda b: b.update(generated_at="2026-11-16T12:00:00")),
             bad("null_value", "Unknown values are left out, not null.",
                 lambda b: b["sessions"][0]["shots"][0]["flight"].update(total_m=None)),
             bad("yards", "Units are SI: there is no yards field.",
                 lambda b: b["sessions"][0]["shots"][0]["flight"].update(carry_yd=150)),
             bad("unknown_kind", "Session kinds are a closed list (other + kind_raw).",
                 lambda b: b["sessions"][0].update(kind="SIMULATOR")),
             bad("session_without_id", "Every session has its external_id.", lambda b: b["sessions"][0].pop("external_id")),
             bad("carry_as_text", "Numbers are JSON numbers.",
                 lambda b: b["sessions"][0]["shots"][0]["flight"].update(carry_m="140.2")),
             bad("empty_group", "An empty group is left out.", lambda b: b["sessions"][0]["shots"][0].update(ball={})),
             bad("round_shot_far", "A worked-out distance to the flag is at most 1000 m.",
                 lambda b: b["rounds"].append({"external_id": "R1", "shots": [{"hole": 1, "number": 1,
                                                                             "to_pin_before_m": 1500}]})),
             bad("round_shot_without_hole", "A round's shot names its hole.",
                 lambda b: b["rounds"].append({"external_id": "R1", "shots": [{"number": 1}]})),
             bad("measured_false", "shots_measured is true or absent.",
                 lambda b: b["rounds"].append({"external_id": "R1", "shots": [], "shots_measured": False})),
             bad("round_shot_empty_ball", "An empty group is left out on a round's shot too.",
                 lambda b: b["rounds"].append({"external_id": "R1", "shots": [{"hole": 1, "number": 1, "ball": {}}]})),
             bad("unknown_top_level", "Extensions go into extra.", lambda b: b.update(player="Someone")),
             bad("notice_code", "Notice codes are a closed list.", lambda b: b.update(notice={"code": "hello"})),
             bad("sessions_left_negative", "1.7.0: sessions_left counts, from 0.",
                 lambda b: b.update(progress={"more_available": True, "sessions_left": -1})),
             bad("oldest_listed_local", "1.7.0: oldest_listed is a time with its zone.",
                 lambda b: b.update(progress={"oldest_listed": "2023-03-04T09:00:00"})),
             bad("sessions_asked_empty_id", "1.25.0: sessions_asked holds external ids, none empty.",
                 lambda b: b.update(progress={"sessions_asked": [""]})),
             bad("sessions_asked_text", "1.25.0: sessions_asked is a list.",
                 lambda b: b.update(progress={"sessions_asked": "ACT-7"})),
             bad("test_false", "1.8.0: test is true or absent.", lambda b: b.update(test=False)),
             bad("test_as_text", "1.8.0: test is the JSON value true.", lambda b: b.update(test="true"))]
    return doc("olmd/1 batches that must (valid: true) or must not validate against spec/olmd/olmd-1.schema.json.",
               cases)


def test_scenario_vectors() -> dict[str, Any]:
    """The answer of GET /test-scenario as a client reads it (spec/test-mode.md, 1.8.0)."""
    now = "2026-11-21T18:00:00Z"
    ok: dict[str, Any] = {
        "name": "steady", "provider": "trackman", "subject": "test-0f3a9c21-steady",
        "profile": {"fullName": "Sam Example (test)"},
        "data": {"activities": [{"id": "ACT-T1", "kind": "RANGE_PRACTICE", "time": "2026-11-20T17:00:00Z"}],
                 "nodes": {"ACT-T1": {"strokes": []}}, "scorecards": [], "shotHoles": {}},
        "latency": {"default": {"median_s": 0.8, "spread_s": 0.3},
                    "queries": {"Activities": {"median_s": 1.2, "spread_s": 0.4},
                                "Session": {"median_s": 2, "spread_s": 1}}},
        "valid_until": "2026-11-28T18:00:00+01:00"}

    def but(**kw: Any) -> dict[str, Any]:
        a = copy.deepcopy(ok)
        for k, v in kw.items():
            if v is ...:
                a.pop(k)
            else:
                a[k] = v
        return a

    answers: list[tuple[str, Any, str]] = [
        ("whole", ok, now),
        ("minimal", but(latency=...), now),
        ("empty_account", but(data={}, profile={}), now),
        ("later_version_keys", {**ok, "hint": "kept for later versions", "x_extra": 1}, now),
        ("unicode_name", but(name="Léon ⛳ (Test T17)"), now),
        ("name_of_100", but(name="n" * 100), now),
        ("name_of_101", but(name="n" * 101), now),
        ("name_blank", but(name="   "), now),
        ("name_empty", but(name=""), now),
        ("name_control", but(name="Sam\nExample"), now),
        ("name_missing", but(name=...), now),
        ("name_number", but(name=7), now),
        ("provider_case", but(provider="Trackman"), now),
        ("provider_missing", but(provider=...), now),
        ("subject_space", but(subject="test 1"), now),
        ("subject_unicode", but(subject="tëst-1"), now),
        ("subject_long", but(subject="s" * 201), now),
        ("subject_missing", but(subject=...), now),
        ("profile_list", but(profile=[]), now),
        ("profile_missing", but(profile=...), now),
        ("data_list", but(data=[{"id": "x"}]), now),
        ("data_text", but(data="{}"), now),
        ("data_missing", but(data=...), now),
        ("until_local", but(valid_until="2026-11-28T18:00:00"), now),
        ("until_spaces", but(valid_until=" 2026-11-28T18:00:00Z"), now),
        ("until_date", but(valid_until="2026-11-28"), now),
        ("until_impossible", but(valid_until="2026-02-30T10:00:00Z"), now),
        ("until_number", but(valid_until=1795000000), now),
        ("until_missing", but(valid_until=...), now),
        ("expired", but(valid_until="2026-11-21T17:59:59Z"), now),
        ("expired_now", but(valid_until="2026-11-21T19:00:00+01:00"), now),
        ("expired_by_ms", but(valid_until="2026-11-21T18:00:00.000999Z"), "2026-11-21T18:00:00.000500Z"),
        ("good_by_ms", but(valid_until="2026-11-21T18:00:00.001Z"), now),
        ("clock_unreadable", ok, "soon"),
        ("clock_offset", ok, "2026-11-28T18:59:59+02:00"),
        ("latency_not_object", but(latency=[1, 2]), now),
        ("latency_bad_entries", but(latency={
            "default": {"median_s": -1, "spread_s": 0.2},
            "queries": {"Activities": {"median_s": "1", "spread_s": 0.2}, "Session": {"median_s": 61, "spread_s": 1},
                        "Rounds": {"median_s": 1, "spread_s": 60}, "RoundShots": {"median_s": 1},
                        "Who": {"median_s": True, "spread_s": 0}, "1Bad": {"median_s": 1, "spread_s": 1},
                        "has space": {"median_s": 1, "spread_s": 1}, "Profile": [1, 1],
                        "Ok.name_2-x": {"median_s": 0, "spread_s": 0, "extra": "ignored"}}}), now),
        ("latency_queries_list", but(latency={"default": {"median_s": 1, "spread_s": 0}, "queries": []}), now),
        ("latency_many", but(latency={"queries": {f"Q{i:02d}": {"median_s": i / 10, "spread_s": 0}
                                                  for i in range(60)}}), now),
        ("not_object", [ok], now),
        ("null", None, now),
        ("text", "steady", now)]
    cases = [{"name": n, "input": {"answer": a, "now": t}, "expected": testmode.read_scenario(a, t)}
             for n, a, t in answers]
    return doc("The answer of GET /test-scenario as a client reads it (spec/test-mode.md; 1.8.0): input {answer, now} "
               "-> {ok: true, scenario: {name, provider, subject, profile, data, latency: {default?, queries}, "
               "valid_until}} or {ok: false, error}. All of it synthetic.", cases,
               limits={"max_bytes": testmode.MAX_BYTES, "max_latency_s": testmode.MAX_LATENCY_S,
                       "max_queries": testmode.MAX_QUERIES})


# ---------------------------------------------------------------------------
# The handicap record (spec/hcp.md)
def hcp_plan_vectors() -> dict[str, Any]:
    last = "2026-11-20T08:00:00Z"
    cases: list[dict[str, Any]] = []
    for reason in (*hcp.REASONS, "backfill", ""):
        for now in ["2026-11-20T08:01:59Z", "2026-11-20T08:02:00Z", "2026-11-21T07:59:59Z", "2026-11-21T08:00:00Z",
                    "2026-11-21T08:00:00+01:00", "2026-11-25T12:00:00Z", "not a time"]:
            cases.append({"rule": "is_due", "input": {"last_sync_at": last, "reason": reason, "now": now},
                          "expected": hcp.is_due(last, reason, now)})
        for lst in [None, "2026-11-20T08:00:00", "garbage"]:
            cases.append({"rule": "is_due", "input": {"last_sync_at": lst, "reason": reason,
                                                     "now": "2026-11-20T09:00:00Z"},
                          "expected": hcp.is_due(lst, reason, "2026-11-20T09:00:00Z")})
    for lease, reason, now in [(None, "timer", 100.0), ({"until": 200}, "timer", 100.0), ({"until": 200}, "open", 200.0),
                               ({"until": 200}, "manual", 100.0), ({"until": True}, "timer", 0.0),
                               ({"until": "200"}, "connect", 100.0), ({}, "timer", 100.0)]:
        cases.append({"rule": "busy", "input": {"lease": lease, "reason": reason, "now_s": now},
                      "expected": hcp.busy(lease, reason, now)})
    seen = [{"played_on": "2026-05-01", "ref": "T-1"}, {"played_on": "2026-08-14", "ref": "T-2"},
            {"played_on": "2026-08-14", "ref": "T-3"}, {"played_on": "2026-09-30", "ref": "T-4", "status": "NA"},
            {"played_on": "2026-10-02"}, {"played_on": "2026-10-03", "ref": ""}, {"played_on": "2026-07-07", "ref": "T-2"},
            {"ref": "T-5"}, "junk", {"played_on": "2026-10-10", "ref": "T-6"}]
    for have, most in [([], None), (["T-6", "T-2"], None), ([], 2), (["T-1", "T-2", "T-3", "T-6"], 5), ("junk", 1),
                       ([], 0)]:
        cases.append({"rule": "cards_to_read", "input": {"results": seen, "cards_have": have, "most": most},
                      "expected": hcp.cards_to_read(seen, have, most)})
    many = [{"played_on": f"2026-{1 + i % 12:02d}-{1 + i % 28:02d}", "ref": f"C{i:02d}"} for i in range(30)]
    cases.append({"rule": "cards_to_read", "input": {"results": many, "cards_have": [], "most": None},
                  "expected": hcp.cards_to_read(many, [], None)})
    return doc("The rules of a handicap target and its clients (spec/hcp.md): is_due, busy, cards_to_read. "
               "`most: null` means the rules' max_cards. Exact.", cases, rules=hcp.RULES)


def dgvhcp_examples() -> dict[str, Any]:
    ref = cases_trackman.REF
    card = [{"hole": h, "par": p, "si": si, "score": sc, "gbe": sc, "given": 1, "points": pt, "points_gross": pg,
             "length_m": ln}
            for h, (p, si, sc, pt, pg, ln) in enumerate([(4, 5, 5, 2, 1, 352), (3, 9, 3, 3, 2, 151), (5, 1, 6, 2, 1, 470),
                                                         (4, 3, 4, 3, 2, 365), (4, 7, 5, 2, 1, 330), (3, 8, 4, 2, 1, 160),
                                                         (4, 2, 6, 1, 0, 401), (5, 6, 5, 3, 2, 488),
                                                         (4, 4, 4, 3, 2, 344)], start=1)]
    nine = {"played_on": "2026-08-14", "ref": "T-2041", "name": "Monatspreis August", "club_name": "Golfclub Beispiel",
            "club_no": "9999", "course_no": "1", "country": "49", "round_no": 1, "holes_read": 9, "kind": "tournament",
            "hcp_relevant": True, "format": "single", "art": "S", "tee": "Gelb", "par": 36, "cr": 35.9, "slope": 127,
            "hcp_index": 9.0, "ch": 6, "ph": 6, "gbe": 42, "place": 3, "field": 27, "holes": card}
    eighteen = {"played_on": "2026-06-20", "name": "Clubmeisterschaft", "club_name": "Golfclub Beispiel",
                "club_no": "9999", "round_no": 2, "holes_read": 18, "hcp_relevant": True, "format": "single", "art": "Z",
                "tee": "Weiß", "par": 72, "cr": 72.4, "slope": 133, "hcp_index": 8.6, "ch": 10, "gbe": 84, "sd": 9.9,
                "pcc": 0, "counting": True, "gross": 84}
    good = {"format": "dgvhcp/1", "provider": "golfde", "account_ref": ref, "generated_at": "2026-11-21T12:00:00Z",
            "sheet": "mixed", "index": {"value": 8.1, "as_of": "2026-11-21", "low": 7.4}, "results": [nine, eighteen]}
    full = {**copy.deepcopy(good), "generator": {"name": "golf-launch-monitor-sync", "version": "0.4.0"},
            "sync": {"plan_id": "hp_31c2", "reason": "manual"},
            "notice": {"code": "partial", "message": "Three scorecards come with the next read."},
            "extra": {"anything": ["is", "kept"]}}
    full["results"] += [
        {"played_on": "2026-04-11", "format": "rpr", "kind": "private", "holes_read": 18, "hcp_relevant": True,
         "par": 70, "cr": 69.8, "slope": 125, "gbe": 88, "art": "Z"},
        {"played_on": "2025-09-01", "status": "NA", "holes_read": 18, "par": 36, "cr": 35.5, "slope": 120, "gbe": 0,
         "hcp_relevant": True, "name": "Herbstpreis"},
        {"played_on": "2019-05-12", "holes_read": 18, "stableford_net": 34, "hcp_index": 12.4, "hcp_relevant": True,
         "name": "Frühjahrspreis"},
        {"played_on": "2024-03-03", "kind": "adjustment", "cr": 70.1, "exceptional": -1}]

    def bad(name: str, why: str, change: Any) -> dict[str, Any]:
        b = copy.deepcopy(good)
        change(b)
        return {"name": name, "why": why, "valid": False, "batch": b}

    def on_first(**kw: Any) -> Any:
        return lambda b: b["results"][0].update(kw)

    # 1.10.0: a client that only observes the provider's page sends what each page brought, one batch a page; the
    # same result comes again and again (History Sheet, Scoring Record, the result list's own line) and is one result.
    seen = {"played_on": "2026-10-03", "ref": "c0ffee00-0000-4000-8000-000000000001", "name": "Herbstpreis",
            "club_name": "Golfclub Beispiel", "club_no": "9999", "course_no": "1", "country": "49", "round_no": 1,
            "holes_read": 18, "kind": "tournament", "hcp_relevant": True, "format": "single", "art": "S",
            "tee": "gelb", "par": 72, "cr": 71.4, "slope": 131, "hcp_index": 8.4, "ph": 10, "gbe": 85}

    def page(sheet: str, result: dict[str, Any], plan: str) -> dict[str, Any]:
        return {"format": "dgvhcp/1", "provider": "golfde", "account_ref": ref, "generated_at": "2026-11-21T19:30:00Z",
                "generator": {"name": "Golf Stats Sync for Chrome and Edge", "version": "0.9.0"},
                "sync": {"plan_id": plan, "reason": "manual"}, "sheet": sheet, "results": [result]}

    observed = [
        {"name": "page_history", "why": "1.10.0: one page of the History Sheet as the player opened it (a batch per "
                                       "page; the first result of a sequence of three that are one result).",
         "valid": True, "batch": {**page("history", seen, "hp_a1"), "index": {"value": 8.1, "as_of": "2026-11-21",
                                                                              "low": 7.4}}},
        {"name": "page_scoring", "why": "1.10.0: the same result from the Scoring Record, now with its Score "
                                       "Differential.",
         "valid": True, "batch": page("scoring", {**seen, "sd": 11.2, "pcc": 0, "counting": True}, "hp_a2")},
        {"name": "page_own_place", "why": "1.10.0: the same result again with the player's own place from the "
                                         "result list (the whole result, so the target finds it).",
         "valid": True, "batch": page("mixed", {**seen, "sd": 11.2, "pcc": 0, "counting": True, "place": 7,
                                                 "field": 42}, "hp_a3")}]

    cases = [{"name": "minimal", "why": "Nothing read yet (an empty record).", "valid": True,
              "batch": {"format": "dgvhcp/1", "provider": "golfde", "account_ref": ref,
                        "generated_at": "2026-11-21T12:00:00Z", "sheet": "history", "results": []}},
             {"name": "two_results", "why": "A nine-hole tournament with its card and own place, an 18-hole one.",
              "valid": True, "batch": good},
             {"name": "everything", "why": "Every optional part, a private round without a name, a no-show, a result "
                                           "before the WHS (points), an adjustment.", "valid": True, "batch": full},
             *observed,
             bad("wrong_format", "Another format version.", lambda b: b.update(format="dgvhcp/2")),
             bad("no_account_ref", "account_ref is required.", lambda b: b.pop("account_ref")),
             bad("no_sheet", "sheet is required.", lambda b: b.pop("sheet")),
             bad("sheet_unknown", "sheet is a closed list.", lambda b: b.update(sheet="card")),
             bad("local_time", "Times carry their zone.", lambda b: b.update(generated_at="2026-11-21T12:00:00")),
             bad("day_as_german", "Days are YYYY-MM-DD.", on_first(played_on="14.08.2026")),
             bad("no_day", "A result has its day.", lambda b: b["results"][0].pop("played_on")),
             bad("nothing_tells_the_holes", "holes_read, par or cr: one of them.",
                 lambda b: [b["results"][0].pop(k) for k in ("holes_read", "par", "cr")]),
             bad("marker_name", "A registered private round never carries a name (it is the marker's).",
                 on_first(format="rpr", name="RPR: Someone")),
             bad("other_players", "No room for other players: only the own place and field.",
                 on_first(others=[{"rank": 1, "name": "Someone"}])),
             bad("null_value", "Unknown values are left out, not null.", on_first(sd=None)),
             bad("sd_as_text", "Numbers are JSON numbers (the record's commas are the client's to read).",
                 on_first(sd="8,6")),
             bad("index_out_of_range", "An index is between -10 and 54.",
                 lambda b: b["index"].update(value=60)),
             bad("index_without_day", "An index says the day it is for.", lambda b: b["index"].pop("as_of")),
             bad("card_of_ten", "A scorecard has 9 or 18 holes.",
                 lambda b: b["results"][0]["holes"].append({"hole": 10, "par": 4})),
             bad("hole_without_par", "Every hole has its par.", lambda b: b["results"][0]["holes"][0].pop("par")),
             bad("too_many", "At most 500 results in a batch.",
                 lambda b: b.update(results=[copy.deepcopy(eighteen) for _ in range(501)])),
             bad("unknown_top_level", "Extensions go into extra.", lambda b: b.update(player="Someone")),
             bad("notice_code", "Notice codes are a closed list.", lambda b: b.update(notice={"code": "hello"}))]
    return doc("dgvhcp/1 batches that must (valid: true) or must not validate against spec/hcp/dgvhcp-1.schema.json.",
               cases)


# A professional's own pages (spec/prores.md, 1.15.0)
NAMES = [["Lena Musterfrau", "Lena Musterfrau", "the same"], ["MUSTERFRAU, Lena", "Lena Musterfrau", "surname first, upper case"], ["Lena Musterfrau", "Lena Marie Musterfrau", "a middle name only here"], ["MÜLLER Anna-Lena", "Anna Lena Mueller", "umlaut and hyphen"], ["Inés García", "Ines Garcia", "accents"], ["Lena Beispiel", "Lena Musterfrau", "another surname"], ["Musterfrau", "Lena Musterfrau", "one part is not enough"], ["Max Musterfrau", "Lena Musterfrau", "another first name"], ["Lena Musterfrau", "", "no name in the Caddie"]]


def prores_examples() -> dict[str, Any]:
    cases = cases_prores.draft()
    by = {c["name"]: c for c in cases}
    # A world ranking names a week, not a day (1.15.0): the draft's world ranking page now says so.
    w = by["a_world_ranking_page"]["batch"]["tournaments"][0]
    w.pop("start")
    w["week"] = "2026-W43"
    by["tournament_without_start"]["why"] = "A tournament with neither its start nor its week: left out with its rounds."
    ref = cases_prores.REF

    def page(site: str, name: str, **rest: Any) -> dict[str, Any]:
        return {"format": "prores/1", "provider": "pro", "site": site, "account_ref": ref,
                "generated_at": "2026-11-25T18:00:00Z", "generator": {"name": "Golf Stats Sync", "version": "0.13.0"},
                "sync": {"plan_id": "p-7", "reason": "manual"}, "player": {"name": name}, **rest}

    owgr = page("owgr", "Max Mustermann",
                rankings=[{"source": "owgr", "rank": 412, "points": 0.9871, "events": 40, "as_of": "2026-11-25"}],
                tournaments=[
                    {"ref": "owgr-90012", "tour": "dp_world", "name": "Musterstadt Open", "week": "2026-W40", "place": 17,
                     "tied": True, "points": 2.16597},
                    {"ref": "owgr-90007", "tour": "hotelplanner", "name": "Beispiel Challenge", "week": "2026-W39",
                     "place": 1, "points": 12.5},
                    {"ref": "owgr-89950", "name": "A Major Somewhere", "week": "2026-W29", "result": "MC"}])
    rolex = page("rolex", "Lena Musterfrau",
                 rankings=[{"source": "rolex", "rank": 87, "points": 1.42, "events": 38, "as_of": "2026-11-25"}],
                 tournaments=[
                     {"ref": "rolex-7001", "tour": "lpga", "name": "Beispiel Classic", "week": "2026-W47", "place": 36,
                      "tied": True, "points": 2.2},
                     {"ref": "rolex-6950", "tour": "let", "name": "Musterland Masters", "week": "2026-W20", "place": 7,
                      "tied": True, "points": 2.34},
                     {"ref": "rolex-6901", "tour": "lpga", "name": "Exemple Open", "week": "2026-W40", "result": "MC"}])
    rounds_without_start = page("owgr", "Max Mustermann", tournaments=[
        {"ref": "owgr-1", "week": "2026-W40", "place": 3, "rounds": [{"round_no": 1, "gross": 70}]}])
    no_such_week = page("owgr", "Max Mustermann", tournaments=[{"ref": "owgr-2", "week": "2026-W54", "place": 3}])
    cases += [
        {"name": "owgr_page", "why": "The OWGR's page of the player: his rank, average points and divisor, his tournaments "
         "by week with place and points won, no rounds (a world ranking has none; a major names no tour).",
         "valid": True, "batch": owgr, "expect": {"rows": 0, "rankings": 1, "events": 3, "stats": 0}},
        {"name": "rolex_page", "why": "The Rolex Rankings' page of the player: the same, the cut as MC.",
         "valid": True, "batch": rolex, "expect": {"rows": 0, "rankings": 1, "events": 3, "stats": 0}},
        {"name": "rounds_without_start", "why": "Rounds of a tournament known only by its week: the rounds can't be "
         "placed on days, so they cost (counted failed); the tournament stays.", "valid": False,
         "batch": rounds_without_start, "expect": {"rows": 0, "rankings": 0, "events": 1, "stats": 0}},
        {"name": "no_such_week", "why": "A week no year has: the tournament is left out.", "valid": False,
         "batch": no_such_week, "expect": {"rows": 0, "rankings": 0, "events": 0, "stats": 0}},
    ]
    places = ["T17", "17T", "36T", "1", " 2 ", "t3", "MC", "CUT", "cut", "WD", "RTD", "DQ", "DSQ", "DNS", "BP", "-",
              "\u2014", "", "0", "T0", "1000", "T1000", "999", "12.5", "T-5", "3T T", "E", None, 17]
    rules = [{"rule": "place_of", "input": x, "expected": prores.place_of(x)} for x in places]
    tours = [("owgr", "DPWT"), ("owgr", "PGAT"), ("owgr", "KFT"), ("owgr", "Maj"), ("owgr", "dpwt"), ("owgr", " PGAT "),
             ("owgr", "LPGA"), ("rolex", "LPGA"), ("rolex", "LET"), ("rolex", "LETAS"), ("rolex", "IGF"),
             ("rolex", "JLPGA"), ("tour:let", "LET"), ("owgr", None), (None, "DPWT")]
    rules += [{"rule": "tour_of", "input": {"site": a, "code": b}, "expected": prores.tour_of(a, b)} for a, b in tours]
    weeks = ["2026-W47", "2026-W01", "2026-W53", "2020-W53", "2026-W00", "2026-W54", "2026-w47", "2026-47", "26-W47",
             "2026-W7", None]
    rules += [{"rule": "iso_week", "input": x, "expected": prores.iso_week(x)} for x in weeks]
    return doc("prores/1 batches that must (valid: true) or must not validate against spec/prores/prores-1.schema.json, "
               "and what a target keeps of each (expect: rows = rounds with a score, rankings, events = tournaments, "
               "stats = snapshots, values = statistics of the first; refused: invalid or too_large). rules: place_of "
               "(a page's finish -> {place, tied} or {result}, else null), tour_of (a world ranking's tour column -> a "
               "tour key or null), iso_week. names: whether a page's name is the player's (every part of the shorter "
               "among the other's, at least two).", cases, rules=rules,
               names=[{"page": a, "player": b, "same": prores.same_name(a, b), "why": why} for a, b, why in NAMES],
               tour_codes=prores.TOUR_CODES)


def wake_vectors() -> dict[str, Any]:
    tok = "ExponentPushToken[" + "a1B2c3D4e5F6g7H8i9J0kL" + "]"
    bodies: list[Any] = [
        {"service": "expo", "address": tok}, {"service": "expo", "address": "ExpoPushToken[abcdEFGH_-12]"},
        {"service": "expo", "address": tok, "platform": "ios"}, {"service": "expo", "address": tok, "extra": {"x": 1}},
        {"service": "Expo", "address": tok}, {"service": "fcm", "address": tok}, {"service": "apns", "address": tok},
        {"address": tok}, {"service": "expo"}, {"service": "expo", "address": ""},
        {"service": "expo", "address": "ExponentPushToken[]"}, {"service": "expo", "address": "ExponentPushToken[short]"},
        {"service": "expo", "address": "ExponentPushToken[" + "x" * 200 + "]"},
        {"service": "expo", "address": "ExponentPushToken[" + "x" * 201 + "]"},
        {"service": "expo", "address": tok + " "}, {"service": "expo", "address": " " + tok},
        {"service": "expo", "address": "ExponentPushToken[abc def ghi]"},
        {"service": "expo", "address": "ExponentPushToken[abcdefgh\u00e9]"},
        {"service": "expo", "address": "https://example.org/push"}, {"service": "expo", "address": 12345678},
        {"service": "expo", "address": [tok]}, {"service": ["expo"], "address": tok}, {"service": None, "address": tok},
        [], "expo", None, 1]
    cases: list[dict[str, Any]] = [{"rule": "read_wake", "input": b, "expected": wake.read_wake(b)} for b in bodies]
    now = "2026-11-21T18:00:00Z"
    w = {"now": now, "signin": "ready", "due_at": "2026-11-21T17:59:00Z", "woken_at": None, "quiet_until": None}
    whens: list[dict[str, Any]] = [
        w, {**w, "due_at": now}, {**w, "due_at": "2026-11-21T18:00:01Z"}, {**w, "due_at": None},
        {**w, "signin": "expired"}, {**w, "signin": "none"}, {**w, "signin": "confirm"}, {**w, "signin": "other"},
        {**w, "signin": None}, {**w, "signin": "Ready"},
        {**w, "woken_at": "2026-11-21T17:40:00Z"}, {**w, "woken_at": "2026-11-21T17:40:01Z"},
        {**w, "woken_at": "2026-11-21T17:00:00Z"}, {**w, "woken_at": "2026-11-21T18:30:00Z"},
        {**w, "woken_at": "yesterday"}, {**w, "quiet_until": "2026-11-21T18:00:01Z"},
        {**w, "quiet_until": now}, {**w, "quiet_until": "2026-11-21T17:00:00Z"}, {**w, "quiet_until": 5},
        {**w, "due_at": "2026-11-21T19:59:00+02:00"}, {**w, "due_at": "2026-11-21T20:00:01+02:00"},
        {**w, "now": "2026-11-21T19:00:00+01:00", "woken_at": "2026-11-21T17:41:00Z"},
        {**w, "due_at": "2026-11-21 17:59:00"}, {**w, "now": None}, {**w, "now": "now"},
        # Back to the target app (1.12.0): once per return, five minutes after the last wake are enough.
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": "2026-11-21T17:59:30Z"},
        {**w, "woken_at": "2026-11-21T17:55:01Z", "back_at": "2026-11-21T17:59:30Z"},
        {**w, "woken_at": "2026-11-21T17:56:00Z", "back_at": "2026-11-21T17:59:30Z"},
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": "2026-11-21T17:54:00Z"},
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": "2026-11-21T18:00:30Z"},
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": "just now"},
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": None},
        {**w, "woken_at": "2026-11-21T17:59:00Z", "back_at": "2026-11-21T17:59:30Z"},
        {**w, "woken_at": None, "back_at": "2026-11-21T17:59:30Z"},
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": "2026-11-21T17:59:30Z", "signin": "expired"},
        {**w, "woken_at": "2026-11-21T17:55:00Z", "back_at": "2026-11-21T17:59:30Z", "due_at": None}]
    cases += [{"rule": "should_wake", "input": i, "expected": wake.should_wake(**i)} for i in whens]
    datas: list[Any] = [
        {"kind": "lm_plan"}, {"kind": "lm_plan", "experienceId": "@x/y"}, {"kind": "LM_PLAN"}, {"kind": "plan"},
        {"kind": ["lm_plan"]}, {}, {"body": {"kind": "lm_plan"}}, "lm_plan", None, []]
    cases += [{"rule": "is_wake", "input": d, "expected": wake.is_wake(d)} for d in datas]
    return doc("The wake (spec/wake.md, 1.9.0). read_wake: the body of PUT /wake -> {service, address} or null. "
               "should_wake: {now, signin, due_at, woken_at, quiet_until, back_at (1.12.0, optional)} (RFC 3339 "
               "times or null) -> whether a "
               "target wakes the client now. is_wake: a push's data object -> whether it is a wake.", cases,
               wake={"services": list(wake.SERVICES), "gap_s": wake.GAP_S, "back_gap_s": wake.BACK_GAP_S,
                     "payload": wake.PAYLOAD,
                     "address_max": wake.ADDRESS_MAX})


def ask_vectors() -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for v in [["wake"], ["nudge"], ["link"], ["page"], ["Wake"], ["timer"], ["wake", "wake"], [], [""], [1], "wake", None]:
        cases.append({"rule": "read_cause", "input": v, "expected": ask.read_cause(v)})
    for v in [["0.17.1"], ["1.0.0-beta.2+build.7"], ["x" * 50], ["x" * 51], ["0.17 1"], ["0.17.1\n"], [""],
              ["0.17.1", "0.18.0"], [0.17], None]:
        cases.append({"rule": "read_version", "input": v, "expected": ask.read_version(v)})
    for v in [["os:android,background:available,battery:optimized,push:off"],
              ["push:on,os:ios,background:denied"], ["background:restricted"], ["os:android,battery:exempt,later:yes"],
              ["os:android,os:ios,push:on"], ["os:Android"], ["battery:"], ["os"], [":android"], [""],
              ["os:android, push:on"], ["os:android,,push:on"], ["os:android:x"], ["os:" + "a" * 197],
              ["os:android", "push:on"], [], "os:android", None, [7]]:
        cases.append({"rule": "read_env", "input": v, "expected": ask.read_env(v)})
    a = {"v": "1"}
    answers: list[Any] = [
        {**a, "state": "accepted"}, {**a, "state": "started"}, {**a, "state": "started", "extra": "x"},
        {**a, "state": "not_due"}, {**a, "state": "not_due", "until": "2026-11-27T21:40:00Z"},
        {**a, "state": "not_due", "until": "soon"}, {**a, "state": "started", "until": "2026-11-27T21:40:00Z"},
        {**a, "state": "busy", "by": "extension"}, {**a, "state": "busy", "by": "extension", "since": "2026-11-27T21:17:00Z"},
        {**a, "state": "busy"}, {**a, "state": "busy", "by": "phone"}, {**a, "state": "busy", "by": "web", "since": "11:17"},
        {**a, "state": "signin", "signin": "expired"}, {**a, "state": "signin", "signin": "none"},
        {**a, "state": "signin", "signin": "ready"}, {**a, "state": "signin"}, {**a, "state": "outdated"},
        {**a, "state": "blocked", "why": "guard", "until": "2026-11-27T22:30:00.250+01:00"},
        {**a, "state": "blocked", "why": "system"}, {**a, "state": "blocked", "why": "provider"},
        {**a, "state": "blocked"}, {**a, "state": "blocked", "why": "battery"},
        {**a, "state": "failed", "why": "target"}, {**a, "state": "failed", "why": "unpaired"},
        {**a, "state": "failed", "why": "disconnected"}, {**a, "state": "failed", "why": "error"},
        {**a, "state": "failed"}, {**a, "state": "failed", "why": "guard"}, {**a, "state": "done"},
        {**a, "state": "Started"}, {"state": "started"}, {"v": 1, "state": "started"}, {"v": "2", "state": "started"},
        {**a, "state": ["started"]}, {**a}, None, [], "started"]
    cases += [{"rule": "read_answer", "input": x, "expected": ask.read_answer(x)} for x in answers]
    got = "2026-11-27T21:00:00Z"
    for own, nxt in [("2026-11-27T21:30:00Z", None), ("2026-11-27T21:30:00Z", "2026-11-27T22:00:00Z"),
                     ("2026-11-27T22:30:00Z", "2026-11-27T22:00:00Z"), ("2026-11-27T21:30:00Z", "2026-11-28T09:00:00Z"),
                     ("2026-11-27T21:30:00Z", "2026-11-27T20:00:00Z"), ("2026-11-27T21:30:00Z", "tomorrow"),
                     ("2026-11-27T21:30:00Z", "2026-11-27T23:00:00+01:00"), ("2026-11-27T21:30:00.500Z", None),
                     ("half past nine", "2026-11-27T22:00:00Z")]:
        cases.append({"rule": "own_ask_at", "input": {"own_at": own, "next_at": nxt, "received_at": got},
                      "expected": ask.own_ask_at(own, nxt, got)})
    cases.append({"rule": "own_ask_at", "input": {"own_at": "2026-11-27T21:30:00Z", "next_at": "2026-11-27T22:00:00Z",
                                                  "received_at": None},
                  "expected": ask.own_ask_at("2026-11-27T21:30:00Z", "2026-11-27T22:00:00Z", None)})  # type: ignore[arg-type]
    m = {"reason": "timer", "cause": None, "now": "2026-11-27T21:30:00Z", "next_at": "2026-11-27T22:00:00Z",
         "received_at": got}
    for i in [m, {**m, "now": "2026-11-27T22:00:00Z"}, {**m, "now": "2026-11-27T22:00:01Z"},
              {**m, "cause": "wake"}, {**m, "cause": "nudge"}, {**m, "cause": "link"}, {**m, "cause": "page"},
              {**m, "cause": "Wake"}, {**m, "reason": "manual"}, {**m, "reason": "open"}, {**m, "reason": "connect"},
              {**m, "reason": "backfill"}, {**m, "next_at": None}, {**m, "next_at": "later"},
              {**m, "next_at": "2026-11-28T21:00:00Z", "now": "2026-11-28T02:59:59Z"},
              {**m, "next_at": "2026-11-28T21:00:00Z", "now": "2026-11-28T03:00:00Z"},
              {**m, "received_at": None}, {**m, "now": "now"}]:
        cases.append({"rule": "may_ask", "input": i, "expected": ask.may_ask(**i)})
    return doc("The question and the answer (spec 1.22.0; target-api.md *Asking and answering*, deep-links.md *The answer "
               "over the binding*, planning.md *Who asks when*). read_cause, read_version: the list of a query "
               "parameter's values -> the value or null. read_env: the same -> the known pairs ({} for none). read_answer: "
               "the strings of the Bundle the companion app sent over the binding -> {state, until?, by?, since?, signin?, "
               "why?} or null. own_ask_at: {own_at, next_at, received_at} -> when the client's own timer may next ask "
               "(RFC 3339, UTC to the millisecond) or null. may_ask: {reason, cause, now, next_at, received_at} -> "
               "whether the client asks for a plan now.", cases,
               ask={"causes": list(ask.CAUSES), "env": {k: list(v) for k, v in ask.ENV.items()}, "env_max": ask.ENV_MAX,
                    "answer_v": ask.ANSWER_V, "states": list(ask.STATES), "blocked": list(ask.BLOCKED),
                    "failed": list(ask.FAILED), "accept_s": ask.ACCEPT_S, "answer_s": ask.ANSWER_S,
                    "own_max_s": ask.OWN_MAX_S})


# One tournament from golf.de's page (spec/hcp.md, *Taking one tournament*, 1.19.0)
def dgvevent_page_vectors() -> dict[str, Any]:
    cases = [{**c, "expected": event.read_page(copy.deepcopy(c["input"]))} for c in cases_event.pages()]
    return doc("A golf.de tournament page as a client sees it -> dgvevent/1's event (spec/reference/event.py). input: "
               "{address, heading, lines: [[label, value], ...]} (the lines under Turnierinformationen in the page's "
               "order); expected: {event} or {refused: not_a_tournament | changed_page}. Compare as JSON values.",
               cases, labels=event.LABELS)


def dgvevent_examples() -> dict[str, Any]:
    full = event.read_page(cases_event.pages()[0]["input"])["event"]
    return doc("dgvevent/1 bodies that must (valid: true) or must not validate against spec/hcp/dgvevent-1.schema.json, "
               "and what a target does reading each (target: refused, or the fields it left out as dropped).",
               cases_event.examples(full))


# The sealed handover (1.27.0): fixed keys, so that every implementation of NaCl's box can check its bytes.

def _fixed(label: str, size: int) -> str:
    return handover.b64url(hashlib.sha256(f"glmsync handover vectors: {label}".encode()).digest()[:size])


HANDOVER_TARGET_SECRET = _fixed("the target app's secret key", 32)
HANDOVER_CLIENT_SECRET = _fixed("the client's secret key for its answer", 32)
HANDOVER_OTHER_SECRET = _fixed("someone else's secret key", 32)
HANDOVER_KEY = handover.public_key(HANDOVER_TARGET_SECRET)
HANDOVER_NONCE = _fixed("the nonce of the question", 24)
HANDOVER_OTHER_NONCE = _fixed("another question's nonce", 24)


def handover_vectors() -> dict[str, Any]:
    ts, cs, os_, key, nonce = (HANDOVER_TARGET_SECRET, HANDOVER_CLIENT_SECRET, HANDOVER_OTHER_SECRET, HANDOVER_KEY,
                               HANDOVER_NONCE)
    # Synthetic: shaped like a provider's key, made up for the vectors.
    msg = {"provider": "trackman",
           "token": "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJzeW50aGV0aWMtcGxheWVyIn0.c3ludGhldGlj",
           "account_ref": "c3ludGhldGljLWFjY291bnQtcmVm", "expires_at": "2026-12-05T08:12:00Z",
           "user_agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like "
                         "Gecko) Mobile/15E148"}
    no_exp = {k: v for k, v in msg.items() if k != "expires_at"}
    cases: list[dict[str, Any]] = []
    for s in [ts, cs, os_, "", "AAAA", ts + "A", ts[:-1], ts + "=", ts[:-1] + "/", 5, None]:
        cases.append({"rule": "public_key", "input": s, "expected": handover.public_key(s)})
    seals = [(msg, key, nonce, cs), (no_exp, key, nonce, cs),
             ({**msg, "expires_at": "2026-12-05T09:12:00+01:00"}, key, nonce, cs),
             ({**msg, "token": "x" * 4096}, key, nonce, cs), ({**msg, "token": "x" * 4097}, key, nonce, cs),
             ({**msg, "token": "a b"}, key, nonce, cs), ({**msg, "provider": "Trackman"}, key, nonce, cs),
             ({**msg, "account_ref": "short"}, key, nonce, cs), ({**msg, "user_agent": ""}, key, nonce, cs),
             ({**msg, "user_agent": " Mozilla/5.0"}, key, nonce, cs),
             ({**msg, "user_agent": "Mozilla/5.0 ü"}, key, nonce, cs),
             ({**msg, "expires_at": "2026-12-05"}, key, nonce, cs),
             ({**msg, "expires_at": "2026-12-05T08:12:00"}, key, nonce, cs), ({**msg, "expires_at": None}, key, nonce, cs),
             ({**msg, "expires_at": "2026-02-30T08:12:00Z"}, key, nonce, cs), ({**msg, "later": "kept out"}, key, nonce, cs),
             ({k: v for k, v in msg.items() if k != "user_agent"}, key, nonce, cs),
             (msg, key[:-1], nonce, cs), (msg, key, nonce[:-1], cs), (msg, key, nonce, cs[:-1]), (msg, None, nonce, cs),
             ("not a message", key, nonce, cs)]
    for m, k, n, sec in seals:
        cases.append({"rule": "seal", "input": {"message": m, "key": k, "nonce": n, "secret": sec},
                      "expected": handover.seal(m, k, n, sec)})
    good = handover.seal(msg, key, nonce, cs)
    plain = handover.seal(no_exp, key, nonce, cs)
    assert good is not None and plain is not None
    frm, sealed = good["from"], good["box"]
    flipped = sealed[:10] + ("A" if sealed[10] != "A" else "B") + sealed[11:]
    raw_n, raw_k, raw_s = handover.unb64url(nonce), handover.unb64url(key), handover.unb64url(cs)
    assert raw_n is not None and raw_k is not None and raw_s is not None

    def raw(data: bytes) -> str:
        return handover.b64url(handover.box(data, raw_n, raw_k, raw_s))

    def j(o: Any) -> bytes:
        return json.dumps(o, separators=(",", ":")).encode()

    no_ua = {k: v for k, v in msg.items() if k != "user_agent"}
    opens = [(sealed, frm, nonce, ts), (plain["box"], frm, nonce, ts),
             (flipped, frm, nonce, ts), (sealed, frm, HANDOVER_OTHER_NONCE, ts), (sealed, frm, nonce, os_),
             (sealed, handover.public_key(os_), nonce, ts), (sealed[:20], frm, nonce, ts), ("", frm, nonce, ts),
             (sealed + "=", frm, nonce, ts), (sealed, frm[:-1], nonce, ts), (None, frm, nonce, ts),
             (raw(j({**msg, "v": 1, "later": True})), frm, nonce, ts),
             (raw(j({"v": 1, **msg, "expires_at": "soon"})), frm, nonce, ts),
             (raw(j({"v": 1, **msg, "expires_at": None})), frm, nonce, ts),
             (raw(j({"v": 1, **msg, "expires_at": "2026-12-05T08:12:00"})), frm, nonce, ts),
             (raw(j({"v": 2, **msg})), frm, nonce, ts), (raw(j({"v": True, **msg})), frm, nonce, ts),
             (raw(j({"v": "1", **msg})), frm, nonce, ts), (raw(j({**msg})), frm, nonce, ts),
             (raw(j({"v": 1, **no_ua})), frm, nonce, ts), (raw(j({"v": 1, **msg, "token": ""})), frm, nonce, ts),
             (raw(j({"v": 1, **msg, "user_agent": "Mozilla/5.0 "})), frm, nonce, ts),
             (raw(j([msg])), frm, nonce, ts), (raw(b"not json"), frm, nonce, ts), (raw(b"\xff\xfe"), frm, nonce, ts),
             (raw(b'{"v":1,"x":NaN}'), frm, nonce, ts), (raw(b""), frm, nonce, ts)]
    for b, f, n, sec in opens:
        cases.append({"rule": "open", "input": {"box": b, "from": f, "nonce": n, "secret": sec},
                      "expected": handover.open_sealed(b, f, n, sec)})
    answer = {"signin": "sealed", "from": frm, "box": sealed}
    for u, a in [("exampleapp://signedin", answer), ("exampleapp://signedin", {"signin": "none"}),
                 ("exampleapp://signedin", {"signin": "other_account"}), ("exampleapp://signedin", {"signin": "failed"}),
                 ("https://app.example.org/profile?tab=lm#card", answer),
                 ("https://app.example.org/profile#card&signin=none&box=x", {"signin": "failed"}),
                 ("exampleapp://signedin#", {"signin": "none"}),
                 ("exampleapp://signedin", {"signin": "sealed"}),
                 ("exampleapp://signedin", {"signin": "sealed", "from": frm}),
                 ("exampleapp://signedin", {"signin": "sealed", "from": "x", "box": sealed}),
                 ("exampleapp://signedin", {"signin": "sealed", "from": frm, "box": ""}),
                 ("exampleapp://signedin", {"signin": "done"}), ("exampleapp://signedin", None),
                 ("javascript:alert(1)", {"signin": "none"}), ("glmsync://sync", {"signin": "none"}),
                 (None, {"signin": "none"}),
                 ("https://app.example.org/" + "x" * 2000, answer),
                 ("https://app.example.org/x", {"signin": "sealed", "from": frm, "box": "A" * 8100})]:
        cases.append({"rule": "with_answer", "input": {"url": u, "answer": a}, "expected": handover.with_answer(u, a)})
    back = handover.with_answer("exampleapp://signedin", answer)
    for u in [back, "exampleapp://signedin#signin=none", "exampleapp://signedin#card&signin=other_account",
              "exampleapp://signedin#signin=failed", "exampleapp://signedin?signin=none",
              "exampleapp://signedin#signin=none&signin=failed", "exampleapp://signedin#signin=sealed",
              f"exampleapp://signedin#signin=sealed&from={frm}", f"exampleapp://signedin#signin=sealed&box={sealed}",
              f"exampleapp://signedin#signin=sealed&from={frm}&box={sealed}&box={sealed}",
              f"exampleapp://signedin#signin=sealed&from={frm[:-1]}&box={sealed}",
              f"exampleapp://signedin#signin=sealed&from={frm}&box=",
              f"exampleapp://signedin#signin=sealed&from={frm}&box=a%20b",
              "exampleapp://signedin#signin=None", "exampleapp://signedin#signin=", "exampleapp://signedin",
              "exampleapp://signedin#signin=none#x", "x" * 8200 + "#signin=none", None, 7]:
        cases.append({"rule": "read_answer", "input": u, "expected": handover.read_answer(u)})
    return doc("Signing in for a target: the sealed handover (spec/deep-links.md, *Signing in for a target*; 1.27.0; "
               "reference/handover.py). Keys, nonces, `from` and `box` are base64url without padding (keys 32 bytes, "
               "nonces 24). public_key (a secret key) -> its public key or null. seal ({message, key, nonce, secret}: "
               "the client's secret key for this answer) -> {from, box} (NaCl box of the message as compact JSON with "
               "the keys v, provider, token, account_ref, expires_at?, user_agent in this order) or null; compare "
               "exactly. open ({box, from, nonce, secret}: the target's secret key) -> the message read strictly "
               "{provider, token, account_ref, expires_at?, user_agent} or null. with_answer ({url, answer}) -> the way "
               "back with the answer in its fragment, or null. read_answer (the address the target was opened at) -> "
               "{signin, from?, box?} or null.", cases,
               keys={"target_secret": ts, "target_key": key, "client_secret": cs, "nonce": nonce},
               results=list(handover.RESULTS), max_answer=handover.MAX_ANSWER)


FILES = {
    "trackman-olmd.json": trackman_vectors,
    "clubs.json": club_vectors,
    "values.json": value_vectors,
    "account-ref.json": account_vectors,
    "plan.json": plan_vectors,
    "guard.json": guard_vectors,
    "deep-links.json": deep_link_vectors,
    "signin.json": signin_vectors,
    "page-bridge.json": bridge_vectors,
    "olmd-examples.json": olmd_examples,
    "test-scenario.json": test_scenario_vectors,
    "hcp-plan.json": hcp_plan_vectors,
    "dgvhcp-examples.json": dgvhcp_examples,
    "dgvevent-page.json": dgvevent_page_vectors,
    "dgvevent-examples.json": dgvevent_examples,
    "prores-examples.json": prores_examples,
    "wake.json": wake_vectors,
    "ask.json": ask_vectors,
    "handover.json": handover_vectors,
}


def render(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2) + "\n"


def main(argv: list[str]) -> int:
    check = "--check" in argv
    stale = []
    OUT.mkdir(exist_ok=True)
    for name, make in FILES.items():
        text = render(make())
        path = OUT / name
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(name)
        else:
            path.write_text(text)
    if stale:
        print("Out of date (run python3 spec/reference/generate.py):", ", ".join(stale), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
