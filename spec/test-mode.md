<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Test mode: a target's test scenarios (since 1.8.0)

A target app that tests its own onboarding by hand wants data that arrives **as it would from a real
provider account** — the first chunk, then the older history in pieces over hours, at the provider's own
pace — without anyone's real account. Test mode does that: the client runs its **real provider code**
(listing, history chunks, the mapping to olmd, the plan, the load guard), but the provider's answers come
from a **scenario** the target hands out, not from the provider. Nothing in test mode asks a provider.

Everything here is optional. A client without test mode, or a target without scenarios, loses nothing.

## The flow

1. The target app prepares a **test account** of its own and shows, for it, a **test code** (with a QR code
   or the link below). Only the target knows which of its accounts are test accounts.
2. The player — a tester — signs in to the target app with that test account and **pairs** a client as
   always ([target-api.md](target-api.md), `POST /pair`).
3. In the client, instead of signing in to the provider, the tester enters the test code or opens the
   test link. The client asks the paired target for the scenario (`GET /test-scenario`, below) with the
   pairing's import token and the code.
4. The client shows *Is this your account?* with the scenario's `profile` as it would a provider's, and after
   the yes it syncs exactly as with the provider: it asks the target's plan on every occasion, fetches only
   when the plan says so, and counts every playback request through its load guard. Only the answers (and
   how long each takes, `latency`) come from the scenario.
5. Every batch the client makes from a scenario carries **`test: true`** ([olmd.md](olmd.md)).

## `GET /test-scenario`

An optional endpoint of the target API ([`api/target-api.yaml`](api/target-api.yaml)).

- `Authorization: Bearer <import token>` like every endpoint but pairing, and the code in the header
  **`X-Test-Code`** (6–64 of `0-9 A-Z a-z -`) — **never in the address**, where logs and proxies keep it.
- `200`: the scenario (below), **the same every time** for the same code: the same ids, so nothing is
  stored twice when a client asks again.
- Errors (`{"error": {"code", "message"}}`):

| Status | `code` | Meaning | The client … |
| --- | --- | --- | --- |
| 400 | `bad_request` | no code, or not a code | says the code can't be right |
| 401 | `token_invalid` | the import token isn't good (any more) | asks to pair again |
| 403 | `not_test_account` | the token's account is no test account | says test codes work only with a test account; the pairing stays good |
| 404 | `code_invalid` | no scenario for this code and account | says the code is wrong |
| 404 | `test_unavailable` (or any other 404) | the target offers no scenarios | says this app has no test mode |
| 410 | `code_expired` | the code's test is over | says the code has expired |
| 429 | `rate_limited` | too many requests | waits `Retry-After` |

A target that offers scenarios to browser clients allows the header `X-Test-Code` in its CORS answer for
this path.

## The scenario

| Field | | |
| --- | --- | --- |
| `name` | required | The scenario's name, shown beside the client's *test mode* badge. 1–100 characters, no control characters, not blank. |
| `provider` | required | Which provider the answers are of (`trackman`, …). A client refuses a provider it doesn't have. |
| `subject` | required | The made-up account's stable id (1–200 printable ASCII characters, no space). The client's `account_ref` and its load guard count under it, as under a real account's `sub`. A target gives **every code its own subject**, so every test starts with a fresh guard. |
| `profile` | required | The provider's answer about whose account it is, in the provider's own shape (for Trackman the `profile` of `me`: `fullName`, `playerName`). |
| `data` | required | The provider's answers, in the provider's own shape (an object). For `trackman`: `activities` (newest first), `nodes` (each session's node, by activity id), `scorecards` (newest first), `shotHoles` (a scorecard's holes with their shots, by scorecard id) — what `packages/provider-trackman`'s test double answers. |
| `latency` | | Response times in seconds: `default` and `queries` (by the provider's own name of the query, at most 50), each `{median_s, spread_s}`, 0–60. |
| `valid_until` | required | When the test is over: RFC 3339 with its zone. |

A client **reads it strictly** ([`reference/testmode.py`](reference/testmode.py), vectors in
[`testvectors/test-scenario.json`](testvectors/test-scenario.json)): a required field that isn't right, or a
`valid_until` already past, refuses the whole scenario; a bad response time is dropped (it only shapes the
pace); keys it doesn't know are ignored (a later version may add some). It refuses an answer of more than
**64 MiB** before reading it. `profile` and `data` are data like any provider's answer — mapped or dropped,
never executed.

## Rules

- **Synthetic, always.** A scenario is made up. A target never fills one from a real account, its own
  owner's included.
- **Only test accounts.** A target hands a scenario only to the import token of one of its test accounts,
  and only with that account's code. **A target takes a batch with `test: true` only for a test account**:
  for any other it answers `403 test_data` and stores nothing, so made-up data never reaches a real
  account, not even through a wrongly paired client.
- **Nothing changes about plan or guard.** A test client asks `GET /plan` on every occasion and keeps the
  load guard as with the provider ([guard.md](guard.md)); there is no time-lapse, no switch and no plan
  field that makes test mode faster. The pace is the guard's and the target's plan's, as in real life.
- **Visible.** A client in test mode says so wherever it shows the provider's account (*Test mode — made-up
  data*), and keeps the scenario only until the tester signs out of it, the pairing ends or `valid_until`
  has passed.
- **A code is the target's secret, like a pairing code.** A target shows it only to the signed-in tester,
  never logs it, and keeps only what it needs to check it (a hash or an HMAC).

## The test link

```
glmsync://test?[target=<target base URL>&]code=<test code>
```

Read like every link ([deep-links.md](deep-links.md)): `code` required (6–64 of `0-9 A-Z a-z -`), `target`
picks the pairing when there are several. A client takes it only for a target it is **paired** with — a test
link never pairs — and otherwise says to pair in the target app first. It carries no token and nothing to jump
back to.
