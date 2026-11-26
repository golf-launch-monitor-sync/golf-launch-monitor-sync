<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The handicap record: dgvhcp/1 and the handicap target API

Since 1.6.0 the project carries a second kind of data besides launch monitor history: **the player's
own handicap record** as the German Golf Association (DGV) keeps it — the *Handicap History Sheet*
(every result), the *Scoring Record* (the latest 20 counting results with their Score Differential),
a tournament's scorecard hole by hole, and the player's own line of a result list. A player sees all of
it in their own account; a client reads it there with the player's own sign-in, as the launch monitor
clients do, and hands it to a target the player paired.

Since 1.15.0 the same API also carries **a professional's own pages** (world ranking and tour pages, prores/1, pairing
with `kind=pro`): [prores.md](prores.md).

Everything in [README.md](README.md) *Roles* holds: the sign-in stays in the client, a client reads
only when the target's plan says so, and never past its load guard. Since 1.10.0 a client may also
**only observe** the provider's own page ([below](#a-client-that-observes-and-clicks-for-the-player)): it
then asks the provider nothing at all, and the plan comes before sending instead of before reading.
Since 1.14.0 such a client may, on the player's tap, **click for the player** on that page (*Fetch all*):
it operates the provider's own page as the player would and still asks the provider nothing itself. Since 1.16.0 a
browser extension may start such a run **by itself** when the target's plan says the record is due, only while the
player is signed in ([below](#by-itself-when-the-record-is-due)).

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
target API the base URL speaks; without it a client takes it for the launch monitor one (the key is read
as [deep-links.md](deep-links.md) says since 1.10.0). A client that doesn't know `kind=hcp` yet pairs as
for launch monitor data, and a handicap target refuses that pairing (`provider_unknown`), so nothing
half-paired remains.

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

## A client that observes and clicks for the player

Since 1.10.0 (observing), 1.14.0 (clicking for the player, [below](#clicking-for-the-player-fetch-all)), 1.16.0 (by
itself when due, [below](#by-itself-when-the-record-is-due)). Some providers answer their own web pages only with credentials of their own web app (a
client id built into the page): a client sending that would pose as the provider's app, which the
project's rules forbid (*no disguise*, *no borrowed client id*). Such a provider is read **only by
observing**: the player opens the provider's pages in their own browser, signed in as always, and the
client reads the answers the page itself received - in the player's tab or the companion app's window.

- **No request of its own.** The client never sends anything to the provider: not a page, not a query,
  not the next page of a list. What the player didn't open - or tap *Fetch all* for, or a run by itself
  opened (below) - it doesn't read. The provider's own page asks what it asks, with its own credentials, as it does for the player.
- **Only the answers it knows**, only what it maps: the page script looks at the few answers named in
  the provider module (the record, the account's own details, a result list) and turns them into
  dgvhcp/1 **inside the page**. Names, card and member numbers and everything not mapped never leave the
  page's own context; of a result list only the player's own line is kept (by the provider's id of the
  result, which the record named).
- **Nothing by itself, except a run of *Fetch all* when due** (since 1.16.0, [below](#by-itself-when-the-record-is-due)):
  no reading in the background of a page the player has open, nothing else the player didn't tap for. The target
  can't make it read otherwise: when the record is due, the target app reminds the player (with a link to the provider's
  page; on a phone, since 1.11.0, the read link `glmsync://read?kind=hcp` that opens the companion app's window there,
  [deep-links.md](deep-links.md)).
- **The plan before sending, not before reading.** Every batch still goes through `GET /plan`, with the
  reason `manual` (the player opened the page; a run by itself asked the plan with `timer` before it started) - for the lease, `disconnected`, `account_ref` - and is
  sent only when the plan says `due`. The client may send each page as it is seen, or keep what it saw
  until the player says send.
- **Page by page.** A batch carries what one page brought (`sheet`: `history` for a page of the History
  Sheet, `scoring` for the Scoring Record, `mixed` for a result sent again with more). The same result
  arrives several times - from each list it is on, and again with the player's own place - always whole
  (its day, holes, rating, score), so the target finds it; it is one result (*Importing*, idempotent).
  The vectors show such a sequence (`page_history`, `page_scoring`, `page_own_place` in
  `dgvhcp-examples.json`).
- **`cards_to_read` doesn't apply**: the client reads no scorecard on its own. Where a provider shows the
  holes of a scorecard only as a picture, an observing client leaves `holes` out.
- **Notices**: `signed_out` when the page's own answer says the player isn't signed in (once, not on every
  page), `changed_page` when an answer it looks at no longer has the shape it knows (it then reads none of
  it). `partial` and `guard_limit` don't arise.

### Clicking for the player (*Fetch all*)

Since 1.14.0. Opening every page of a long record, then each tournament's result list for the player's
place, is many clicks; the player may hand them to the client. After they signed in on the provider's
page themselves, one tap on *Fetch all* (in the client's line on the page, or the companion app's
window) and the client does the clicks a person would, one after the other:

1. the History Sheet, then each next page of it, by the page's own pager (its link, or the same
   address that link has; the cursor is the one the page received, passed on, never built);
2. the Scoring Record, by the page's own button;
3. the result lists of the player's own tournaments of the **last two years**, **at most 100** (50 before 1.16.0), newest
   first - only club tournaments (no registered private round), only those without a place yet with
   this client, none opened in the last seven days - each by the address the provider's own pages
   use for it.

What it may and may not do:

- **It only operates the provider's page**: its links, its buttons, the addresses its own links have.
  The page's own scripts load what they load, with their own credentials; the client reads along as
  above and **still sends the provider nothing of its own** - no request, no header, no client id.
- **On the player's tap**, signed in, with the account confirmed as theirs and a target paired - or, since 1.16.0, by
  itself under the rules [below](#by-itself-when-the-record-is-due). A target can't start it in any other way.
- **A person's pace** ([hcp/clicks.json](hcp/clicks.json), normative; no option loosens it, the numbers
  move down after a measurement, never up without one): a pause of 3-6 s after each page's answer
  before the next click, at most 60 pages of the History Sheet and 100 result lists a run, three runs a
  day (the player's and those by itself together), the same list not again within seven days.
- **It stops** when the page says the player isn't signed in (`signed_out`), when another account
  shows, when a page doesn't answer as known within 30 s or the thing to click isn't there
  (`changed_page`; a result list may simply not exist - three missing in a row count as a changed page),
  when the player taps *Stop*, closes the page or leaves it. Progress is shown while it runs.
- **One send at the end**: nothing goes to the target while a run is under way; at its end (or when it
  stops) what it read goes as usual, through the plan with `manual`.

### By itself, when the record is due

Since 1.16.0 (the maintainer's decision: whether the player clicks or the client clicks for them while they are signed
in makes no difference to what is read). A browser extension may start *Fetch all* without the player's tap. The run
is the same run in every other way - the same steps, pace, limits, stops and one send at its end:

- **Only while the player is signed in.** It starts one only when golf.de's own page last said the player is signed
  in, with the account they confirmed as theirs and a target paired. It **never signs in**: it fills in no sign-in form
  and opens no sign-in page. When the page it opens says the player isn't signed in, the run stops there
  (`signed_out`, told to the target once).
- **Only when the target's plan says so.** At most every `auto_look_minutes` ([hcp/clicks.json](hcp/clicks.json)) it
  asks each target paired for the record, with the reason **`timer`** - due once a day at most
  ([When a client reads](#when-a-client-reads)); only a plan that says `due` starts a run. No reason of its own is
  needed: `timer` is the client looking by itself. A target can't start a run in any other way.
- **In a page of its own, in the background.** It opens golf.de's *Mein Bereich* in a new tab that doesn't take the
  focus, runs there, and closes that tab when the run is over - unless the player switched to it meanwhile: then the tab
  is theirs and stays open.
- **Once off track, it waits for the player.** A run by itself that stops before its end (signed out, another account,
  a changed page, the player's *Stop*, the tab closed or left) starts no other by itself until golf.de's page has shown
  the player signed in again outside a run - they opened golf.de themselves.
- **At its end** what it read goes through the plan with `manual`, as a tapped run's does (the `timer` plan has
  granted this read and may still hold its lease). When the run finished and nothing is new for a target, it still
  sends that target a batch without results (with the index), so the target's plan moves on and doesn't ask again
  within the day.
- **The player can switch it off** in the client (on by default); off, only their tap starts a run.

**A companion app, only while it is open** (since 1.17.0). Neither phone lets an app's web view work while the app is
in the back: iOS suspends the app within seconds and gives a background task or a silent wake about half a minute, a web
view's page stops with it, and even in front a web view that is not at least partly on screen may be suspended; Android
runs its background work without any view, so there is no web view to run. A run takes minutes. So a companion app:

- **Looks when it comes to the front** (and on starting), at most every `auto_look_minutes` as above, and not while its
  own golf.de window is open (there the player taps). A silent wake ([wake.md](wake.md)) or a background task never
  starts a run: they have neither the time nor a window.
- **Runs in a window the player doesn't see**, kept in the screen behind the app's own content (so the phone treats it as
  shown), on golf.de's *Mein Bereich* as the extension's tab; the run starts once that page has loaded. It **says on its
  home page that it runs**, with the run's progress and *Stop*.
- **Leaves a run of the day for the player's tap**: it starts one by itself only while at least two of `runs_per_day` are
  left, since the phone may cut its runs off.
- **The app going to the back ends the run** as when the extension's tab closes - what it read goes out once - but that
  is **not off track**: no hold, the next look may start again (the day's runs still count). Every other early stop
  (signed out, another account, a changed page, the player's *Stop*) holds the next as above. The player opening the
  app's golf.de window ends a run by itself the same way, without a hold: they are on golf.de themselves.
- The player switches it off in the app, as in the extension.

The rule is implemented once, in `@glmsync/provider-golfde` (`clicks.ts`: the run as a value, moved on by
what the page showed and by time; `operate.ts`: the step taken in the page), and used by the extension
and the companion app alike. When to start a run by itself is `@glmsync/browser`'s `HcpClient` (`autoDue`, `startFetchAll` with `auto`,
`setAutoFetch`; `interruptFetchAll` and `autoDue`'s `spare` for the companion app); the background tab is the
extension's background's, the unseen window the companion app's.
