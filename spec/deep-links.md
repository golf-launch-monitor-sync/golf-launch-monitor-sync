<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Deep links and the pairing page

How a target app hands a pairing code to a client, and how it asks the companion app to fetch now -
with a visible switch by link, or on Android without one, by binding to the companion app's sync
service ([Android](#android)).
The scheme is open: any app may implement the receiving side. Reference:
[`reference/deeplinks.py`](reference/deeplinks.py); vectors:
[`testvectors/deep-links.json`](testvectors/deep-links.json).

## Links

```
glmsync://pair?target=<target base URL>&code=<pairing code>[&provider=<id>[,<id>…]][&kind=hcp|pro][&return=<URL to go back to>]
glmsync://sync?[target=<target base URL>&]return=<URL to go back to>
glmsync://test?[target=<target base URL>&]code=<test code>
glmsync://read?kind=hcp|pro
https://<web app>/pair#target=<target base URL>&code=<pairing code>[&provider=<id>[,<id>…]][&kind=hcp|pro]
https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/pair#<the keys of a pair link>
https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/sync#<the keys of a sync link>
```

The last two (since 1.22.0) are the [universal links](#universal-links): the same pair and sync links as an `https`
address, which opens the companion app where it is installed and a page with the way to install it where it isn't.

- **pair** opens the companion app (on a phone) with what it needs to call `POST /pair`. On a
  computer the target opens the web app's pairing page instead; the code travels in the
  **fragment** (after `#`), which a browser sends to no server — the extension picks it up from the
  page. Since 1.2.0 a pair link may carry `return`: once `POST /pair` succeeded (and, if the player
  still has to sign in at the provider, once they did), the companion app jumps there - by the same
  rule as a sync ([below](#where-a-sync-may-jump-back-to)), against the `return_prefixes` the target
  has just named. Not before: until the pairing stands, nothing says the address is the target's own.
  The fragment of the pairing page takes no `return` (the page stays where it is); a client older than
  1.2.0 ignores it, so a target says where to go back to in its own words as well. Since 1.18.0 the same holds for
  `kind=hcp` and `kind=pro`: their `POST /pair` names `return_prefixes` too ([hcp.md](hcp.md)), so a handicap or a pro
  pairing jumps back like a launch monitor's. A client older than 1.18.0 knows no prefixes there and stays.
- **provider** (pair and the pairing page): which provider the pairing is for. Without it, a `kind=lm` link means any
  launch monitor the client can connect; a target that takes only some names them - one id, or since 1.18.0 several
  separated by commas (`provider=trackman,other`, at most ten, none twice). The client offers those of them it can
  connect, and sends the one the player chose in `POST /pair`. A client older than 1.18.0 reads a list as invalid
  (`invalid:provider`), so a target that takes only one names just that one. For `kind=hcp` and `kind=pro` the provider
  is fixed (`golfde`, `pro`).
- **kind** (since 1.10.0, pair and the pairing page): which target API the base URL speaks - `lm` (the launch
  monitor one, [target-api.md](target-api.md); also what a link without `kind` means) or `hcp` (the handicap
  one, [hcp.md](hcp.md)), and since 1.15.0 `pro`: the handicap one for a professional's own pages
  ([prores.md](prores.md)). A client older than 1.10.0 ignores the key and pairs for launch monitor data, which a
  handicap target refuses (`provider_unknown`), so nothing half-paired remains; one of 1.10.0 to 1.14.0 refuses `pro`
  (`invalid:kind`).
- **sync** asks the companion app to fetch now (it still asks the target's plan first) and then to
  jump back to `return`. `target` picks the pairing when there are several.
- **test** (since 1.8.0) hands a client the test code of a target's test account, for a target it is
  already paired with; `target` picks the pairing when there are several. It never pairs, and it has no
  `return` (a key `return` is ignored like any unknown one). What the code is for: [test-mode.md](test-mode.md).
- **read** (since 1.11.0) opens a client's way of reading along for `kind` - `hcp`, and since 1.15.0 `pro` (the
  window on the player's own world ranking and tour pages, [prores.md](prores.md)). For `hcp`: the companion app's
  window on the provider's page of the handicap record ([hcp.md](hcp.md), *A client that only observes*), where
  the player signs in and opens their record themselves. A target links it from a reminder that the record is due.
  It never pairs (without a handicap pairing the app says to pair first), sends nothing by itself and takes no
  `target` or `return` (one window reads for every handicap pairing, so no one target's prefixes could vouch for the
  address); such keys are ignored like any unknown one.

## The focus of a link

Since 1.18.0. A player who comes from an app for one thing should see only that thing. So a link (and the pairing page)
opens the client **in the focus of its kind**, from its first step to *Done*:

- `kind=lm`: only launch monitors - of those the client can connect, the ones `provider` names (all without it). One:
  one button *Connect launch monitor*; several: one button each, by name. `kind=hcp`: only the handicap record;
  `kind=pro`: only a professional's pages. Never *Connect new*, never the list of connections, never a card or a notice
  of another kind or another connection (that waits until the player opens the client themselves).
- After *Done* the focus stays: *Back to <app>* is the one button. On a phone it jumps to `return` (by the rule
  [below](#where-a-sync-may-jump-back-to)); on a computer it closes the client's window or tab, and the target's own page,
  still open, looks again by itself. Where there is no way back - the link named none, its address isn't among the
  target's prefixes, or the phone ended the client meanwhile - the client shows the card of this one connection, not
  the list. The list comes only when the player opens the client themselves.
- A read link and a sync link likewise: only the window or the card of their kind.

The focus is the client's matter alone: nothing of it goes to a target, and a target needs nothing new for it beyond
`return` and its `return_prefixes`.

## Reading a link

A link comes from outside and is read strictly; anything unexpected makes it invalid:

- exactly `glmsync://pair`, `glmsync://sync`, `glmsync://test` or `glmsync://read` (an optional `/` before `?`), no
  fragment;
- `key=value` pairs separated by `&`, percent- and `+`-decoded as UTF-8. A `%` that starts no valid
  escape, or bytes that aren't UTF-8, make the link invalid. A known key twice, or empty: invalid.
  Unknown keys are ignored (a later version may add some);
- `target`: `https://host[:port][/path]`, or `http://` only to `localhost`, `127.0.0.1` or `[::1]`
  (development); no user info, no query, no fragment;
- `code` (pair, test): 6–64 of `0-9 A-Z a-z -`;
- `provider`: a lower-case id (`^[a-z][a-z0-9_-]{1,39}$`), or (1.18.0) up to ten of them separated by `,` (a `,`
  encoded as `%2C` reads the same), none twice and none empty; the parsed link keeps the string as given
  (`providers_of` splits it);
- `kind`: `lm`, `hcp` or (1.15.0) `pro`, nothing else (`HCP` or a kind of a later version is invalid: pairing with an
  API the client doesn't speak would only be refused); in a read link required, and only `hcp` or `pro`;
- `return` (sync, and pair since 1.2.0, of every kind since 1.18.0): an absolute URL — `https://host/…`, `http://` to this machine, or an app's own scheme
  written `scheme://…`; never `javascript:`, `data:`, `file:`, `vbscript:`, `about:`, `blob:` or
  `glmsync:`. At most 2048 characters for every link.

## Where a sync may jump back to

The same holds for a pair link's `return`. Only to a URL that starts with one of the `return_prefixes` the target named at pairing
(`POST /pair`). A prefix ends with `/` or `://`, so that `https://app.example` can't be stretched to
`https://app.example.evil.test`. Otherwise the companion app stays where it is.

## The result in the way back

Since 1.22.0. A sync link's jump back tells the target what the sync came to, so the target app can say it at once,
without waiting for its next look: the client adds **`result`** to the query of `return` (before a fragment; a
`result` the address had already is dropped), by [`with_result`](reference/deeplinks.py):

| `result` | The sync … |
| --- | --- |
| `new` | handed new data over |
| `nothing` | ran and found nothing new |
| `not_due` | wasn't due by the plan, or the guard or the provider's pause held it back |
| `signin` | couldn't run: the provider sign-in isn't ready on this device |
| `outdated` | couldn't run: the target needs a newer client (the plan's `outdated`) |
| `failed` | failed (the target or the provider couldn't be reached, an error) |

`exampleapp://synced` comes back as `exampleapp://synced?result=new`,
`https://app.example.org/profile?tab=lm#card` as `https://app.example.org/profile?tab=lm&result=new#card`. Only where
the jump goes anyway (`return` among the target's `return_prefixes`, checked before the result is added); when the
result would make the address longer than a link may be, the client jumps back without it. A target reads it strictly
([`read_result`](reference/deeplinks.py)): exactly one `result`, one of the six; anything else is none. It is a
hint for the moment: what was stored, the target knows from its own import. A pair link's `return` takes no result.
A client older than 1.22.0 jumps back without one.

## Universal links

Since 1.22.0. A `glmsync://` link nothing on the phone takes goes nowhere, and any app may claim the scheme. The same
pair and sync links therefore also have an `https` form of this project:

```
https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/pair#target=…&code=…[&provider=…][&kind=…][&return=…]
https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/sync#[target=…&]return=…
```

- **Where the companion app is installed**, the phone opens it with the address (iOS Universal Links, Android App
  Links): the host vouches for the app in `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`
  at its root, and no other app can take the address. The companion app reads it like the `glmsync://` link.
- **Where it isn't**, the browser opens the host's page, which shows the way to install the companion app (and, for a
  pair link on a computer, forwards to the pairing page). The keys are in the **fragment**, which no server sees -
  the pairing code included; the page reads it in the browser only.
- **Reading** ([`parse_universal`](reference/deeplinks.py)): exactly this host and path, `pair` or `sync`, an
  optional `/`, no query (it would reach the host's server); the fragment is read as the `glmsync://` link's query,
  with the same rules and the same answers. `test` and `read` have no universal form. A target makes one from the
  `glmsync://` link ([`universal_link`](reference/deeplinks.py)): its query becomes the fragment.
- A target may use either form; the universal one is the better one for a phone. A companion app older than its
  first build with the host's address (and an Android phone that couldn't verify the host) opens the page instead,
  whose button opens the `glmsync://` link.
- A fork that publishes its own companion app has its own host and files; the format stays.

## What a link never carries

No provider sign-in, no import token, nothing about the player. A pairing code is good for ten
minutes and once; whoever reads it first pairs, so a target shows it only to the signed-in player. A test
code is good only with the import token of the test account it was made for.

## Android

On Android a target app can ask the companion app to fetch **without a visible switch**: it binds to
the companion app's sync service while the target app is in front. A service that a foreground app is
bound to counts as foreground, so the companion app may run its sync then; a plain `startService` from
another app is refused since Android 8 while the companion app is in the background. iOS has nothing
like it: there a target uses the sync link (`return` brings the player back).

**The service.** The companion app exports a service with the intent action
**`glmsync.intent.action.SYNC`**, without a permission and with a filter that names the action only.
Any companion app may implement it; the contract names no package.

**Finding it.** The target looks it up by the action alone:

```kotlin
val found = packageManager.queryIntentServices(Intent("glmsync.intent.action.SYNC"), 0)
```

Since Android 11 the target's manifest must say what it looks for:

```xml
<queries>
    <intent>
        <action android:name="glmsync.intent.action.SYNC" />
    </intent>
</queries>
```

It takes an exported service of another app from the answer and makes the intent explicit with that
component.

**The intent.**

| Part | Value |
| --- | --- |
| action | `glmsync.intent.action.SYNC` |
| component | the service found above |
| data | the sync link **without** `return`: `glmsync://sync?target=<target base URL>` |
| extra `glmsync.extra.REASON` | `open` (the target app was opened) or `manual` (the player asked to fetch now); missing: `manual` |

The companion app reads it like a link from outside (`parse_sync_intent` in
[`reference/deeplinks.py`](reference/deeplinks.py), vectors in `deep-links.json`): the data must be a
valid sync link that names its target and has no `return` (a service opens nothing); any other reason,
or none, reads as `manual` - a target can't claim one of the client's own reasons (`timer`, `connect`,
`backfill`).

**Binding.** `bindService(intent, connection, BIND_AUTO_CREATE)` while the target app is in front. The
target holds the binding **at most two minutes** and then lets go. Before 1.22.0 nothing came back over the
binder, and the target saw the result only in its own import; since 1.22.0 a companion app that says so answers
([below](#the-answer-over-the-binding)). To ask again the target lets go first and binds anew.

**The companion app's side.**

- It treats `onBind` and `onRebind` alike (`onUnbind` answers `true`). Before 1.22.0 it answered with an empty
  `Binder()`; since then, if it answers, with its `Messenger`'s binder ([below](#the-answer-over-the-binding)).
- It syncs only targets it is paired with, only their pairings, and as always asks their plan first
  (`GET /plan` with the reason); the load guard holds. It joins the same queue as its other runs, so a
  binding never fetches beside a sync already running.
- A binding can make it do no more than a sync link would; binding again and again costs a target a
  plan request now and then (the companion app takes one at a time per target, and not again within a
  few seconds), and the provider nothing the plan doesn't allow.

### The answer over the binding

Since 1.22.0. A binding the companion app can't take - Android may refuse to start its service, the provider sign-in
ran out, the target says it isn't due - looked the same to the target as one that fetched: no import. Now the
companion app **answers**, so the target app knows within seconds and can say the one step that helps.

**Which companion app answers.** One that does says so in its manifest, on the service:

```xml
<meta-data android:name="glmsync.service.ANSWERS" android:value="1" />
```

The target finds it with `queryIntentServices(intent, PackageManager.GET_META_DATA)` (`serviceInfo.metaData`). Only
then does it wait for an answer; a companion app without it is bound as before, and nothing in its silence means
anything.

**The ask.** The service's binder is a `Messenger`'s (`Messenger(handler).binder`). Right after `onServiceConnected`
the target wraps the binder it got (`Messenger(binder)`) and sends one `Message` with `what = 1` (*ask*) and `replyTo`
its own `Messenger`. Binding still starts the sync, as before; the message only asks for the answer.

**The answer.** The companion app sends `Message`s with `what = 2` (*answer*) to `replyTo`, each with a `Bundle` of
strings in `data`:

| `state` | sent | other keys |
| --- | --- | --- |
| `accepted` | at once, when it took the ask (within a second) | – |
| `started` | the plan said due: the sync runs; what it brings, the target sees in its import | – |
| `not_due` | the plan said not due | `until`: the plan's `due_at`, when it gave one |
| `busy` | another client holds the lease | `by`: its kind (`holder.kind`), `since` when known |
| `signin` | its provider sign-in isn't ready | `signin`: `none`, `confirm`, `expired` or `other` |
| `outdated` | the plan said `outdated` | – |
| `blocked` | it can't fetch now although it would | `why`: `guard` (its load guard), `provider` (the provider's pause or refusal), `system` (data saver, restricted background); `until` when known |
| `failed` | the ask came to nothing | `why`: `target` (the plan couldn't be asked), `unpaired` (no pairing with that target), `disconnected` (the player ended it), `error` |

- Every answer carries `v` = `"1"`. First `accepted`, then **exactly one** of the others, once the plan has answered.
  An ask that comes while the sync it started runs gets `accepted` and that sync's answer (again, if it was given).
  An ask the companion app drops (the same target again within a few seconds) gets `accepted` and the answer of the
  run that let it be dropped.
- The answer says what came of the plan, not of the provider: what the sync brings, the target sees in its import.
- **The target's side**: no `accepted` within **5 seconds** (`accept_s`) of the ask: the service didn't run - the
  target may say so at once, or switch to the sync link. No final answer within **60 seconds** (`answer_s`): failed.
  It reads every answer strictly ([`read_answer`](reference/ask.py), vectors in
  [`testvectors/ask.json`](testvectors/ask.json)): an unknown `state`, a missing or wrong key, another `v` is no
  answer. Unknown keys are ignored. Nothing in an answer is executed or opened.
- The plan request the binding leads to carries `cause=nudge` ([target-api.md](target-api.md), *Asking and
  answering*).
- An answer carries nothing of the player: a state, a kind of client, times, a reason.
