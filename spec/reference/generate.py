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
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import account  # noqa: E402
import cases_trackman  # noqa: E402
import clubs  # noqa: E402
import deeplinks  # noqa: E402
import guard  # noqa: E402
import plan  # noqa: E402
import trackman  # noqa: E402
import values  # noqa: E402

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
    events = [{"t": 0, "op": "plan", "reason": "timer"}, {"t": 10, "op": "plan", "reason": "open"},
              {"t": 20, "op": "plan", "reason": "backfill"}, {"t": 30, "op": "plan", "reason": "backfill"},
              {"t": 40, "op": "plan", "reason": "manual"}, {"t": 50, "op": "import", "reason": "timer"},
              {"t": 60, "op": "plan", "reason": "timer"}, {"t": 299.9, "op": "plan", "reason": "connect"},
              {"t": 320, "op": "plan", "reason": "backfill"}, {"t": 330, "op": "connect", "reason": "connect"},
              {"t": 331, "op": "plan", "reason": "backfill"}, {"t": 360, "op": "plan", "reason": "timer"},
              {"t": 660, "op": "plan", "reason": "timer"}]
    cases.append({"rule": "leases", "input": {"events": events}, "expected": plan.leases(events)})
    return doc("The reference planning rules of a target (spec/planning.md). Times compare as instants within "
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
             f"glmsync://pair?target={t}&code=K7M2PQ9X&return=exampleapp%3A%2F%2Fa&return=exampleapp%3A%2F%2Fb"]
    cases: list[dict[str, Any]] = [{"rule": "parse_link", "input": u, "expected": deeplinks.parse_link(u)} for u in links]
    frags = [f"#target={t}&code=K7M2PQ9X", f"target={t}&code=K7M2PQ9X&provider=demo", "#code=K7M2PQ9X", "#",
             f"#target={t}&code=K7M2PQ9X&target={t}",
             f"#target={t}&code=K7M2PQ9X&return=exampleapp%3A%2F%2Fprofile"]
    cases += [{"rule": "parse_pair_fragment", "input": f, "expected": deeplinks.parse_pair_fragment(f)} for f in frags]
    prefixes = ["https://app.example.org/", "exampleapp://", "https://app.example.net"]
    for u in ["https://app.example.org/profile", "https://app.example.org.evil.test/", "exampleapp://synced",
              "exampleapp:synced", "https://app.example.net/x", "javascript://app.example.org/", "otherapp://x"]:
        cases.append({"rule": "return_allowed", "input": {"url": u, "prefixes": prefixes},
                      "expected": deeplinks.return_allowed(u, prefixes)})
    sync = f"glmsync://sync?target={t}"
    intents: list[tuple[Any, Any]] = [
        (sync, "open"), (sync, "manual"), (sync, None), (sync, "timer"), (sync, "backfill"), (sync, "OPEN"),
        (sync, 1), (f"glmsync://sync/?target={t}&utm=x", "open"), ("glmsync://sync", "open"),
        (f"glmsync://sync?target={t}&return=exampleapp%3A%2F%2Fsynced", "manual"),
        (f"glmsync://pair?target={t}&code=K7M2PQ9X", "manual"), ("glmsync://sync?target=ftp%3A%2F%2Fx", "open"),
        (f"glmsync://sync?target={t}&target={t}", "open"), (None, "open"), ("", "open"),
        (f"https://app.example.org/sync?target={t}", "open")]
    cases += [{"rule": "parse_sync_intent", "input": {"data": d, "reason": r},
               "expected": deeplinks.parse_sync_intent(d, r)} for d, r in intents]
    return doc("Deep links and the pairing fragment (spec/deep-links.md). parse_link / parse_pair_fragment -> "
               "{ok: true, action, target?, code?, provider?, return?} or {ok: false, error}. parse_sync_intent "
               "(the Android sync service: the intent's data and its extra glmsync.extra.REASON) -> "
               "{ok: true, target, reason} or {ok: false, error}.", cases)


def olmd_examples() -> dict[str, Any]:
    good = trackman.batch({"sessions": [{"activity": cases_trackman._act("ACT-1", "SIMULATOR"),
                                         "node": {"strokes": cases_trackman.SIM_STROKES[:1]}}]},
                          account_ref=cases_trackman.REF, generated_at=cases_trackman.AT)
    full = {**copy.deepcopy(good), "generator": {"name": "golf-launch-monitor-sync", "version": "0.1.0"},
            "sync": {"plan_id": "pl_7d1c", "reason": "timer"},
            "progress": {"more_available": True, "oldest_seen": "2025-03-01T10:00:00Z", "skipped_known": 12},
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
             bad("notice_code", "Notice codes are a closed list.", lambda b: b.update(notice={"code": "hello"}))]
    return doc("olmd/1 batches that must (valid: true) or must not validate against spec/olmd/olmd-1.schema.json.",
               cases)


FILES = {
    "trackman-olmd.json": trackman_vectors,
    "clubs.json": club_vectors,
    "values.json": value_vectors,
    "account-ref.json": account_vectors,
    "plan.json": plan_vectors,
    "guard.json": guard_vectors,
    "deep-links.json": deep_link_vectors,
    "olmd-examples.json": olmd_examples,
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
