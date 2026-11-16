<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The load guard

Every client of this project fetches through a guard in `packages/core` that **no plan, setting or
target can switch off**. It exists so that the load on a provider never goes beyond what a person
causes by looking through their own sessions in the provider's web portal — even if a target's plan
is wrong, or a target is hostile.

Limits: [`guard/limits.json`](guard/limits.json) (normative). Reference:
[`reference/guard.py`](reference/guard.py). Vectors: [`testvectors/guard.json`](testvectors/guard.json).

## Rules

Counted **per provider account**, for **every request** to the provider (a failed one too), and
**kept across restarts**:

| Limit | Value |
| --- | --- |
| Requests at a time | 1 |
| Pause before a request | at least 1 s after the last one ended; the client adds a random 1–3 s (× the plan's `pace`) |
| Per sync run | 40 |
| Per hour | 60, over the **last 60 minutes** (rolling) |
| Per day | 300, over the **last 24 hours** (rolling), the history included |
| After `429`, a `5xx` or no answer | wait 60 s, doubled for each one in a row, at most an hour; a good answer starts again at 60 s |
| `Retry-After` | always honoured when it asks for longer than the backoff — even past the hour |

A regular sync with nothing new costs a provider two requests; one with new sessions one more per
session. The daily limit spreads a long history over days instead of one night — as a person
paging back would.

## When a limit is reached

The guard answers a check with `{ok: false, reasons, until}`: the client fetches nothing until
`until` (or the next run, for `per_run`), says so in its own UI ("enough asked of the provider
today; it goes on tomorrow"), and tells the target in the batch's `notice` (`guard_limit`, with
`until`). It never queues requests to fire later in a burst.

## Visible and accountable

The client shows the counts ("today 14 of 300 requests") and keeps a log of the last 14 days —
time, kind of request, status, duration; **no content** — that the player can export. Should a
provider ever ask how much load came from this project, there is an answer.

## The numbers

They are a starting point. They are meant to stay below what the provider's own web portal asks when
a person pages through their activities and opens a session; they move down if a measurement says
so, and never up without one.
