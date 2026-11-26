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
```

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
target holds the binding **at most two minutes** and then lets go; it waits for no answer over the
binder and sees the result in its own import. To ask again it lets go first and binds anew.

**The companion app's side.**

- It treats `onBind` and `onRebind` alike (`onUnbind` answers `true`), and answers with an empty
  `Binder()`: nothing passes over it.
- It syncs only targets it is paired with, only their pairings, and as always asks their plan first
  (`GET /plan` with the reason); the load guard holds. It joins the same queue as its other runs, so a
  binding never fetches beside a sync already running.
- A binding can make it do no more than a sync link would; binding again and again costs a target a
  plan request now and then (the companion app takes one at a time per target, and not again within a
  few seconds), and the provider nothing the plan doesn't allow.
