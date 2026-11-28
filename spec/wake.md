<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The wake

Since 1.9.0. A phone wakes a background app when it likes: Android's WorkManager about every half hour, iOS
when it decides to (a few times a day, nothing promised). A client that only syncs when woken lags behind
the target's plan, and on iOS the older history stands still while the app isn't in front.

A **wake** is a silent push from the target to the client's phone that says only "ask for the plan". The
client then does what its timer does: the plan first, the provider only where the plan says due, and
never past the load guard ([guard.md](guard.md)). A wake can't make a client fetch more than a plan
allows; at worst it costs a request to the target.

It is optional on both sides. A target that offers none answers `404` on `/wake`; a client that can't
receive pushes never registers. Everything else works as before, with the client's own timer.

## Registering

| Endpoint | What for |
| --- | --- |
| `PUT /wake` | The push address the target may wake this client at. `204`. |
| `DELETE /wake` | No more wakes for this client. `204`, also when there was none. |

Both with the import token, like every other endpoint ([target-api.md](target-api.md)). The body of `PUT`:

```json
{ "service": "expo", "address": "ExponentPushToken[a1B2c3D4e5F6g7H8i9J0kL]" }
```

- `service`: the push service the address belongs to. Today only `expo`: an Expo push token of the client
  app's own project. A target can only push to it with credentials for that project, so in practice only a
  target run by whoever publishes the client app can wake it; for any other target a registration is
  harmless and simply never used.
- The address is kept **per import token**: revoking the token (by the player, by the client, by a
  disconnect) ends the wake with it. Registering again replaces the address.
- A client registers after pairing and when its address changes, and refreshes it now and then (a target
  may forget it, e.g. when a push service calls it no longer registered). `400 bad_request` for a body
  [`read_wake`](reference/wake.py) doesn't take; `409 disconnected` after the player ended the
  connection.
- The address is no secret, but it reaches that phone: a target keeps it like the token, shows nothing of it,
  and drops it when the push service says the app is gone.

## What a wake is

A data-only push with nothing to show (on iOS `content-available`, no alert, no sound, no badge), whose
data is exactly:

```json
{ "kind": "lm_plan" }
```

Nothing of the player, no id, no name, no time: the push passes the push service and the platform's.
A client reads it with [`is_wake`](reference/wake.py) and ignores every other push.

## When a target wakes

[`should_wake`](reference/wake.py), with the vectors in [`testvectors/wake.json`](testvectors/wake.json):

- the client's last `signin` ([target-api.md](target-api.md#the-clients-sign-in)) is `ready` — a client
  that can't fetch isn't woken;
- a plan the client would follow is due (`due_at` ≤ now): the regular sync by the target's planning rules
  ([planning.md](planning.md)), or the next chunk of the older history while it isn't done;
- the last wake of that client was `gap_s` (**1200 s**, 20 minutes) ago or longer — the platforms advise two
  or three silent pushes an hour at most and throttle an app that gets more. A target can't tell a wake
  the platform dropped from one the client ignored, so the gap holds either way. One exception (since
  1.12.0, `back_at`): the first wake after the player came back to the target app
  ([planning.md](planning.md), *When the player is there*) needs only `back_gap_s` (**300 s**) - it is the
  wake the player waits for, and it comes once per return;
- no time the client reported it can't fetch before has still to come (`notice.until` of a guard limit
  or the provider's pause, [olmd.md](olmd.md));
- since 1.27.0, the client's plans don't say `mode: signin_only` ([planning.md](planning.md), *Fetching or only signing
  in*): a client that only keeps the sign-in for the target's own app is never woken for it.

A wake doesn't take the plan's lease (the plan it leads to does), and a target that has another client of
the player holding the lease of that kind waits. One push per address and run, however many tokens name
it.

## What a client does with one

- As its timer: a plan with reason `timer` for each pairing, then at most one chunk of the older history.
  A wake is no reason of its own: to the target it is the client's regular look, arriving on time. Since 1.22.0 the
  plan says it answers a wake (`cause=wake`, [target-api.md](target-api.md), *Asking and answering*), so a target can
  tell a wake that ran from one the platform never delivered.
- At most one run per wake, and not within five minutes of the last one it ran for a wake (pushes can
  come twice); while a run is going, a wake waits for it, in the same queue.
- Nothing in the push is executed or followed: it carries no address, no plan, no command.
