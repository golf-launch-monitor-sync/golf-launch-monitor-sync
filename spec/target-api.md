<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The target API

A **target** is an app that receives launch monitor data from this project's clients. It implements
six endpoints, described machine-readably in [`api/target-api.yaml`](api/target-api.yaml) (OpenAPI
3.1). The base URL is the target's own, conventionally ending in `/lm/v1`; the paths are relative to
it.

| Endpoint | What for |
| --- | --- |
| `POST /pair` | Exchange a pairing code (ten minutes, once) for an import token. |
| `GET /plan?provider=&reason=` | **Whether to fetch now**, and what: due or not, since when, what the target has, the lease. |
| `POST /import` | An olmd/1 batch. |
| `GET /known?provider=&since=` | The external ids the target has, so they aren't fetched twice. |
| `GET /status` | "Connected with …", for the client to show. |
| `DELETE /token` | The client disconnects itself. |

## Who holds what

- The **player's provider sign-in stays in the client** (extension, companion app). It never reaches
  a target, and no endpoint here takes one.
- The **import token** is the target's: one per player, provider and client, kept by the target only
  as a hash, shown in the target app with when it was last used, revocable there at any time. It can
  only write batches and read its own list of external ids — no shots, no rounds, no profile. The
  client keeps it like a password.
- `account_salt` (from pairing) makes `account_ref` ([olmd.md](olmd.md)). The target connects one
  provider account per player; a batch of another one is refused (`409 other_account`) until the
  player disconnects in the target app. `account_ref` in the pairing answer and in the plan lets the
  client refuse another account before it asks the provider anything.

## The target plans, the client fetches

A client never fetches from the provider on its own initiative. On every occasion — the player
opened the target app, a timer, *fetch now*, the next history chunk — it asks `GET /plan` first, a
request to the target, not to the provider, and fetches only when the plan says `due: true`. The
reference planning rules ([planning.md](planning.md)) are what a target keeps at least as gently:
a regular sync 38–52 minutes after the last one, ten minutes after the app was opened, the older
history in chunks with pauses.

A due plan carries a **lease** (`plan_id`, `lease_until`, five minutes) for its kind: while one
client of the player fetches a regular sync, another asking for one gets `busy: true`; a history
chunk and a regular sync don't hold each other up, and *fetch now* is never busy. The import that
echoes the plan's id in `sync.plan_id` releases the lease; a client that gives up simply lets it run
out.

Independently of any plan, the client's **load guard** ([guard.md](guard.md)) caps what it asks of a
provider: a faulty or hostile target can't make it hammer anyone.

## The client's sign-in

Since 1.5.0 a client says where its provider sign-in stands, so the target app can show the player the
next step on that device ("not signed in yet – open the extension", "waiting for *Is this your
account?*", "signed in"): the query parameter `signin` on `GET /plan`, and on `GET /status` for a client
that won't ask for a plan because it has no sign-in it could fetch with (a status takes no lease, so it
never keeps another device of the player from fetching).

| `signin` | The client … |
| --- | --- |
| `none` | isn't signed in to the provider on this device yet |
| `confirm` | is signed in, but the player hasn't answered *Is this your account?* yet |
| `ready` | is signed in and confirmed: it can fetch |
| `expired` | had a sign-in that ran out, or the provider refused it |
| `other` | is signed in with another provider account than the one the target has connected |

- The client sends it with every plan and, while it can't fetch, with a status now and then (at its
  regular look, and when its sign-in changed). A target keeps the latest per import token, i.e. per
  client, with when it heard it.
- It is informative: it changes no plan, and a target never fetches, waits or refuses because of it.
  It says nothing about who the player is (`account_ref` does that).
- Read strictly: exactly one value, one of the five ([`reference/bridge.py`](reference/bridge.py),
  vectors in [`testvectors/signin.json`](testvectors/signin.json)); anything else is no answer. A client
  older than 1.5.0 sends none.

## Fetch now from the target's page

A target app running in a browser where the extension is paired with it can ask the extension to fetch
now, without a switch to another page or app: [page-bridge.md](page-bridge.md).

## Importing

- `POST /import` takes one batch, at most the `limits` handed out at pairing (bytes, sessions,
  shots, rounds, round shots); a client splits a fetch to stay within them. Too large: `413`.
- Idempotent per (`provider`, `account_ref`, `external_id`). A round may come again with only its id
  and `shots`.
- A target stores what it can and says what it couldn't (`not_stored`); one bad value costs that
  value, not the batch. A batch the schema refuses as a whole is `422 invalid_batch`.
- `notice` and `progress` are for the target to show ("sign in to the provider again", "history back
  to March 2025", and since 1.7.0 "about 140 sessions still to come, back to March 2023": [olmd.md](olmd.md#progress)).

## Errors and limits

Errors are `{"error": {"code", "message"}}` with the codes in the OpenAPI file. A target limits
requests per token and minute; `429` carries `Retry-After`, which a client honours. CORS: a target
that wants the browser extension or the web app as clients allows their origins for these paths
(and only these).

## Reasons

| `reason` | When a client sends it |
| --- | --- |
| `connect` | Right after pairing, or after the player signed in to the provider again. |
| `open` | The target app was opened, or came back to the front after a while away. |
| `timer` | The client's regular look (every few minutes while it runs). |
| `manual` | The player asked for it (*fetch now*). |
| `backfill` | The next chunk of the older history. |
