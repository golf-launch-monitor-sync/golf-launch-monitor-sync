<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/core

The client side of Golf Launch Monitor Sync, the same for every client (browser extension, web app,
companion app): one sync from a target's plan to an imported batch, and the load guard that holds
whatever a target plans.

```ts
import { Guard, HttpTarget, pair, sync } from '@glmsync/core';
import { trackman } from '@glmsync/provider-trackman';

const pairing = await pair({ target, code, provider: 'trackman', client: { kind: 'extension', name: '…' } });
// keep `pairing` like a password (it holds the import token)
const guard = new Guard({ storage });           // chrome.storage, AsyncStorage, localStorage …
const provider = trackman();                     // one per client: it keeps a little state in memory
const outcome = await sync({ target: new HttpTarget(pairing), provider, credential: token, reason: 'timer', client: 'extension', guard });
```

## What it does, in order

1. **The plan first, every time** (`GET /plan`): a request to the target, never to the provider.
   Not due, busy (another client holds the lease) or disconnected: nothing is asked of the provider.
2. **Whose account**: `account_ref` from the target's salt and the provider account's subject; a
   plan naming another account ends the sync before the provider is asked anything.
3. **The fetch**, by the provider module, every request through the guard at the plan's pace.
   Trouble with the provider as a whole (the sign-in, the connection, the guard) ends the fetch;
   what it has so far still goes to the target, with a `notice` saying why.
4. **The batch**: checked against the schema, where one bad value costs that value, not the batch
   (`clean`), and cut to the limits the target named at pairing (`split`). `failed`, `progress`,
   `notice` and `sync` go with the last part, whose import releases the plan's lease.
5. **Handed over**. A part the target finds too large is halved; a short `Retry-After` (≤ 30 s) of
   the target is waited out once. `sync` never throws: every way it ends is an outcome to show.

## The load guard

`Guard` ([spec/guard.md](../../spec/guard.md)) counts every request to a provider per provider
account (`guardAccount(provider, subject)`, hashed), the same for every target, and keeps the counts
in a `Storage` across restarts: one at a time, 1–3 s × pace apart and never under a second, 40 a
run, 60 in any hour, 300 in any day, a growing backoff after 429/5xx/no answer, `Retry-After` always.

- **Not switchable**: the limits are `spec/guard/limits.json`, frozen; the constructor takes a storage,
  a clock and a random source, nothing that reaches a limit.
- **Fails closed**: a request it can't count (the storage fails) is not sent. Counts it can't read
  count as high: a day's pause, then afresh. A request a crash left in flight is busy for two minutes.
- **No queue**: a limit throws `GuardLimitError` with `until`; only the minimum pause (≤ 10 s) is
  waited out.
- **Accountable**: `counts(account)` for "today 14 of 300", `exportLog()` for the last 14 days —
  time, kind, status, duration, never content.

Call `guard.beginRun(account)` before anything else that asks a provider outside `sync` (e.g. a
provider's "Is this you?"), so it starts a run of its own.

## Targets

- `pair()` and `HttpTarget`: the target API with an import token. Every answer of a target is read
  field by field (`readPlan` & co.): a plan can only make a client do less. A target that takes less
  than 64 KiB a batch is not paired with (the client would fetch for nothing). Requests carry no
  cookies and no borrowed User-Agent.
- `FileTarget`: a sync into a file, planned gently — only when the player asks (`manual`), or the
  older history a chunk at a time (`backfill`) — with a `Cursor` of what was written and a random
  salt kept with it.

## For tests

`@glmsync/core/testing`: `FakeTarget` (the target API in memory) and `VirtualClock` (days in
milliseconds). Tests are offline; nothing here reaches a network.

## Also here

`values` and `clubs` (reading untrusted values and club names alike in every implementation,
checked against `values.json` and `clubs.json`), `accountRefOf` (the account reference without Web
Crypto, which a phone's engine may lack), and the error kinds (`errors.ts`).
