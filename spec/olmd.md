<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Open Launch Monitor Data, version 1 (`olmd/1`)

An open format for launch monitor **history**: practice sessions with their shots, and simulator
rounds with their holes and shots. Live formats for single shots exist (GSPro Open Connect, the
Flight Relay Protocol); nothing covered the history. The shot fields lean on those two so they look
familiar. The format carries no project name on purpose: anyone may produce or read it.

Machine-readable: [`olmd/olmd-1.schema.json`](olmd/olmd-1.schema.json) (JSON Schema 2020-12).
Examples that must and must not validate: [`testvectors/olmd-examples.json`](testvectors/olmd-examples.json).

## Ground rules

- **JSON**, UTF-8. One document is one **batch**.
- **Units are SI**: metres, metres per second, degrees, revolutions per minute, seconds. There are no
  yards, no mph, no feet — a reader never guesses a unit.
- **Times** are RFC 3339 with a zone (`2026-11-10T17:06:12Z`, `…+01:00`). A provider that sends a
  time without a zone means UTC; the producer adds `Z`. Anything else is not a time and is left out.
- **Unknown values are left out**, never `null`, and a group with nothing in it (`ball`, `flight` …)
  is left out too. Readers must accept any optional field being absent.
- **Values are passed on as measured.** A producer doesn't round measured values; it rounds only what
  it works out itself (the distances to the flag in a round, to the centimetre). Readers round for
  their own storage.
- **Signs**: right of the target line is positive (side, curve, path, face angle, spin axis — a
  positive spin axis curves the ball right), whatever the player's hand.
- **`extra`** (on the batch, a session, a shot, a round, a round's shot) keeps what has no field yet.
  It is data: read, never executed. Anything else not in the schema is invalid.
- **Idempotent**: a session or round is identified by (`provider`, `account_ref`, `external_id`). A
  reader stores it once, however often it comes.

## The batch

| Field | | |
| --- | --- | --- |
| `format` | required | `"olmd/1"` |
| `provider` | required | Where the data comes from: a lower-case id (`trackman`, `demo`, …). |
| `account_ref` | required | Which provider account, without naming it (below). |
| `generated_at` | required | When the batch was made. |
| `sessions` | required | Practice sessions (may be empty). |
| `rounds` | required | Rounds (may be empty). |
| `generator` | | `{name, version}` of the producing tool. |
| `sync` | | The plan this batch answers: `{plan_id, reason}` ([target API](target-api.md)). Absent in a file export. |
| `failed` | | Sessions the provider couldn't send this time: `[{external_id, started_at}]`; a later sync asks again. |
| `progress` | | How far through the provider's history: `{more_available, oldest_seen, skipped_known, sessions_left, oldest_listed}` (below). |
| `test` | | Since 1.8.0: `true` when the batch was made from a target's test scenario, not fetched from the provider ([test-mode.md](test-mode.md)). A target takes it only for a test account; absent otherwise. |
| `notice` | | Something the player should know: `{code, message, until}`, codes `auth_expired` (sign in to the provider again), `guard_limit` (the [load guard](guard.md) stopped for now), `provider_unavailable`, `provider_blocked`, `partial`. |
| `extra` | | See above. |

### `progress`

- `more_available`: the provider holds more than this fetch brought (the rest comes with a later one).
- `oldest_seen`: the oldest activity this fetch got to (fetched, or skipped as known): how far back the history is in.
- `skipped_known`: activities left out because the target named them as known.
- `sessions_left` (since 1.7.0): of the sessions the provider listed for this fetch's window (from the plan's
  `since`), how many the target neither has nor gave up and this batch didn't carry (one in `failed` counts: a later
  sync asks for it again). For a history chunk (`backfill`,
  the whole history) that is how many sessions are still to come; for a regular sync only those of its window.
- `oldest_listed` (since 1.7.0): the oldest activity, session or round, the provider listed for that window. For a
  history chunk, the oldest activity in the account: how far back the history will reach.

A producer leaves out what it can't tell; a target shows it as it likes ("about 140 sessions still to come, back to
March 2023") and reads a batch without these fields as before.

### `account_ref`

base64url, unpadded, of SHA-256 over the UTF-8 string

```
"olmd-account-v1|" + salt + "|" + provider + "|" + subject
```

`subject` is the provider's stable id of the account (for Trackman the sign-in token's `sub`) —
never an e-mail address or a name. `salt` is the `account_salt` the target hands out at pairing,
fixed per player and target, so every client of the player computes the same reference; a file
export without a target uses a random salt the client keeps. Two accounts tell apart, nothing
identifies one, and one account looks different to different targets. Vectors:
[`testvectors/account-ref.json`](testvectors/account-ref.json).

## A session

| Field | | |
| --- | --- | --- |
| `external_id` | required | The provider's id, unique per provider account. |
| `kind` | required | `range`, `simulator`, `shot_analysis`, `map_my_bag`, `combine`, `find_my_distance`, `virtual_range`, `course_practice` or `other`. |
| `kind_raw` | | The provider's own name for the kind. |
| `started_at` | | Start of the session. |
| `location` | | `{name, facility}`: the place as the provider names it. |
| `device` | | `{maker, model}`, e.g. `{"maker": "trackman"}`. |
| `shots` | required | The shots, in the provider's order (may be empty). |

## A shot

All fields optional; a producer leaves out shots without any ball flight (a putt, a misread).
A shot without `played_at` belongs to its session's start.

| Group | Fields |
| --- | --- |
| — | `played_at`, `club` (canonical code, below), `club_raw` (the provider's name) |
| `ball` | `speed_mps`, `launch_angle_deg` (vertical), `launch_direction_deg` (horizontal), `spin_rpm` (total spin), `spin_axis_deg` |
| `club_delivery` | `speed_mps`, `attack_angle_deg`, `path_deg`, `face_angle_deg`, `face_to_path_deg`, `dynamic_loft_deg`, `smash_factor` |
| `flight` | `carry_m`, `total_m`, `side_m` (at carry), `total_side_m` (at rest), `curve_m`, `apex_m`, `landing_angle_deg`, `flight_time_s` |
| `target` | `distance_m` |

A reader that keeps one side value takes `side_m` and falls back to `total_side_m`.

### Clubs

`club` is a canonical code where one fits: `Dr`, `2W`…`9W` (woods), `2H`…`9H` (hybrids), `1i`…`9i`,
`PW`, `GW`, `SW`, `LW`, a wedge by its loft (`50°`…`60°`), `Putter`. A name no rule reads is kept as
the player set it (`Chipper`); no club set means no `club` at all. A utility or driving iron is the
iron of its number (`4U`, `3 DI` → `4i`, `3i`), a fairway wood a wood (`3 FW` → `3W`), a wedge named
with its loft the loft (`SW 56` → `56°`); `AW` and `UW` are `GW`, and a maker's or player's own name
(`TSR3`) stays as it came: which club it means is the target's question, with `club_raw` beside it.
The rules, with the names other monitors and people use: [`reference/clubs.py`](reference/clubs.py),
vectors in [`testvectors/clubs.json`](testvectors/clubs.json).

## A round

| Field | | |
| --- | --- | --- |
| `external_id` | required | The provider's id. |
| `kind` | | `simulator` or `course`. |
| `played_at`, `course.name`, `tee.name` | | |
| `holes_played`, `par`, `gross_score`, `to_par` | | Whole numbers. |
| `stats` | | `putts`, `greens_in_regulation`, `fairways_hit`, `fairways_left`, `fairways_right`, `drive_average_m`. |
| `holes` | | `[{number, par, score, putts, gir}]`. |
| `shots` | | Each shot of the round (below). **Absent**: not fetched (yet). **Empty**: the provider has none. |

A round may come again with only its `external_id` and `shots`, when the shots are fetched after
the scorecard was sent: a reader adds them to the round it has.

### A round's shot

`hole` (1–36) and `number` (1–30) required; `club`, `club_raw`, `lie_before`, `lie_after`,
`result`, `penalty_strokes` (0–5; strokes the provider adds for putts it plays itself, a gimme or a
pick-up are not penalties), and the distances **worked out by the provider** so a reader needs no
provider-specific geometry:

- `to_pin_before_m`, `to_pin_after_m`: metres from the flag before and after the shot;
- `rest_side_m`, `rest_long_m`: where it came to rest against the line from where it was played to
  the flag — right (+) or left (−) of it, past (+) or short (−) of the flag;
- `target_m`, `carry_m`, `total_m`.

Since 1.4.0 a round's shot may also carry the groups `ball`, `club_delivery` and `flight` of a
practice shot, with the same fields; its carry and total stay `carry_m` and `total_m` (a producer
doesn't repeat them in `flight`). A round says **`shots_measured: true`** when its shots were asked
for with these values: a shot without them then has none at the provider (a putt, a pick-up). Without
`shots_measured` they weren't asked for (an older producer, or the provider refused the question), and
a reader that wants them may ask for the round again.

How the Trackman provider works them out (from the course's x/z points, with the fallbacks when
points are missing): [`reference/trackman.py`](reference/trackman.py), vectors in
[`testvectors/trackman-olmd.json`](testvectors/trackman-olmd.json).

## Versions

Within `olmd/1` the schema only grows: new optional fields, new enum values for `kind` and
`notice.code`. The schema is strict so that it catches a producer's typos; a **reader** doesn't
reject a batch for a field or value it doesn't know yet — it checks the fields it reads and treats
an unknown kind as `other`. A change that would break a reader is `olmd/2`. The spec's own version
(`spec/VERSION`, semantic versioning) moves with every change to a schema, a rule or a vector.
