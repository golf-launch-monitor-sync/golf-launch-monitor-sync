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
glmsync://pair?target=<target base URL>&code=<pairing code>[&provider=<id>][&kind=hcp][&return=<URL to go back to>]
glmsync://sync?[target=<target base URL>&]return=<URL to go back to>
glmsync://test?[target=<target base URL>&]code=<test code>
https://<web app>/pair#target=<target base URL>&code=<pairing code>[&provider=<id>][&kind=hcp]
```

- **pair** opens the companion app (on a phone) with what it needs to call `POST /pair`. On a
  computer the target opens the web app's pairing page instead; the code travels in the
  **fragment** (after `#`), which a browser sends to no server — the extension picks it up from the
  page. Since 1.2.0 a pair link may carry `return`: once `POST /pair` succeeded (and, if the player
  still has to sign in at the provider, once they did), the companion app jumps there - by the same
  rule as a sync ([below](#where-a-sync-may-jump-back-to)), against the `return_prefixes` the target
  has just named. Not before: until the pairing stands, nothing says the address is the target's own.
  The fragment of the pairing page takes no `return` (the page stays where it is); a client older than
  1.2.0 ignores it, so a target says where to go back to in its own words as well.
- **kind** (since 1.10.0, pair and the pairing page): which target API the base URL speaks - `lm` (the launch
  monitor one, [target-api.md](target-api.md); also what a link without `kind` means) or `hcp` (the handicap
  one, [hcp.md](hcp.md)). A client older than 1.10.0 ignores the key and pairs for launch monitor data, which a
  handicap target refuses (`provider_unknown`), so nothing half-paired remains.
- **sync** asks the companion app to fetch now (it still asks the target's plan first) and then to
  jump back to `return`. `target` picks the pairing when there are several.
- **test** (since 1.8.0) hands a client the test code of a target's test account, for a target it is
  already paired with; `target` picks the pairing when there are several. It never pairs, and it has no
  `return` (a key `return` is ignored like any unknown one). What the code is for: [test-mode.md](test-mode.md).

## Reading a link

A link comes from outside and is read strictly; anything unexpected makes it invalid:

- exactly `glmsync://pair`, `glmsync://sync` or `glmsync://test` (an optional `/` before `?`), no fragment;
- `key=value` pairs separated by `&`, percent- and `+`-decoded as UTF-8. A `%` that starts no valid
  escape, or bytes that aren't UTF-8, make the link invalid. A known key twice, or empty: invalid.
  Unknown keys are ignored (a later version may add some);
- `target`: `https://host[:port][/path]`, or `http://` only to `localhost`, `127.0.0.1` or `[::1]`
  (development); no user info, no query, no fragment;
- `code` (pair, test): 6–64 of `0-9 A-Z a-z -`;
- `provider`: a lower-case id (`^[a-z][a-z0-9_-]{1,39}$`);
- `kind`: `lm` or `hcp`, nothing else (`HCP` or a kind of a later version is invalid: pairing with an API the
  client doesn't speak would only be refused);
- `return` (sync, and pair since 1.2.0): an absolute URL — `https://host/…`, `http://` to this machine, or an app's own scheme
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
