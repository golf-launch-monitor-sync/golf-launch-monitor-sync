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
2. The extension picks the code up and opens a small window: **which address** the data would go to.
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

Until it is in the stores, testers load it by hand:

1. Download the newest `golf-launch-monitor-sync-chrome-<version>.zip` (Chrome, Edge) or
   `…-firefox-<version>.zip` from the [releases](https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/releases)
   (between releases: *Actions › CI*, the newest run on `main`, artifact *extension-packages*) and
   unpack it — or build it yourself (below; `apps/extension/dist/chrome`).
2. **Chrome / Edge**: `chrome://extensions` (Edge: `edge://extensions`) › *Developer mode* on ›
   *Load unpacked* › the unpacked folder.
3. **Firefox**: `about:debugging#/runtime/this-firefox` › *Load Temporary Add-on…* › `manifest.json`
   in the unpacked folder (gone after a restart: Firefox keeps only signed add-ons).
4. Pin the icon to the toolbar, then connect from your app.

## Build, test, release

```
pnpm --filter @glmsync/extension build      # dist/chrome, dist/firefox
pnpm --filter @glmsync/extension package    # and the store zips in dist/
pnpm e2e                                    # click checks (from the repository root)
```

- `src/background.ts` the background (alarms, messages, the icon); `src/senders.ts` who may send it
  what (the key only from the portal, a pairing code only from the pairing page, everything else
  only from the extension's own pages); `src/manifest.ts` the manifest for both browsers.
- `src/portal-main.ts`, `portal-relay.ts` the portal tab; `pair-content.ts` the pairing page;
  `popup.ts`, `connect.ts` the extension's pages.
- The bundles hold no `eval` (Manifest V3 forbids it): the olmd/1 schema check is compiled ahead of
  time (`tools/browser-build.mjs`). The build fails if one does.
- **Click checks** (`e2e/`): Chromium with the extension loaded; the pairing page, the portal, Trackman's
  API and a target app are answered in the test (`tools/e2e/world.ts`). The test build grants the
  made-up target at install (`dist-e2e/`), since no one can click the browser's own prompt there.
- **Release**: raise `version` in `package.json`, push a tag `extension-v<version>`; `release.yml`
  tests, lints the Firefox build with Mozilla's `web-ext lint` and attaches both zips to a GitHub
  release. Submitting to the Chrome Web Store (also used for Edge Add-ons) and Firefox Add-ons is done
  by hand; no store credentials live in this repository.
