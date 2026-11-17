<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Golf Launch Monitor Sync — browser extension

Syncs your launch monitor data from your own Trackman account into an app of your choice, in the
background, while your browser is open. Manifest V3; Chrome, Edge and Firefox.

> **Unofficial.** Not affiliated with, endorsed by or supported by Trackman. It reads your own
> account with your own sign-in, the way Trackman's web portal does.

## How a player uses it

1. In the app that wants the data (a *target*), choose to connect Launch Monitor Sync. It opens the
   web app's pairing page (`…/pair#target=…&code=…`; the part after `#` reaches no server).
2. The extension picks the code up and opens its connect page in a tab beside it: **which address** the data would go to.
   *Allow and connect* — the browser asks once for that one address — and it is connected.
3. Open the Trackman portal (`portal.trackmangolf.com`) and sign in, or just open it if you are. The
   extension takes your sign-in from there and asks **"Is this your Trackman account?"** (name,
   number of activities, the newest) before anything is fetched.
4. From then on it runs by itself. About once a week Trackman's sign-in runs out: the icon shows
   **!**, the app is told too, and opening the portal again is enough.

The popup shows the sign-in, the connected apps with what they last got, *Fetch now*, *Disconnect*,
and the requests to Trackman ("last hour 3 of 60 · last 24 hours 14 of 300") with the log to export.

## What it does, and doesn't

- **The plan first, always.** Every five minutes it asks each connected app's plan (`GET /plan`, a
  request to the app, not to Trackman); it fetches only when the plan says so, and the older history
  only a chunk at a time when the plan allows. *Fetch now* asks the plan too.
- **The load guard** of [`@glmsync/core`](../../packages/core/README.md) holds whatever a plan says:
  one request at a time, 1–3 s apart, 40 a sync, 60 an hour, 300 a day, backing off after errors.
  It can't be switched off.
- **Your Trackman sign-in stays in the extension** (its own storage, which no web page can read) until
  it runs out. It goes to `api.trackmangolf.com` and nowhere else; the app gets your data and an
  `account_ref` (a hash that names no one), never the sign-in.
- **Only your own account**: a first sign-in of an account is asked about; another account than the
  one an app has connected is never used for it; "No" keeps that account out.
- **Reading the sign-in** (`portal-main.ts`, in the portal's own page): a key Trackman's sign-in issued,
  from the portal's storage or cookies, or the `Authorization` of the portal's own calls to
  Trackman's API. It only reads; the portal's requests go out unchanged. Nothing is disguised: the
  extension's own requests carry the sign-in and nothing copied from the portal.

## Permissions

| Permission | Why |
| --- | --- |
| `portal.trackmangolf.com` | To read your sign-in where the portal keeps it (content script). |
| `api.trackmangolf.com` | To fetch your sessions and rounds. |
| the web app's pairing page | To pick up a pairing code from its fragment. |
| a target's address (asked when you connect it) | To send it your data. Never all sites at once. |
| `storage` | The sign-in, the connections, the guard's counts and log. |
| `alarms` | To ask the plan every few minutes. |
| `scripting` | Only to reach a pairing page that was already open when the extension was installed. |

Firefox lists one kind of data leaving the browser (`websiteContent`): your launch monitor data, to
the app you connect. Nothing goes to this project or anyone else.

## Install

- **From the stores** (one click, and the browser keeps it up to date): the Chrome Web Store (also for Edge, or
  Microsoft Edge Add-ons) and, for Firefox, the signed add-on from the web app's site
  (`https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/firefox/golf-launch-monitor-sync.xpi`). While
  the project is being tried out they are **unlisted**: the app you connect links to them (its *Install* button).
- **By hand, for testing** (it never updates itself this way): download the newest
  `golf-launch-monitor-sync-chrome-edge-<version>.zip` (Chrome and Edge: one package) or `…-firefox-<version>.zip` from
  the [releases](https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases) (between releases:
  *Actions › CI*, the newest run on `main`, artifact *extension-packages*) and unpack it — or build it yourself
  (below; `apps/extension/dist/chrome`).
  - **Chrome / Edge**: `chrome://extensions` (Edge: `edge://extensions`) › *Developer mode* on › *Load unpacked* › the
    unpacked folder.
  - **Firefox**: `about:debugging#/runtime/this-firefox` › *Load Temporary Add-on…* › `manifest.json` in the unpacked
    folder (gone after a restart: Firefox keeps only signed add-ons).

Then pin the icon to the toolbar and connect from your app.

## Updates

Nobody has to tell a player there is a new version:

- **Chrome Web Store, Edge Add-ons**: the browser updates the extension itself, every few hours.
- **Firefox**, signed by Mozilla but not listed on addons.mozilla.org: the manifest's `update_url` (`src/manifest.ts`)
  points at `firefox/updates.json` on the web app's site. `tools/firefox-updates.mjs` writes it, with the add-on itself,
  from the newest release that carries a signed `.xpi`; `pages.yml` runs it with every publish of the site and again
  when such a release is edited (the `.xpi` attached). Firefox looks about once a day.
- **Loaded by hand**: nothing updates. That is why the stores.

## Build, test, release

```
pnpm --filter @glmsync/extension build      # dist/chrome, dist/firefox
pnpm --filter @glmsync/extension package    # and the store zips in dist/
pnpm e2e                                    # click checks (from the repository root)
```

- `src/background.ts` the background (alarms, messages, the icon); `src/tabs.ts` where its pages open (a tab
  beside the page that led there, in that window, in front - never a popup window, which a Mac in full
  screen made a full-screen window of its own); `src/senders.ts` who may send it
  what (the key only from the portal, a pairing code only from the pairing page, everything else
  only from the extension's own pages); `src/manifest.ts` the manifest for both browsers.
- `src/portal-main.ts`, `portal-relay.ts` the portal tab; `pair-content.ts` the pairing page;
  `popup.ts`, `connect.ts` the extension's pages.
- The bundles hold no `eval` (Manifest V3 forbids it): the olmd/1 schema check is compiled ahead of
  time (`tools/browser-build.mjs`). The build fails if one does.
- **Click checks** (`e2e/`): Chromium with the extension loaded; the pairing page, the portal, Trackman's
  API and a target app are answered in the test (`tools/e2e/world.ts`). The test build grants the
  made-up target at install (`dist-e2e/`), since no one can click the browser's own prompt there.
- **Release**: raise `version` in `package.json`, then push a tag `extension-v<version>` or run *Actions ›
  Release extension* on `main` (it makes the tag at that commit); `release.yml`
  tests, lints the Firefox build with Mozilla's `web-ext lint` (`--self-hosted`: it names its own `update_url`) and
  attaches both zips to a GitHub release. Submitting to the Chrome Web Store, Edge Add-ons and Mozilla is done
  by hand (below); no store credentials live in this repository.

## Store listings

What a maintainer submits, by hand, for each new version: the Chrome/Edge zip to the **Chrome Web Store** and to
**Microsoft Edge Add-ons**, both **unlisted** (Chrome: *Unlisted*; Edge: *Hidden*), and the Firefox zip to
**addons.mozilla.org** as *On your own* (self-distribution): Mozilla signs it, and the signed `.xpi` goes into the
same GitHub release (edit the release, attach the file, *Update release*; the web app's site then publishes it, see
*Updates*). The answers the forms ask for, ready to paste:

**Name, summary**: from the manifest (`Golf Launch Monitor Sync`; the tagline in `packages/browser/src/messages.ts`).

**Description**:

> Unofficial. Not affiliated with, endorsed by or supported by Trackman.
>
> Syncs your launch monitor data from your own Trackman account into an app you choose, in the background, while your
> browser is open. You connect the app from inside it; the extension then asks that app's plan every few minutes and
> fetches only when the plan says so, within a load guard that can't be switched off (60 requests an hour, 300 a day).
> Your Trackman sign-in stays in the extension and goes only to Trackman. Open source (MIT):
> https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync

**Category**: Chrome *Workflow & Planning*; Edge *Productivity*; Mozilla *Other*.

**Single purpose** (Chrome):

> Moves the user's own launch monitor data (golf practice sessions, shots and rounds) from their own Trackman account
> to an app the user connects, when that app asks for it.

**Permission justifications** (Chrome; Edge asks much the same on its *Privacy* page):

| Permission | Justification |
| --- | --- |
| `storage` | Keeps the user's Trackman sign-in (until it expires), the connected apps with their import tokens, and the load guard's counts and log - on the device only. |
| `alarms` | Asks each connected app every few minutes whether data is due; only then does it fetch. |
| `scripting` | Only to reach the web app's pairing page when it was already open before the extension was installed, to pick up the pairing code. |
| Host `portal.trackmangolf.com` | Reads the user's own sign-in where Trackman's web portal keeps it, so the user doesn't type a password into the extension. |
| Host `api.trackmangolf.com` | Fetches the user's own sessions, shots and rounds with that sign-in. |
| Host `golf-launch-monitor-sync.github.io` (pairing page) | Picks up the pairing code the user's app put into the page's address. |
| Optional hosts (`https://*/*`) | The address of an app the user connects, asked for at that moment and only for that one address, to send it the data. Never all sites. |

**Remote code**: *No, I am not using remote code.* All code is in the package; the data check is compiled ahead of
time, nothing is evaluated.

**Data usage** (Chrome; tick these, nothing else):
- *Authentication information*: the user's Trackman sign-in, kept on the device and sent only to Trackman's API.
- *Website content*: the user's launch monitor data from Trackman, sent only to the app the user connected.

Certify all three: not sold or transferred to third parties outside the approved use cases; not used or transferred
for purposes unrelated to the single purpose; not used or transferred to determine creditworthiness or for lending.

**Privacy policy URL**: https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/blob/main/PRIVACY.md

**Homepage and support URL**: https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync (support: its
issues).

**Screenshots**: `apps/extension/store/*.png` (1280×800; Chrome needs at least one), made from the click checks'
made-up world, never a real account: `STORE_SCREENSHOTS=1 pnpm e2e apps/extension/e2e/store-screenshots.spec.ts`
writes them again after the pages change.

**Mozilla only**:
- *How to distribute*: **On your own** (not listed on the site).
- *Source code*: **Yes** - the bundles are built with esbuild. Upload the release's *Source code (zip)* from GitHub;
  build instructions for the reviewer: Node 22 and pnpm 10, `pnpm install --frozen-lockfile`, then
  `pnpm --filter @glmsync/extension package`; the package is
  `apps/extension/dist/golf-launch-monitor-sync-firefox-<version>.zip`.
- *Data collection*: already in the manifest (`websiteContent`, required); nothing optional.
- *Notes to reviewer*: Self-distributed; `update_url` points at the project's GitHub Pages. Unofficial Trackman client
  for the user's own account: reads the sign-in from the portal, fetches with it from Trackman's API, sends the data
  to an app the user connects. Source and build: see above.
