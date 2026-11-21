<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Companion app

The phone client of Golf Launch Monitor Sync (Expo, iOS and Android). On a phone the only way to the
player's own launch monitor account, without an official sign-in for apps, is the maker's own web
portal in a sign-in window - so that window lives here, in a small app that does nothing else.

> **Unofficial.** Not affiliated with, endorsed by or supported by Trackman. The app shows this next to
> the provider's name wherever it is named, and the provider's name is never part of the app's name
> or icon.

## What it does

- **Pairs with a target** through `glmsync://pair?target=…&code=…` ([deep links](../../spec/deep-links.md)).
  A pair link only asks: "Connect with *host*?" shows the address the data would go to, and nothing
  happens without the player's yes (any app or page can open such a link).
- **Signs in at the provider** in the provider's own portal (`src/ui/TrackmanLoginView.tsx`). A small
  script in the page passes on the access key the portal itself sends to the provider's API; the
  password is typed into the provider's page and never seen by the app. Before anything is kept,
  "Is this you?" names the account (through the load guard, like every request).
- **Keeps the sign-in window in the app** (`src/lib/trackmanPage.ts`, `windowRules`): every load is decided there, so
  nothing goes to the system's browser - a captcha's frame from its provider's site loads in the page (react-native-
  webview hands a URL outside `originWhitelist` to the system, which on the iPhone opened the frame in Safari), a new
  window of the page opens in the same window, and a link anywhere else simply doesn't open.
- **Says when a passkey can't work**: a passkey needs the sign-in site to name the app as its own, which no site does
  for an app it doesn't make. When the page asks for one (not its offer on loading), the window says to sign in with
  e-mail and password instead. The browser extension and the web app use the browser's own portal, where passkeys work.
- **Renews quietly**: when the key runs out (Trackman's after about a week), a hidden window with the
  cookies the portal left on this phone brings a new one - once per app start, only where this phone
  held the player's key before, and only a key of that same account (`SignIns.renewalFits`). When that
  fails, the app says so and the target hears it (`auth_expired`).
- **The first sync before going back**: after pairing or signing in from a target's link with a way back, the app
  stays in front showing that it fetches until the first sync is through (at most two minutes, or "Back to … now"),
  and only then jumps back (`src/lib/firstSync.ts`): iOS suspends an app in the back within seconds, so a first sync
  left running behind the jump brought nothing. Without a way back the older history follows right away while the app
  is open.
- **Syncs only when a target's plan says so**: on opening the app (`open`), after pairing or signing
  in (`connect`), on "fetch now" and on a sync link (`manual`), when a target app binds on Android
  (`open` or `manual`, as it says), and in the background (`timer`,
  `expo-background-task`: Android's WorkManager about every 30 minutes, iOS as often as it wakes the
  app). Each asks the plan first; the provider is asked only when it is due, and never past the
  [load guard](../../spec/guard.md), whose counts outlive restarts. The older history comes a chunk at
  a time while the app is open (and one chunk per background wake), spaced as the target says.
- **Tells the target where its sign-in stands** with every plan (spec 1.5.0, `signin`): `ready` with a
  sign-in it can fetch with, `expired` when it ran out here, `none` when there never was one on this
  phone - and `other` (by a status, no lease) when the target has another account connected.
- **Jumps back** after `glmsync://sync?return=…` - only to an address that starts with a prefix the
  paired target named as its own at pairing; otherwise it stays and says what it did. A pair link's
  `return` (spec 1.2.0) the same way, once paired: right away when signed in already, else after the
  sign-in ("Then back to *name*"), and only to a prefix the target named in its answer to the pairing.
- **Fetches without a switch on Android**: a target app in front binds to the sync service
  (`glmsync.intent.action.SYNC`, [spec](../../spec/deep-links.md#android)); every bind runs a sync of
  that target's pairings as a headless JavaScript task (`modules/glmsync-sync`, `src/nudge.ts`), in
  the same queue as the screen's runs, the plan first. Only a paired target, one at a time per target
  and not again within ten seconds (`src/lib/nudge.ts`); nothing comes back over the binding.
- **Shows the counts** ("requests today 14 of 300"), and **exports the guard's log** of the last 14 days
  (times, kinds, statuses, durations - never content) through the share sheet.
- **Demo**: a made-up player (`@glmsync/provider-demo`) for trying the app without an account, and
  for app reviews. Its "requests" go through the guard too, so counters and log behave as for real.
- **Save as file**: a sync into an olmd file (the share sheet), planned gently by the file target -
  only when asked.
- **Licences**: every package the app is made of, with its licence text (`scripts/licenses.mjs`
  writes `src/licenses.json` after every install).

## What it keeps, and where

| What | Where |
| --- | --- |
| The provider sign-in (and the account it was of, for the quiet renewal) | the secure store (Keychain / Keystore), readable after the first unlock, this device only; cut into pieces where long (`ChunkedSecrets`) |
| Each pairing's import token | the secure store |
| The rest of a pairing (address, name, limits, return prefixes), the guard's counts and log, the last run per pairing | app storage (AsyncStorage) |

Android backups leave the secure store out (`allowBackup: false`). A sign-in goes to the provider
only; a target gets batches and nothing else (`src/lib/runner.test.ts` checks both directions). A
target that disconnects, or revokes the token, ends the pairing here; with the last pairing of a
provider the sign-in goes too.

## Layout

```
index.ts            entry: the background task and the Android sync task first, then the screen
app.config.ts       ids (from the environment for forks), scheme glmsync, EAS project and updates
src/lib/            everything without a screen, tested with vitest: secrets, sign-ins, pairings,
                    links, the runner (pair, sync, history, file, "Is this you?"), the Android sync
                    service's rules (nudge), whether a new build is out (newBuild), the wording
src/ui/             the screens: App (links, opening, quiet renewal), Home, PairView, SignInView,
                    FirstSyncView, SyncView, Licenses, TrackmanLoginView
src/platform.ts     the phone's parts: secure store, storage, share sheet
src/background.ts   the background task
src/nudge.ts        the headless task behind the Android sync service
modules/glmsync-sync  the Android sync service (Kotlin, a local Expo module; its manifest adds the
                    service to the app)
scripts/            licenses.mjs (the licences page), release.sh (builds and updates at Expo)
```

## Development

```
pnpm install                                   # also writes src/licenses.json
pnpm typecheck && pnpm test                    # from the repository root
pnpm --filter @glmsync/companion bundle:check  # Metro bundles for Android and iOS (CI too)
pnpm --filter @glmsync/companion start         # Expo dev server (a development build; the
                                               # web view and the secure store need one)
```

The Expo packages follow the SDK together (Dependabot leaves them alone): upgrade them all at once
with `npx expo install --fix` and a new build.

## Builds and updates

The published app is built by regsta Consulting GmbH, under its Expo organisation and Apple team
(`app.config.ts`). Builds happen at Expo (EAS Build), started from GitHub:

- **Companion build** (`.github/workflows/companion-build.yml`, by hand on `main`): an Android APK
  (internal distribution) or an iOS build that goes to TestFlight by itself (internal testers, no
  review). The run waits for the APK and puts it into the GitHub pre-release **`companion-android`**
  (replacing the one before), at a fixed address a target app can link to until the app is in
  Google Play:
  `https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases/download/companion-android/golf-launch-monitor-sync-companion.apk`.
  Beside it goes **`latest.json`**: the runtime (fingerprint of the native part) of the newest build per platform.
  With `all`, the iOS build is waited for too, and only a finished one is written there.
- **Companion update** (`.github/workflows/companion-update.yml`, every push to `main` that changes
  the app or a package it uses): after this commit's tests pass, an over-the-air update (EAS Update,
  channel `preview`) to every build that can run it. Where none can (the native part changed), it
  publishes nothing and says to start a build by hand.

**Nobody has to say there is a new version.** The JavaScript part comes over the air. A new build (its native part
changed) can't: when the app starts it reads `latest.json` and, if it names another runtime than its own, says a new
version is out - on Android with *Download new version* (the APK above), on the iPhone pointing to TestFlight, which
updates by itself where automatic updates are on (`src/lib/newBuild.ts`). Only the runtime is read from the file; the
address is the app's own. The request goes to GitHub and carries nothing of the player's. A development build has no
runtime and asks nothing.

**The version a target sees** is `version` in `app.config.ts` (sent at pairing and with every batch as `generator`).
It doesn't count towards the runtime, so raising it goes out over the air; raise it when a target should be able to
ask for what this version brings.

Both need the secret `EXPO_TOKEN` in the GitHub environment **`release`**, which only `main` may use
(Settings › Environments › release › Deployment branches: `main`): pull requests, forks and other
branches never reach it. The token is a robot user's of the Expo organisation (role *Developer*).
Without the token, or without the EAS project id in `app.config.ts`, both workflows do nothing and
say why. iOS takes part once `eas.json` has the App Store Connect app's id (`submit.testflight.ios.ascAppId`).

**The first iOS build** needs two things a workflow can't do, because both ask for an Apple sign-in. Done once, on a
Mac, by a member of the Apple team, in `apps/companion` (after `pnpm install` at the root):

1. The signing credentials of the build profile `testflight`:
   `npx eas-cli@27 credentials:configure-build -p ios -e testflight` (sign in to Apple; reuse an existing
   distribution certificate if the team has one; let Expo make the App Store provisioning profile; no push key, the
   app has no push).
2. The App Store Connect API key that EAS Submit uploads with: `npx eas-cli@27 credentials -p ios`, profile
   `testflight`, *App Store Connect: Manage your API Key* → *Set up your project to use an API Key for EAS Submit*
   (an existing team key with the role App Manager, or a new one).

Then **Companion build** with `ios`. The build goes to App Store Connect by itself and on to the internal testers'
group in TestFlight. Apple asks no export compliance question: `usesNonExemptEncryption: false` in `app.config.ts`
writes `ITSAppUsesNonExemptEncryption = NO` into the build (the app uses only the system's HTTPS and keychain).
Until an iOS build exists, **Companion update** says for `ios` that a new build is needed and updates Android only.

**A fork** sets its own ids through the environment (`GLMSYNC_APP_ID`, `GLMSYNC_EXPO_OWNER`,
`GLMSYNC_EAS_PROJECT_ID`) and its own Expo project and store records.
