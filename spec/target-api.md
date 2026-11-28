<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The target API

A **target** is an app that receives launch monitor data from this project's clients. It implements
six endpoints (and, if it likes, a seventh for test scenarios and the two of the wake), described machine-readably
in [`api/target-api.yaml`](api/target-api.yaml) (OpenAPI 3.1). The base URL is the target's own,
conventionally ending in `/lm/v1`; the paths are relative to it.

| Endpoint | What for |
| --- | --- |
| `POST /pair` | Exchange a pairing code (ten minutes, once) for an import token. |
| `GET /plan?provider=&reason=&can=&cause=&version=&env=` | **Whether to fetch now**, and what: due or not, since when, what the target has, the lease. |
| `POST /import` | An olmd/1 batch. |
| `GET /known?provider=&since=` | The external ids the target has, so they aren't fetched twice. |
| `GET /status` | "Connected with …", for the client to show. |
| `DELETE /token` | The client disconnects itself. |
| `GET /test-scenario` | Optional, since 1.8.0: a test account's made-up provider answers ([test-mode.md](test-mode.md)). |
| `PUT /wake`, `DELETE /wake` | Optional, since 1.9.0: the push address a target may wake the client at when a plan is due ([wake.md](wake.md)). |

## Who holds what

- The **player's provider sign-in stays in the client** (extension, companion app). It never reaches
  a target's server, and no endpoint here takes one. The one way it leaves a client (since 1.27.0): on the phone, to the
  target's own app that asks for it with a key of its own, sealed so that only that app can read it, by the way back
  that app named at pairing ([deep-links.md](deep-links.md#signing-in-for-a-target)). That app fetches with it itself,
  with this project's engine (client kind `embedded`), and keeps it on the phone.
- The **import token** is the target's: one per player, provider and client, kept by the target only
  as a hash, shown in the target app with when it was last used, revocable there at any time. It can
  only write batches and read its own list of external ids — no shots, no rounds, no profile — and,
  since 1.8.0 and only for a test account, read that account's test scenario with its code. The
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
out. Since 1.13.0 the lease is the client's that took it: the same client asking again takes it over
(it runs one sync at a time, so its earlier one has ended), and a busy plan names its `holder` - the
kind of client and since when - so a client can say who is fetching ([planning.md](planning.md), *The
lease*). A client never asks for a plan while a sync of its own of that kind runs.

Independently of any plan, the client's **load guard** ([guard.md](guard.md)) caps what it asks of a
provider: a faulty or hostile target can't make it hammer anyone.

## What a client can (since 1.20.0)

With every plan a client names, in the query parameter `can`, the parts of a plan it can do beyond
earlier versions, comma-separated: `older_rounds` (a history chunk lists the older scorecards from
`rounds_skip`, a few pages, and says in `progress.rounds_end` where the list ended) and
`sessions_again` (it fetches the known sessions a plan names in `sessions_wanted` once more). A
target plans those parts only for a client that names them ([planning.md](planning.md), *The whole
history*), and reads the parameter strictly: only the words of the spec, anything else left out
([`read_can`](reference/plan.py), vectors in [`testvectors/plan.json`](testvectors/plan.json)). A
client before 1.20.0 sends none, and its plans stay as they were.

Every plan says where the older history stands (`history`: `done`, `from`). Since 1.21.0 it also says
`older: false` while the history isn't done but only fills gaps - nothing older than what the target
has comes ([planning.md](planning.md), *Only gaps*): a client shows the connection as running then,
not as loading the history.

## Asking and answering (since 1.22.0)

Two apps that each decide on their own when to fetch are hard to understand for a player and for whoever helps
them. Since 1.22.0 a target may **lead**: it asks its client when it wants data, and the client answers what came of
it. The planning rules don't change - the client still asks the plan first, every time, and the guard holds.

| The target asks by … | where | the answer comes |
| --- | --- | --- |
| a **nudge** over the Android binding | [deep-links.md](deep-links.md#android) | over the binding, at once ([*The answer over the binding*](deep-links.md#the-answer-over-the-binding)) |
| a **sync link** (a visible switch, `return`) | [deep-links.md](deep-links.md#links) | with the jump back: `result` in `return` ([*The result in the way back*](deep-links.md#the-result-in-the-way-back)) |
| a **wake** (a silent push) | [wake.md](wake.md) | in the plan request it leads to (`cause=wake`); iOS may not run it at all |
| the extension's **bridge** on its page | [page-bridge.md](page-bridge.md) | the bridge's own replies |

- **`cause`** on `GET /plan`: `wake`, `nudge`, `link` or `page` - the plan answers that ask of the target. The
  `reason` stays what it always was (a wake asks `timer`, a nudge the reason its binding named, a link `manual`). A
  target can now tell an ask that was answered from one that wasn't: a wake with no plan of `cause=wake` after it never
  ran. Read strictly: exactly one value, one of the four ([`read_cause`](reference/ask.py)); anything else is none, and
  a client asking on its own sends none.
- **`version`** on `GET /plan`: the client's version, as in its pairing (`client.version`). A target that needs a
  newer client of that kind answers **`outdated: true`** (and `due: false`); the client tells its player to update.
- **`next_at`** and **`due_at`** in the plan: when the client's own look should ask again, and when the target would
  next make a plan due ([planning.md](planning.md), *Who asks when*).
- Informative, like `signin`: `cause`, `version` and `env` change no plan, and a target never fetches, waits or
  refuses because of them - `outdated` aside, which a target decides from the version as it likes.

## What a client tells of its system (since 1.22.0)

Whether a phone runs a client in the background is the phone's decision, and the player rarely knows where it is set.
A client says what it knows with every plan, so the target app can name the one setting that is in the way: the query
parameter **`env`**, comma-separated `key:value` pairs.

| Key | Values | What it says |
| --- | --- | --- |
| `os` | `android`, `ios`, `other` | where the client runs |
| `background` | `available`, `restricted`, `denied` | whether the system runs the client's own background work: on iOS *Background App Refresh* for the app (`denied`: off for it, `restricted`: off for the phone or Low Power Mode); on Android `restricted` when the player restricted the app's background activity |
| `battery` | `optimized`, `exempt` | Android: whether the battery optimisation holds the app back |
| `push` | `on`, `off` | whether the client has a push address the target may wake it at ([wake.md](wake.md)) |
| `power` | `low`, `normal` | since 1.29.0: whether the phone saves power now (iOS's Low Power Mode, Android's Battery Saver), which stops background work whatever `background` says; a client that knows it reports Low Power Mode here as well as in `background` |

- A client sends what it knows, nothing it would have to guess; a browser extension sends none.
- Read strictly ([`read_env`](reference/ask.py), vectors in [`testvectors/ask.json`](testvectors/ask.json)): one value
  of at most 200 characters; a pair of an unknown key or value is left out (a later version may add some), a known key
  given twice is left out altogether.
- It says nothing about the player. A target keeps the latest per import token, like `signin`.
- Since 1.29.0 also on **`GET /status`**: a client that asks no plan (no sign-in it could fetch with, or a connection
  that only signs in) still says what its system allows. A target older than 1.29.0 ignores the parameter there.
- A client that runs inside a target's own app (the kind `embedded`) sends it like any other: the target app may know
  it already, but its server learns it this way.

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

## The wake

Since 1.9.0 a target that can push to the client's phone may wake it when a plan is due, with a silent push
that says only "ask for the plan" ([wake.md](wake.md)): the client asks with reason `timer`, as its own timer
would. Optional on both sides; a target without it answers `404` on `/wake`.

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
- A batch with `test: true` (1.8.0) was made from a test scenario: a target takes it only for one of its
  test accounts and answers `403 test_data` for any other ([test-mode.md](test-mode.md)).
- `notice` and `progress` are for the target to show ("sign in to the provider again", "history back
  to March 2025", and since 1.7.0 "about 140 sessions still to come, back to March 2023": [olmd.md](olmd.md#progress)).
- A session the plan named in `sessions_wanted` (1.20.0) comes as any session of the batch; the target adds
  its shots to the session it has if that one has none, and counts it neither as new nor as a duplicate.

## Errors and limits

Errors are `{"error": {"code", "message"}}` with the codes in the OpenAPI file. A target limits
requests per token and minute; `429` carries `Retry-After`, which a client honours. CORS: a target
that wants the browser extension or the web app as clients allows their origins for these paths
(and only these).

## Test scenarios

Since 1.8.0 a target may hand its own test accounts made-up answers of a provider, which a client plays back
to its real provider code — plan, guard and all — instead of asking the provider: [test-mode.md](test-mode.md).

## Fetching or only signing in (since 1.27.0)

A target whose own app fetches for it (this project's engine built in, client kind **`embedded`**) needs the other
clients of the player not to fetch the same account as well. Every plan may say **`mode`**: `fetch` (also when absent),
or `signin_only` - `due` is false, and the client only keeps the provider sign-in and hands it over when the target's
app asks ([planning.md](planning.md), *Fetching or only signing in*). The engine names itself `embedded` at pairing; a
target that takes such a client knows the rest from its own app (which provider account, which device). A target older
than 1.27.0 refuses the kind at pairing like any kind it doesn't know.

## Reasons

| `reason` | When a client sends it |
| --- | --- |
| `connect` | Right after pairing, or after the player signed in to the provider again. |
| `open` | The target app was opened, or came back to the front after a while away. |
| `timer` | The client's regular look (every few minutes while it runs). |
| `manual` | The player asked for it (*fetch now*). |
| `backfill` | The next chunk of the older history. |
