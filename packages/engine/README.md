<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/engine

The part of Golf Stats Sync that fetches on a phone, without a screen: the pairings with targets, the player's
sign-in kept on the device, a sync per pairing when the target's plan says so, the older history chunk by chunk, the
background run, test mode. The [companion app](../../apps/companion/README.md) runs it; another app can embed it
(below). The rules of the project hold unchanged wherever it runs ([CLAUDE.md](../../CLAUDE.md) §2): the plan first,
every time; every request to the provider through the load guard, whose counts outlive restarts; the sign-in goes to
the provider only, a target gets batches and nothing else.

> **Unofficial.** Not affiliated with, endorsed by or supported by Trackman.

## What is in it

| File | |
| --- | --- |
| `engine.ts` | `makeEngine(platform)`: the parts put together from what the platform brings |
| `runner.ts` | pairing, a sync per pairing (a tap joins one under way), the history chunk by chunk, a sync into a file, "Is this you?", the guard's log |
| `signins.ts` | the provider sign-in in the secure store, with the account it was of (for a quiet renewal) and the User-Agent of the browser it was signed in with |
| `pairings.ts` | the targets: what a pairing says in storage, its import token in the secure store; ended pairings |
| `secrets.ts` | the secure store's interface, and `ChunkedSecrets` for values longer than it likes |
| `longRun.ts` | `backgroundWork`: a background task's run, chunk after chunk within its time, stopped cleanly when the platform ends it; `afterwards` for the app's own step with the time left (the companion: its over-the-air update) |
| `firstSync.ts` | the first sync after connecting, while the app stays in front |
| `power.ts` | the rules around the native module `glmsync-power` (iOS: Background App Refresh, Low Power Mode, the end of a task's time) |
| `providers.ts` | Trackman and the demo |
| `tests.ts` | test mode's refusals (the keeping is provider-trackman's) |

What the engine leaves to the app: its screens, the provider's sign-in window, the wake (a target's push to the app),
and everything read along in a window the player sees (golf.de, the tours, the rankings) - those stay with the
companion app.

## The User-Agent on a phone

Every call to the provider from a phone carries the User-Agent of the browser the player signed in with on that
device: the sign-in window reads `navigator.userAgent` with every key it hands over (a sign-in and a quiet renewal
alike), and `SignIns.set(provider, token, player, userAgent)` keeps it beside the key in the secure store. The runner
passes it to `sync` and to "Is this you?"; core's `providerContext` sets it on the provider's requests and on nothing
else (a target never gets it). Only a header value is kept (`cleanUserAgent`: printable, at most 512 characters).
Nothing else of the device or the app goes to the provider: no cookies, no `Origin`, no `Referer`
(`headers.test.ts` of provider-trackman and `engine.test.ts` check every call). A sign-in kept before this (an
older app) has none, and its calls carry none until the next sign-in or renewal.

## Embedding the engine

The engine is released as a package with nothing to install beside it, attached to a GitHub release of this
repository - no package registry:

- `glmsync-engine-<version>.tgz`: the engine with core, the spec reader and the providers bundled into one ES module
  (not minified, nothing evaluated at runtime), with its types;
- `glmsync-power-<version>.tgz`: the native module for the iPhone, an Expo module (a new native build once added);
- `SHA512SUMS` and `integrity.json` (each file's `sha512-…`).

A release `engine-v<version>` is made by itself when `version` in this package's `package.json` is raised on `main`,
once all of CI's checks of that commit are green (`.github/workflows/engine-release.yml`, built by
`tools/engine-pack.mjs`), or by hand (*Actions › Release engine*). Pin it by address and checksum:

```jsonc
// package.json of the app
"dependencies": {
  "glmsync-engine": "https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases/download/engine-v0.1.0/glmsync-engine-0.1.0.tgz",
  "glmsync-power": "https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases/download/engine-v0.1.0/glmsync-power-0.1.0.tgz"
}
```

The package manager writes the checksum into its lockfile; compare it with the release's `integrity.json` once, and
install from the lockfile only (`--frozen-lockfile`, `npm ci`) from then on.

```ts
import { backgroundWork, makeEngine, powerOf } from 'glmsync-engine';
import { GlmsyncPower } from 'glmsync-power';

const engine = makeEngine({
  secrets,          // the platform's secure store: { get, set, remove } of strings (keys [A-Za-z0-9._-])
  storage,          // ordinary storage: { get, set, remove } of strings
  fetch,            // the platform's fetch (it must let a request set its own User-Agent)
  version: '1.2.3',
  client: { kind: 'other', name: 'Golf Stats Sync engine' }, // how it names itself to its target
});
await engine.load();

// A key the player signed in with elsewhere on this device, with that sign-in window's User-Agent:
await engine.signIns.set('trackman', token, null, userAgent);

await engine.runner.syncAll('manual');       // asks each target's plan first, fetches only when it says due

// In a background task: chunk after chunk until the platform ends its time.
const power = powerOf(GlmsyncPower);
const ctrl = new AbortController();
const sub = power.onTaskExpired(() => ctrl.abort());
const run = await backgroundWork({ os: 'ios', runner: engine.runner, now: Date.now, sleep, signal: ctrl.signal });
sub?.remove();
```

Pairing works as everywhere ([spec/target-api.md](../../spec/target-api.md)): `engine.runner.pair({ target, code })`
with a code the target hands out. The keys it writes in storage keep the names the companion app gave them first
(`glmsync/companion/…`, `glmsync.signin.…`), so a phone keeps what it had; in another app's storage they meet nothing.

What an embedding app keeps to:

- The engine unchanged, its version pinned: no fetching code of the app's own toward the provider.
- The provider's token only in the platform's secure store, never on a server, in a log or a crash report.
- The load guard as it is: one engine per device and account, so its counts hold.
