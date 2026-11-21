<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The handicap record: dgvhcp/1 and the handicap target API

Since 1.6.0 the project carries a second kind of data besides launch monitor history: **the player's
own handicap record** as the German Golf Association (DGV) keeps it — the *Handicap History Sheet*
(every result), the *Scoring Record* (the latest 20 counting results with their Score Differential),
a tournament's scorecard hole by hole, and the player's own line of a result list. A player sees all of
it in their own account; a client reads it there with the player's own sign-in, as the launch monitor
clients do, and hands it to a target the player paired.

Everything in [README.md](README.md) *Roles* holds: the sign-in stays in the client, a client reads
only when the target's plan says so, and never past its load guard.

| | Machine-readable |
| --- | --- |
| The format **dgvhcp/1** | [hcp/dgvhcp-1.schema.json](hcp/dgvhcp-1.schema.json) |
| The **handicap target API** | [api/hcp-api.yaml](api/hcp-api.yaml) |
| Its **rules** (when to read, the lease, which scorecards) | [hcp/rules.json](hcp/rules.json), [reference/hcp.py](reference/hcp.py) |
| Vectors | [testvectors/hcp-plan.json](testvectors/hcp-plan.json), [testvectors/dgvhcp-examples.json](testvectors/dgvhcp-examples.json) |

## The format dgvhcp/1

A batch is one JSON object (the schema is the authority):

- `format` `"dgvhcp/1"`, `provider` (where it was read, e.g. `golfde`), `account_ref` (the rule of
  [olmd.md](olmd.md), with the `account_salt` from pairing and the provider's stable id of the account,
  never a name or a card number in clear), `generated_at`, optionally `generator`, `sync` and `extra`.
- `sheet`: what was read — `history`, `scoring`, or `mixed` (both, or with scorecards).
- `index`: the Handicap Index the record names now, the day it says it for (`as_of`, the print date,
  else the day it was read), and the Low Handicap Index where there is one.
- `results`: at most 500 per batch, each a result as the record gives it, in the field names below.
  The day (`played_on`) and something that tells the holes (`holes_read`, `par` or `cr`) are required.
- `notice`: `signed_out` (the player has to sign in again), `guard_limit` (enough asked today),
  `partial` (some scorecards come with the next read), `changed_page` (the provider's pages look
  different from what the client knows: it read nothing rather than guess).

Fields of a result: `played_on`, `ref` (the provider's own id of the result, where it has one: what
`cards_have` names), `name` (the tournament), `club_name`, `club_no`, `course_no`, `country` (calling
code), `round_no`, `holes_read`, `kind` (`tournament`, `private`, `foreign`, `adjustment`),
`hcp_relevant`, `status` (`TA`, `NA`, `NRA`, `NRO`, `DQA`, `DQO`), `format` (`single`, `rpr`), `art`
(`Z`, `S`, `H`, `P`, `G`), `tee`, `par`, `cr`, `slope`, `hcp_index` (at the time of the round), `ch`,
`ph`, `gbe` (adjusted gross score), `stableford_net` (before the WHS, instead of `gbe`), `gross`, `net`,
`stableford`, `sd`, `pcc`, `exceptional`, `counting` (one of the best eight), `place` and `field` (the
player's own place and the size of their division), and `holes` (the scorecard: 9 or 18 holes, each
with `hole`, `par` and as far as shown `si`, `score`, `gbe`, `given`, `points`, `points_gross`,
`length_m`).

### What never goes into a batch

- **Another person's name.** A registered private round's "name" is its marker's (`RPR: …`, `EDS: …`):
  such a result carries `format: "rpr"` and **no `name`** (the schema refuses one). Of a result list
  only the player's own line goes in, as `place` and `field`; there is no field for anyone else.
- **Anything worked out.** Values are read as the record shows them: a Score Differential is never
  computed from the gross, rating and slope (nine-hole SDs already stand for 18), a scorecard's
  strokes received are taken as shown, not from the index.
- **A value the record doesn't give** (left out, never `null`), and the Scoring Record's `ch` of a
  nine-hole result (it is the one for 18 there): left out.

## The handicap target API

Five endpoints ([api/hcp-api.yaml](api/hcp-api.yaml)), base URL conventionally ending in `/hcp/v1`.
They mirror the launch monitor target API ([target-api.md](target-api.md)) and are kept apart from it:
a handicap import token can't call `/lm/v1`, and a launch monitor token can't call this one.

| Endpoint | What for |
| --- | --- |
| `POST /pair` | A pairing code (ten minutes, once) for an import token; `provider` names the record's source. |
| `GET /plan?reason=` | **Whether to read now**, the lease, and the `ref`s the target has a scorecard for. |
| `POST /import` | A dgvhcp/1 batch. |
| `GET /status` | "Connected with …", for the client to show. |
| `DELETE /token` | The client disconnects itself. |

### Pairing

The target app shows a code and the client's pairing page with the code in the fragment, which no
server sees: `…/pair#target=<base URL, percent-encoded>&code=<code>&kind=hcp`. `kind=hcp` says which
target API the base URL speaks; without it a client takes it for the launch monitor one. A client
that doesn't know `kind=hcp` yet pairs as for launch monitor data, and a handicap target refuses that
pairing (`provider_unknown`), so nothing half-paired remains.

### When a client reads

The target plans ([reference/hcp.py](reference/hcp.py), `is_due`): `manual` always; `connect` unless a
read ran within two minutes; `open` and `timer` once a day at most (24 hours after the last read). A
due plan takes a five-minute lease; another client of the player asking meanwhile hears `busy`
(`manual` never). The record changes a few times a month, so this is gentle by design.

A plan names the scorecards the target has (`cards_have`) and how many to read this time
(`max_cards`, 20). A client reads the History Sheet and the Scoring Record, then the scorecards of
results it saw that the target lacks, newest first, at most `max_cards` (`cards_to_read`); the rest
come with the next read (`notice: partial`).

### Importing

- Idempotent: a result is the same result whatever batch brings it again; a later batch may add its
  card or the player's place. What the player corrected by hand in the target stays.
- One batch at most the `limits` from pairing (`max_bytes`, `max_results`); too large: `413`.
- A batch of another account than the first one connected: `409 other_account` until the player
  disconnects in the target app.
- One bad result costs that result (`failed`, with `errors` naming its place and a code), not the batch.
  A batch the schema refuses as a whole is `422 invalid_batch`.

Errors are `{"error": {"code", "message"}}` with the codes of the launch monitor API; `429` carries
`Retry-After`.
