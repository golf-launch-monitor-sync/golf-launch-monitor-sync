<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/browser

What the browser extension ([`apps/extension`](../../apps/extension)) and the web app
([`apps/web`](../../apps/web)) share. Built on [`@glmsync/core`](../core) and the Trackman provider.

## `HcpClient`

The handicap record read along on golf.de (spec/hcp.md, *A client that only observes*; the extension holds one). Three
`Storage`s: the **vault** (the pairings' import tokens), **storage** (what each target last answered, the results seen -
of one golf.de account - and a fingerprint of what each target has from here) and the **session** (which account the
pages named; gone when the browser closes).

| Method | What it does |
| --- | --- |
| `offerPairing({target, code})` | `POST /pair` of a handicap target (`kind=hcp`), for `golfde`. |
| `see(page, seen)` | What golf.de's page showed (`@glmsync/provider-golfde`'s `Seen`). Results go to the account their page named, else to the one the session's pages last named (unless golf.de said since that nobody is signed in), else they wait for their page to name it. Another account's record drops what was kept of the one before. |
| `send()` | Per target: nothing new, nothing asked; else its plan (`manual`), then what it doesn't have yet, cut to its limits, the index with the first batch; a notice (`signed_out`, `changed_page`) once. A revoked token or an ended connection forgets the pairing and says so. |
| `view()` | What the popup and the line on golf.de show (`lineOf`, `hcpLastText` in `hcpView.ts`). |

## `BrowserClient`

One object per client that keeps everything in two `Storage`s: the **vault** (import tokens and the
provider key; the extension's own storage, the page's `localStorage`) and **storage** (the guard's
counts and log, what each target last answered, the accounts the player confirmed). Every method
runs one at a time.

| Method | What it does |
| --- | --- |
| `offerPairing({target, code})` | `POST /pair`. The same target again replaces the pairing and ends the old token there. |
| `setKey(token)` | A key from the portal or pasted. The same key again does nothing (the portal hands it over on every page). A new account: **"Is this you?"** (`who`, one request through the guard) before anything is synced. |
| `confirm(yes)` | Yes: syncs may run. No: the key is dropped, and keys of that account are refused until `forgetRejected()`. |
| `run(reason)` | Each target's plan first; a sync only where it says so (`sync` of core). |
| `toFile(reason, write)` | A sync into a file (`manual`: what is new; `backfill`: the next history chunk). |
| `status()` | Everything a page shows, and what the icon should say (`attention`). |
| `fetchTest(code, id?)` | Test mode ([spec/test-mode.md](../../spec/test-mode.md)): a test code (or the test link) for a pairing; the scenario from that target, "Is this your account?" played back through the guard. Nothing synced before the yes. |
| `confirmTest(yes)` | Yes: that pairing syncs from the scenario (`replay`, the real Trackman code) until `endTest`, the pairing ends or `valid_until`. |
| `endTest(id)` | The scenario leaves this browser; the pairing stays. |

No question is asked when a target already has this account connected (its `account_ref` matches);
a key of another account than the one a target has is never used for it.

### Test mode

A pairing in test mode syncs from its scenario: `sync` with `replay(scenario)` and its made-up sign-in - the plan
first, the guard under the scenario's `subject` (a fresh guard per code), the history in chunks - every batch
`test: true`. It needs no Trackman key and doesn't count for the icon's *sign in*; the key and the other pairings go on
as before. The scenario lies in `blobs` (`IdbBlobs`: IndexedDB of the extension or of the web app's address), what the
card shows in storage (`Tests` of the Trackman provider, shared with the companion app). Each way a test code can fail
is a `TestError` with its sentence in English and German.

### When a key runs out

- **Known from the key** (`exp` past): nothing is asked of Trackman. A target is told once - an
  empty batch with `notice: auth_expired` when its plan is due - so the app shows "sign in again"
  too.
- **Trackman refuses it** (401 during a sync): the batch says so already. What is kept of the key is
  its claims without the signature (so it opens nothing) and a fingerprint, so the same key handed
  over by the portal again isn't tried again.

### When a target ends it

`disconnected` in a plan: the pairing goes, and with it the provider key unless another target still
needs it. A token the target no longer knows (401): the pairing goes, the key stays. Either way the
player is told once (`ended`).

### The older history

Asked for (`backfill`) only while a target's plan says `history.done: false`, and only when its next
chunk may go: the target's `wait_s`, a minute after a chunk that brought something, the guard's
`until` after it held. `nextBackfill()` says when; the extension sets an alarm for it.

## Texts

English and German (`messages.ts`, the browser's language picks), the same keys and placeholders
in both (a test). `view.ts` turns a state into text, `render.ts` puts the status panel on a page -
always as text, never as markup: names and messages come from targets and providers. `testEntry` is
*Enter a test code*, drawn apart from the panel so typing survives its redraws.
