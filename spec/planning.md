<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Reference planning rules (for targets)

A target answers `GET /plan` ([target-api.md](target-api.md)). These are the rules it keeps **at
least as gently**: they make the load on a provider that of a person looking at their own sessions
now and then, not that of a script. Constants: [`plan/rules.json`](plan/rules.json); the reference:
[`reference/plan.py`](reference/plan.py); vectors: [`testvectors/plan.json`](testvectors/plan.json).
The client's [load guard](guard.md) holds regardless of what a target plans.

## When a sync is due

| Reason | Due when |
| --- | --- |
| `manual` | always |
| `backfill` | while the older history isn't done |
| any, no sync yet | always |
| `connect` | at least 2 minutes after the last sync |
| `open` | at least 10 minutes after the last sync — or as `timer` |
| `timer` | 38–52 minutes after the last sync |

The 38–52 minutes are random per sync, but the same however often a client asks: the target hashes
something fixed for this sync (the player and the time of the last sync) into `seed`, and

```
u = first 4 bytes of SHA-256(seed), big-endian, / 0xFFFFFFFF
due = last sync + (38 + 14 · u) minutes
```

So syncs never run on the beat. `open` exists for the common case of coming back from a session:
the player opens the app and expects what they just played.

## How far back

`since` = now − `days`, with `days`:

- `backfill`: the whole history (15 years);
- no sync yet: 90 days;
- else: days since the last sync + 3, at most 730;
- and at least far enough back for the sessions still waiting to be fetched again (+ 3 days).

## Sessions that failed

A session the provider couldn't send (`failed` in a batch) is tried again by later syncs, at most
three times; then it is given up until a manual sync. A manual sync tries all of them, the history
loader none of the waiting ones (`give_up` in the plan). Waiting entries are capped at 200, given-up
ones separately at 2000, the newest kept: under one shared cap, a long list of broken sessions
would push given-up ones out, and the history loader would ask for them chunk after chunk.

## The older history

In chunks of 10 sessions, 60–120 seconds apart, one activity list per load. Five chunks in a row
that brought nothing but failures end the sessions' part; five chunks in a row that moved no
round's shots on end the shots' part. A regular sync fetches at most 40 new sessions; the rest
comes with the next.

## Each shot of a round

A regular sync asks for the shots of new rounds, and of at most 5 known rounds of the last 30 days
still without theirs (`rounds_wanted`); the history loader works down the older rounds 25 at a
time, below the oldest round whose shots are in.

## The lease

Five minutes per kind (a regular sync, a history chunk) and player: another client asking for a plan
of that kind meanwhile gets `busy`. The kinds don't hold each other up; `manual` is never busy (the
player waits for an answer — at worst a session is fetched twice, and stored once). An import of
that kind, or a new connect, releases the lease.

## Pace

`pace` multiplies the client's pauses between provider requests (1 = normal) and is never below
0.5; the guard's minimum pause of one second holds anyway.
