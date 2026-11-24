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

## Connecting, step by step

`wizard.ts` (pure, tested without a browser): connecting as six steps, the same for every service, one button each -
**allow** (the app's pairing, by its address), **the service** (what to connect), **sign in**, **your account** (*Is
this your account?*), **the first data**, **done**. Each client turns its own state into `WizardFacts`
(`factsOfOffer` for the first two, before the pairing stands; `factsOfStatus` for a launch monitor, `factsOfHcp` for
golf.de, the companion app its own), `wizardOf` decides the step and `wizardLines` says it (English, German). A
connection with a client state behind it is past the first two (`paired`, `chosen` absent).

`connections.ts` (pure): the main view's list - one connection per service and account (`connectionsOfStatus`: the
signed-in account's pairings, and each pairing in test mode; `connectionOfHcp`: golf.de's record; the companion app
its own), each with its state (`connectionState`: test, not set up yet, run out, another account, last fetch failed,
loading the history, running - what needs the player first) and its row's words (`connectionLine`). The account's
name is the one *Is this your account?* showed, kept once the player said yes (`ClientStatus.player`).

- What a step shows: `stepParts` (pure) - its own content and nothing else, no part of another step, no note above or
  below it; on *Is this your account?* only the account and *Yes, that's me* / *No* (or, when it couldn't be asked,
  *Try again* / *No*). The big line *Not yet connected with … – sign in at …* is step 3's. Each client says what it
  has (`StepSituation`; a launch monitor's `statusSituation`) and draws the parts in their order.
- Before the yes: no count of any kind - no sessions, results, requests, not even the number of activities in the
  question (`whoLine`: the newest activity and where; `hcpWhoLine`: golf.de's handicap index).
- Test mode: small, under the sign-in in step 3, *Enter a test code* (`testCode`; `RenderContext.testSlot`, the overview's
  sign-in too, nowhere else). A code that is right is step 4 about the made-up account (`ClientStatus.testAsking`,
  `WizardFacts.test`), then its first data and done; a wrong one stays in step 3 with its sentence. Nothing of a test's
  connection looks at the provider's sign-in: no trouble with it, no portal, no other account, no *sign in* on the icon
  (`attention` is the test's question, then nothing). To try a test code where a provider account is signed in already,
  forget that sign-in first (*Forget the sign-in here*).
- The first data: what each target took since pairing, all syncs together (`Entry.brought`, `HcpEntry.total`), and
  how much of the older history is still to come (`Entry.left`, from olmd's `progress.sessions_left` of the last
  history chunk; core's `SyncOutcome.left`).
- Done: *Back to …* (`Actions.back`: the extension's connect window closes its tab, the popup itself) or the sentence
  that the player can go back. A launch monitor's player is done with the yes: its first data already says so
  (*Done – fetching your data …*) and offers *Back to …* (`stepParts`' `back`; not while a failed first fetch waits,
  nor golf.de's, whose results come only once its pages are opened).
- Not a setup: no app connected, or a connection that brought data before and only needs a new sign-in (the overview
  says *sign in again*). A new account to answer about is asked about in the steps. A test code fetched comes first
  (`factsOfStatus`), then the account's own connection (`factsOfAccount`, which never counts a test's pairing), then a
  pairing in test mode until its first data is through.

`render.ts` draws them (`renderConnections` the list, `offerWizard` steps 1 and 2, `renderStatus` for a launch monitor,
`hcpWizard` for golf.de, the shared `wizardFrame`): until
the first data is through they stand in place of the overview; a page that walked the steps (`WizardMemory`) shows
*done* with the overview below, one opened afterwards just the overview.

`HcpClient` sends nothing before the player's yes to the golf.de account the pages named (`confirm`), unless a target
already has that very account (`account_ref`); *No* drops what was kept of it and keeps nothing of it again.

## Texts

English and German (`messages.ts`, the browser's language picks), the same keys and placeholders
in both (a test). `view.ts` turns a state into text, `render.ts` puts the status panel on a page -
always as text, never as markup: names and messages come from targets and providers. `testEntry` is
*Enter a test code*, drawn apart from the panel so typing survives its redraws; the panel puts it under the sign-in
(`testSlot`, as the web app's key box, `signinSlot`) and keeps the field's focus and cursor across a redraw.
