<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/provider-demo

A made-up player's practice sessions and simulator rounds — for tests, for trying a client out
without a launch monitor account, and for app reviews. It asks no one anything.

- **Everything comes from the date**: a session every third day at 18:00 UTC over the last two years
  (range, simulator or bag mapping, 18–41 shots across a plausible bag), and an 18-hole simulator
  round every fortnight with each shot and its distances to the flag. The same day always gives the
  same data under the same ids, so a target stores each once.
- **Counted like a real provider**: one "request" for the list, one per session, one for the rounds,
  one for their shots — through the load guard, so the counters, pauses and log behave as they will
  with a real account.
- **Keeps to the plan**: what the target has, the window, `max_sessions`, rounds and their shots.
- Its "sign-in" is any non-empty text, each another made-up account (to try a target's "one account
  per player"); the empty text is none.

Its data is labelled as such wherever it is shown (`DEMO_NOTICE`), and its sessions carry
`device: {maker: "demo"}`.
