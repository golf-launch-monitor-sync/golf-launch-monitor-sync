<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Golf Stats Sync — browser extension

Syncs your launch monitor data from your own Trackman account into an app of your choice, in the
background, while your browser is open — and reads your handicap record along on golf.de while you open it
([below](#the-handicap-record-on-golfde)). Manifest V3; Chrome, Edge and Firefox.

> **Unofficial.** Not affiliated with, endorsed by or supported by Trackman, the DGV or golf.de. It reads
> your own Trackman account with your own sign-in, the way Trackman's web portal does, and on golf.de only
> what golf.de's own page loaded in your tab.

## How a player uses it

1. In the app that wants the data (a *target*), choose to connect Launch Monitor Sync. It opens the
   web app's pairing page (`…/pair#target=…&code=…`; the part after `#` reaches no server).
2. The extension picks the code up and opens its connect page in a tab beside it: **which address** the data would go to.
   *Allow and connect* — the browser asks once for that one address — and it is connected. The pairing page closes
   itself once the extension took over (when the app opened it; otherwise it says it may be closed).
3. From here connecting goes **as steps with their progress** (*Step 2 of 4*; the same for every service,
   [`@glmsync/browser`'s wizard](../../packages/browser/README.md#connecting-step-by-step)), in the connect page and
   in the popup alike. Open the Trackman portal (`portal.trackmangolf.com`) and sign in, or just open it if you are.
   The extension takes your sign-in from there and asks **"Is this your Trackman account?"** (the name, the newest
   activity and where - no count) before anything is fetched; until the answer the page shows nothing that looks as if
   it were running, only, big, *Not yet connected with … – confirm your account*. *Yes*: the first data, shown plainly
   (*2 sessions, 0 rounds fetched*, then how much older data is still to come), and **Back to …**, which closes the
   tab. *No* offers **Sign in with another Trackman account**: Trackman's own sign-out, then the portal to sign in
   with your own (in the same tab is fine: the extension keeps looking for the new sign-in for a while after the
   portal loads).
4. From then on it runs by itself. About once a week Trackman's sign-in runs out: the icon shows
   **!**, the app is told too, and opening the portal again is enough.
5. The app's own page in this browser can ask the extension to **fetch now** and show where its sign-in stands
   ([the bridge](#the-bridge-on-the-apps-page)).
6. **Test mode** (for testing a connected app by hand, [spec/test-mode.md](../../spec/test-mode.md)): *Enter a test
   code* at the bottom of the popup or the connect page, for a connected app's test account - the code its test page
   shows, or its test link (`glmsync://test?…`, which a browser can't open: copy it in). The scenario comes from that
   app with the connection's token; **"Is this your account?"** about its made-up account; then that connection syncs
   from it exactly as from Trackman (the plan, the guard under the scenario's own account, the first sync, the older
   history a chunk per alarm), every batch marked `test: true`, Trackman never asked and no Trackman sign-in needed.
   A card *Test mode – made-up data* with *End test mode*; the scenario lies in the extension's IndexedDB until then,
   until the connection ends or its end date passes. The sign-in and other connections go on as before.

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
  extension's own requests carry the sign-in and nothing copied from the portal. It looks when the page
  loads, when the tab comes back, and every few seconds for two minutes after loading (then every half
  minute): coming back from Trackman's sign-in, the portal stores the new key on its own time.
- **The app hears where the sign-in stands** (spec 1.5.0, `signin`): with every plan, and - while there is
  no sign-in it can fetch with - with a status (`GET /status`, no lease), at its regular look and when the
  sign-in changes. The five words `none`, `confirm`, `ready`, `expired`, `other`; nothing more.

## The handicap record on golf.de

[spec/hcp.md](../../spec/hcp.md), *A client that only observes*; the module is
[`@glmsync/provider-golfde`](../../packages/provider-golfde/README.md).

1. In the app, choose to connect Golf Stats Sync for the handicap record. It opens the same pairing page, with
   `kind=hcp`; the connect page says the app asks for your handicap record from golf.de. *Allow and connect*.
2. Open your **History Sheet** on golf.de (signed in as always). The same steps as for a launch monitor follow: the
   account golf.de's page named - **"Is this your golf.de account?"** with its handicap index - and nothing goes to the
   app before *Yes, that's me*. The line on golf.de's page says so (*not yet connected with … – confirm your account*)
   with *Confirm*, which only brings the connect page to the front: the yes is given there, in the extension's own
   page, out of reach of golf.de's scripts. *No* keeps nothing of that account and sends nothing of it.
3. Then flip through its pages if you like, open the **Scoring Record**, a tournament's **result list**. The line
   says what was seen and what is new (*Golf Stats Sync: 20 results seen · 3 new*); half a minute after the last new
   page it goes to the app, or at once with *Send*. The popup has *Send by itself* to switch that off.

What it does, and doesn't:

- **It sends golf.de nothing.** golf.de's API answers only with golf.de's own client id, which the extension never
  sends (*no disguise*, *no borrowed client id*). `golfde-main.ts` runs in golf.de's page before its scripts and looks
  at the answers golf.de's page receives for three GraphQL operations, a result list and the session - nothing else -
  and posts dgvhcp/1 results made in the page: no names, no card or member numbers ever leave it. `golfde-relay.ts`
  hands them to the background and draws the line (in a shadow root; only once an app is connected for it).
- **Nothing by itself.** No timer reads golf.de; what you don't open isn't read. The app reminds you instead when the
  record is due.
- **The plan before sending**: every batch after the app's plan (`manual`), only what that app doesn't have from here
  yet; the pages of a visit go together, so the app keeps one import, not one per page.
- **Whose record**: the account *Mein Bereich* names (its stable number, sent only as `account_ref`); another account's
  record drops what was kept of the one before, and goes to no app that has another.
- **Not read**: a scorecard's holes (golf.de shows them only as a picture).

## The bridge on the app's page

[spec/page-bridge.md](../../spec/page-bridge.md). A small content script (`bridge-content.ts`) goes on the pages
of each connected app's address - the address you allowed when connecting, so no new permission - registered at
run time for those addresses only, top frame only, and removed with the connection. The app's page can ask where
the extension stands (`state`: the sign-in, whether it is fetching) and to **fetch now** (`fetch`): a manual sync of
that app's connection, the plan first and the guard as always, not again within 10 s, answered `started` and then
`finished` - or `signin`, `guard` (until when), `busy`, `unpaired`. The page never gets your sign-in, the import
token, a name or an account. `bridge.ts` holds the logic (tested without a browser).

## Permissions

| Permission | Why |
| --- | --- |
| `portal.trackmangolf.com` | To read your sign-in where the portal keeps it (content script). |
| `api.trackmangolf.com` | To fetch your sessions and rounds. |
| the web app's pairing page | To pick up a pairing code from its fragment. |
| a target's address (asked when you connect it) | To send it your data. Never all sites at once. |
| `storage` | The sign-in, the connections, the guard's counts and log. |
| `alarms` | To ask the plan every few minutes. |
| `scripting` | To reach a pairing page that was already open when the extension was installed, and to put the bridge on the pages of the apps you connected (their addresses only, which you allowed). |

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
  `bridge-content.ts` (with `bridge.ts`) a connected app's page; `popup.ts`, `connect.ts` the extension's pages.
- The bundles hold no `eval` (Manifest V3 forbids it): the olmd/1 schema check is compiled ahead of
  time (`tools/browser-build.mjs`). The build fails if one does.
- **Click checks** (`e2e/`): Chromium with the extension loaded; the pairing page, the portal, Trackman's
  API and a target app are answered in the test (`tools/e2e/world.ts`). The test build grants the
  made-up target at install (`dist-e2e/`), since no one can click the browser's own prompt there.
- **Release**: raise `version` in `package.json` and push to `main`: once all of CI's checks of that commit are
  green, CI releases it by itself (`ci.yml` › *release-extension*, `tools/release-check.mjs`; since 18 Nov).
  Raising the version stays the deliberate step: when what goes into the extension changed since the last
  release without a new version, CI's run says so (a notice, no failure). A tag `extension-v<version>`, or
  *Actions › Release extension* on `main`, still works by hand. `release.yml`
  tests (unless CI just did), lints the Firefox build with Mozilla's `web-ext lint` (`--self-hosted`: it names its own `update_url`) and
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
| `scripting` | To reach the web app's pairing page when it was already open before the extension was installed, to pick up the pairing code; and to let the page of an app the user connected (only that app's address, which the user allowed when connecting) ask the extension to fetch now, as the popup's *Fetch now* does. |
| Host `portal.trackmangolf.com` | Reads the user's own sign-in where Trackman's web portal keeps it, so the user doesn't type a password into the extension. |
| Host `api.trackmangolf.com` | Fetches the user's own sessions, shots and rounds with that sign-in. |
| Host `golf-launch-monitor-sync.github.io` (pairing page) | Picks up the pairing code the user's app put into the page's address. |
| Optional hosts (`https://*/*`) | The address of an app the user connects, asked for at that moment and only for that one address, to send it the data - and for that app's own page to ask the extension to fetch now. Never all sites. |

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
