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

## When the player is there (since 1.12.0)

A client only says `open` when *it* comes to the front; the player, though, comes back to the
**target** app, and most clients can't tell (a browser extension, a phone app the system holds in the
background). A target that knows its player is there may make a regular sync due sooner - for every
reason but `backfill`, never later than the table above ([`here_due_at`](reference/plan.py), the
`here` input of `is_due`):

- **Back**: the player came back to the target app after at least `away_s` (10 minutes) away. Until a
  sync has run since then, one is due `back_gap_s` (2 minutes) after the last - as a rule at once. A
  session typically lies behind them, and they want to see it.
- **Still there**: the target app was in front within `seen_s` (10 minutes), and no sync since the
  return brought new sessions or rounds: due `stay_gap_s` (5 minutes) after the last sync - a session
  may take a moment to reach the provider.
- Both only within `back_window_s` (30 minutes) of the return. After that, and as soon as a sync since
  the return brought something, the regular rhythm again: new data won't be there again so soon.

The target keeps three times per player: `back_at` (the return), `seen_at` (in front last),
`news_at` (the last sync that brought anything). How a target app tells that it was away is its own
matter (per device, as a rule: the player may leave a computer's tab open and come back on the phone).
Over an hour in which the player opens the target app once after a session, this costs at most a
handful of syncs more than the regular rhythm; the guard holds as always.

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

## The whole history (since 1.20.0)

A player new to a target should end up with what their provider holds - every scorecard of the
history, and every session with its shots - not only the 90 days of the first sync. Two parts of the
history loader do it, planned only for a client that says it can (`can`, [`read_can`](reference/plan.py)
in [target-api.md](target-api.md#get-plan)): an older client would page the whole list of scorecards
with every chunk and never say where the list ended.

- **The older scorecards** (`older_rounds`): a history chunk's plan carries `rounds: true` and
  `rounds_skip`, how many of the newest scorecards to pass over - the target's count of rounds less
  `rounds_skip_slack` ([`rounds_skip`](reference/plan.py)): the regular syncs brought the newest,
  so no chunk pages through them again. The client lists at most `history_rounds_pages` pages of
  `history_rounds_page` from there, hands over the rounds the target lacks, and says in
  `progress.rounds_end` when the provider's list ended (or reached `since`) within them. The target
  plans the part until a chunk said so; the next chunk starts further down, since the target now
  has more. A plan with `rounds: true` and no `rounds_skip` (before 1.20.0, or a file target) means
  what it always meant: the client pages from the top, up to its usual number of new rounds.
- **Sessions asked for again** (`sessions_again`): known sessions the target holds without a single
  shot, of kinds a client may now fetch with their shots (a client before this version asked
  activity types it didn't know by the shared interface only, and got none for some), at most
  `sessions_wanted_history` a chunk, each at most `sessions_again_tries` times, newest first
  ([`sessions_wanted`](reference/plan.py)). The plan names them in `sessions_wanted`; the client
  fetches each it finds in its activity list, as it would a new one, and hands it over in the batch.
  The target adds the shots to the session it has, if it still has none, and never asks for a session
  that came back again - with shots or still without (some kinds have none: a video, a report).
  Like any session, each costs one request at a person's pace; the guard holds as always.

The history is done when its sessions, the older scorecards (for a client that can) and the sessions
asked for again are through, and the older rounds' shots as before. A connection whose history was
done before a client could do these parts opens it again the first time such a client asks.

## The lease

Five minutes per kind (a regular sync, a history chunk) and player: another client asking for a plan
of that kind meanwhile gets `busy`. The kinds don't hold each other up; `manual` is never busy (the
player waits for an answer — at worst a session is fetched twice, and stored once). An import of
that kind, or a new connect, releases the lease.

**The lease belongs to the client that took it** (since 1.13.0; [`holder`](reference/plan.py)). The
target keeps which client holds it (by its import token, as a rule) and since when:

- The **same client** asking again for a plan of that kind takes its own lease over (a new plan id,
  five minutes from now). A client runs its syncs one after the other, so its earlier one has ended
  without an import: it gave up, or its batch never arrived. Waiting for that one is waiting for
  nothing, and a client that told its player "another device is fetching" about itself would be wrong.
- **Another client** is told `busy` with the `holder`: its kind (`extension`, `web`, `companion`, …)
  and `since`, so it can say who is fetching ("the browser extension on your computer, since 11:17")
  rather than guess. Two phones are two clients of one kind.
- The import that echoes the plan id of the lease releases it; a late import of a plan whose lease was
  taken over since releases nothing (the plan holding it is still out). An import without a plan id
  releases the kind's lease, whoever holds it.

A client therefore never asks for a plan while a sync of its own of that kind runs: a second "fetch
now" joins the one under way (or waits for it) instead.

## Pace

`pace` multiplies the client's pauses between provider requests (1 = normal) and is never below
0.5; the guard's minimum pause of one second holds anyway.
