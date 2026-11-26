<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Golf Stats Sync — browser extension

Syncs your launch monitor data from your own Trackman account into an app of your choice, in the
background, while your browser is open — reads your handicap record along on golf.de while you open it
([below](#the-handicap-record-on-golfde)), and sends a pro's own world ranking page when you tap *Send* on it
([below](#a-pros-world-ranking-page)). Manifest V3; Chrome, Edge and Firefox.

> **Unofficial.** Not affiliated with, endorsed by or supported by Trackman, the DGV, golf.de, the OWGR, Rolex or any tour. It reads
> your own Trackman account with your own sign-in, the way Trackman's web portal does, and on golf.de only
> what golf.de's own page loaded in your tab.

## How a player uses it

1. In the app that wants the data (a *target*), choose to connect Launch Monitor Sync. It opens the
   web app's pairing page (`…/pair#target=…&code=…`; the part after `#` reaches no server).
2. The extension picks the code up and opens its connect page in a tab beside it. Connecting goes **as steps with
   their progress**, one button each (*Step 1 of 5*; the same for every service,
   [`@glmsync/browser`'s wizard](../../packages/browser/README.md#connecting-step-by-step)): **which address** the data
   would go to, and **what to connect** - *Connect launch monitor* is the yes, and the browser asks once for that one
   address on the same click (refused, the step stays and says so) -, and it is connected. The pairing page closes itself once the extension took over (when the app opened it; otherwise it
   says it may be closed). *Connect new* in the popup opens the same page at its first step, which says to start in
   the app and goes on by itself once the app's pairing page hands over its code.
3. The steps go on in the connect page (and from the popup's row): open the Trackman portal (`portal.trackmangolf.com`)
   and sign in, or just open it if you are.
   The extension takes your sign-in from there and asks **"Is this your Trackman account?"** (the name, the newest
   activity and where - no count, and on that step nothing else but *Yes, that's me* / *No*) before anything is
   fetched; until the answer the page shows nothing that looks as if it were running. *Yes*: you are done (*Done – fetching your data …*) and
   **Back to …**, which closes the tab, is there at once; the first data shows plainly as it comes (*2 sessions, 0 rounds
   fetched*, then how much older data is still to come), and goes on with the tab closed. *No* offers **Sign in with another Trackman account**: Trackman's own sign-out, then the portal to sign in
   with your own (in the same tab is fine: the extension keeps looking for the new sign-in for a while after the
   portal loads).
4. From then on it runs by itself. About once a week Trackman's sign-in runs out: the icon shows
   **!**, the app is told too, and opening the portal again is enough.
5. The app's own page in this browser can ask the extension to **fetch now** and show where its sign-in stands
   ([the bridge](#the-bridge-on-the-apps-page)).
6. **Test mode** (for testing a connected app by hand, [spec/test-mode.md](../../spec/test-mode.md)): in step 3, small
   under *Open the Trackman portal* (and under it in a connection's details while it isn't signed in), *Enter a test
   code*, for a connected app's test account instead of the sign-in - the code its test page shows, or its test link
   (`glmsync://test?…`, which a browser can't open: copy it in). A code that isn't right stays there with its
   sentence. The scenario comes from that app with the connection's token; step 4, **"Is this your account?"** about
   its made-up account (only the account and yes or no); then that connection syncs
   from it exactly as from Trackman (the plan, the guard under the scenario's own account, the first sync, the older
   history a chunk per alarm), every batch marked `test: true`, Trackman never asked and no Trackman sign-in needed.
   A card *Test mode – made-up data* with *End test mode*; the scenario lies in the extension's IndexedDB until then,
   until the connection ends or its end date passes. The sign-in and other connections go on as before. A connection
   in test mode never asks for the Trackman sign-in: not in the list, its details or on the icon. With a Trackman
   account signed in here already, *Forget the sign-in here* first.

The popup opens on *Connect new* and the **list of connections** (Trackman's account, golf.de's record, a connection
in test mode), each with where it stands - *running*, *loading the history*, *run out – sign in again*, *test mode*,
*not set up yet – continue*. A row opens its details: the sign-in, the connected apps with what they last got, *Fetch
now*, *Disconnect*, and the requests to Trackman ("last hour 3 of 60 · last 24 hours 14 of 300") with the log to
export - or, while it isn't set up, its steps.

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
- **Fetch all**: signed in, with the account confirmed, *Fetch all* on the line opens every page of the History Sheet,
  the Scoring Record and the result lists of your tournaments of the last two years (at most 100) for you, with a
  pause between pages, and reads along; what it read goes once, at the end.
- **By itself when due** (spec 1.16.0, extension 0.20.0): every half hour the extension asks the app's plan (`timer`, once a day at
  most). When it says due and golf.de last said you are signed in, it opens *Mein Bereich* in a tab that doesn't take
  the focus, does the same run there, and closes the tab at the end (one you switched to stays). Signed out, it reads
  nothing and never signs in; a run that stops early waits until you have been on golf.de yourself. The popup has
  *Fetch by itself when due* to switch it off. Nothing else is read in the background.
- **The plan before sending**: every batch after the app's plan (`manual`), only what that app doesn't have from here
  yet; the pages of a visit go together, so the app keeps one import, not one per page.
- **Whose record**: the account *Mein Bereich* names (its stable number, sent only as `account_ref`); another account's
  record drops what was kept of the one before, and goes to no app that has another.
- **Not read**: a scorecard's holes (golf.de shows them only as a picture).

## A pro's world ranking page

Since 0.13.0 ([spec/prores.md](../../spec/prores.md); the module is
[`@glmsync/provider-rankings`](../../packages/provider-rankings/README.md)).

1. In the app, choose to connect Golf Stats Sync for the world ranking. It opens the same pairing page, with
   `kind=pro`; the connect page offers *Connect world ranking*, which is the yes.
2. Open your own page on the **OWGR** (men) or the **Rolex Rankings** (women) - the connect page has a button to each
   site's ranking, where you search for your name. A small line at the bottom of your page says *Golf Stats Sync: send
   this page to …* with **Send**.
3. *Send* reads the page as it shows it (OWGR's table comes a moment after the page; the extension waits for it): your
   rank, average points, divisor, and your tournaments by week with tour, place and points. It goes to the app after
   its plan (`manual`), one page a batch; the line says *Sent to …*.
4. If the app knows you by another name than the page writes, it asks (`other_player`); the line says so with
   **Answer**, which only brings the connect page to the front: *Is this page yours?* is answered there, in the
   extension's own page, out of reach of the site's scripts. A yes sends the page again, and that page from then on,
   marked confirmed.

What it does, and doesn't:

- **It sends the sites nothing.** `rankings-content.ts` runs only on a player's page (`owgr.com/playerprofile/*`,
  `rolexrankings.com/players/*`) in the extension's own world, reads nothing until you tap *Send*, and then only the
  document the site's own scripts built. No timer, nothing in the background; the app reminds you instead.
- **Whose page**: the site's id of the player (from the address) goes only into the `account_ref`; the name the page
  writes goes along for the app's check and is kept nowhere here.
- **No rounds**: a world ranking has none; the app takes rounds from the tours.
- The companion app doesn't read these pages yet (it refuses `kind=pro` links rather than take them for another kind).

### A tour's pages: the Pro Golf Tour

Since 0.14.0 (the module is [`@glmsync/provider-tours`](../../packages/provider-tours/README.md)), with the same
connection as the world rankings (`kind=pro`).

1. Open your own profile on **progolftour.de** (*Players*, or the *Order of Merit*). The line says *Golf Stats Sync:
   send this page to …* with **Send** and **Fetch all**.
2. The profile shows your Order of Merit and your season's tournaments, but no rounds; the rounds are on each
   tournament's page. Open one yourself, or tap **Fetch all**: it opens the pages of your finished tournaments of that
   season one by one in the same tab, with a pause of several seconds between them (above the site's crawl delay),
   at most 30, three runs a day, and **Stop** ends it.
3. On each tournament's page only your own line is taken (place, R1-R3, how many played) - by the name of your profile;
   nobody else's line leaves the page. *Send* (and the end of *Fetch all*) sends your rank and points and every finished
   tournament whose rounds were read; a tournament without its rounds isn't sent.

`tours-content.ts` runs on `progolftour.de` in the extension's own world and reads nothing until an app is connected
for a pro's pages. It keeps only the profile you opened last (another player's profile replaces it, with everything read
for it) and your lines, in the extension's own storage. It sends the site nothing; *Fetch all* opens the site's own
addresses as its links do.

### DP World Tour and HotelPlanner Tour

Since 0.15.0, on **europeantour.com** - one page per player for both tours, with the same connection (`kind=pro`).

1. Open your own page (*Players*, search your name). The line says *Golf Stats Sync: send this page to …* with **Send**.
2. Each page of yours is read as it shows: the head (your rank on the tour the address names), the overview (that
   tour's rankings and your last five tournaments), **Wins & Results** (your tournaments of the season picked, with
   R1-R4) and **Stats** (the season statistics of the tour picked). Pick another season or tour in the page's own
   select and it is read too, a moment later.
3. **Send** sends what was read, a page per tour - your DP World Tour and your HotelPlanner Tour each to the app.
   A tournament goes with its rounds; Legends and G4D events aren't read; prize money never.

`europeantour-content.ts` runs only on `europeantour.com/players/*`, in the extension's own world, and reads nothing
until an app is connected for a pro's pages. It keeps what your pages showed (another player's page replaces it) in the
extension's own storage. It sends the site nothing, and never asks the site's data service. Since 0.21.0 **Fetch all**
(below) opens your pages and picks the seasons and tours for you.

### A tour's season page: PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour

Since 0.16.0 (the module is [`@glmsync/provider-tours`](../../packages/provider-tours/README.md) `seasonPage`), with the
same connection (`kind=pro`).

1. Open your own player page on **pgatour.com** (PGA Tour; the Korn Ferry Tour under *Tour* or its own players),
   **lpga.com** or **epsontour.com** and go to **Results**. The line says *Golf Stats Sync: send this page to …* with
   **Send** - only there, nowhere else on the sites.
2. Pick the season (and on pgatour.com the tour) on the page as you like; **Send** sends what the page shows then: the
   season's standing (FedExCup, Points List, Race to CME Globe, Race for the Card: rank and points) and every finished
   tournament with its place, points and your rounds. Nothing is opened for it - the page shows the whole season.
3. A tournament on pgatour.com names only its last day, one on lpga.com and epsontour.com only its first: the other is
   counted by the rounds the table has room for (the app marks those days as estimated). A team event (two players'
   score per round: Zurich Classic, Dow Championship …) is left out, as is a tournament not over yet. A tour of
   pgatour.com this doesn't read (PGA Tour Champions, PGA Tour Americas) says so and sends nothing.
4. Since 0.18.0 also **Stats**: the line shows there too, and **Send** sends the season's statistics of the season (and
   tour) picked on the page - strokes gained, driving, greens, proximity, scrambling, putting, scoring, par 3/4/5, and on
   lpga.com and epsontour.com rounds, events, cuts, top 10s and wins with the standing's points and rank - in metres
   where the page writes yards or feet. Send *Results* and *Stats* each once a season, as you like.

`season-content.ts` runs on those sites in the extension's own world (the whole site, because the sites move to
*Results* and *Stats* without loading a page; the line shows only there) and reads nothing until an app is connected for a pro's
pages and you tap *Send* or *Fetch all* (since 0.21.0, below). By hand it keeps nothing of the page; a run of *Fetch
all* keeps the seasons it read until it ends. It sends the sites nothing.

### A tour's pages: the Ladies European Tour and the LET Access Series

Since 0.17.0 (the module `ocs` of [`@glmsync/provider-tours`](../../packages/provider-tours/README.md)), with the same
connection.

1. Open your own profile on **ladieseuropeantour.com** or **letaccess.com** (*Players*, search your name). The line
   says *Golf Stats Sync: send this page to …* with **Send**. The profile shows your results of the season picked there
   with every round, so nothing else needs opening; pick another season to send that one.
2. For your rank, open the tour's **Order of Merit** afterwards: only your own line is taken (by the link to the profile
   you read last, never by a name), and the line says *Rank n of the Order of Merit read*. **Send** there, or on your
   profile, sends both.
3. A tournament goes with its rounds and its par (the total minus its score to par, over the rounds), and only three
   days after its start, so one still running isn't sent half.

`ocs-content.ts` runs on every page of both sites (each is one app that changes its address without loading a page,
so it looks again when the address changes) and reads nothing until an app is connected for a pro's pages. It keeps
per tour only the profile you read last and your Order of Merit line (another player's profile replaces both), in the
extension's own storage (since 0.21.0 each season read, so a send has them all). It sends the sites nothing; only
**Fetch all** (below) picks the seasons on your profile and opens the Order of Merit of each.

### A tour's pages: the Alps Tour

Since 0.19.0 (the module `alps` of [`@glmsync/provider-tours`](../../packages/provider-tours/README.md)), with the same
connection.

1. Open your own profile on **alpstourgolf.com** (the Order of Merit on the start page or *See Full Rankings*, then your
   name). It shows one report at a time, picked under **Select Report**; the line says which to pick.
2. Pick **This Season record**: your tournaments of the season with every round. **Results** adds the par (each
   tournament's score to par; the par is the total minus it, over the rounds), **Order of Merit** your rank, points and
   tournaments played. Each report is read when you pick it; the line says what was read.
3. **Send** sends what was read: the tournaments of the season with their rounds, only three days after their first, so
   one still running isn't sent half, and the season's rank. Earlier seasons aren't sent: the site shows their rounds
   nowhere on the profile.

`alps-content.ts` runs on every page of the site (it changes its address without loading a page, so the script looks
again when the address changes) and reads only your profile, and nothing until an app is connected for a pro's pages.
It keeps the reports of the profile you read last, merged (another player's profile replaces them), in the extension's
own storage. Prize money is never read. It sends the site nothing and opens no page itself; since 0.21.0 **Fetch all**
(below) picks the three reports for you. The companion app reads the Alps Tour in its own window the same way since its
0.9.0 (`apps/companion/README.md`).

### Fetch all on every tour

Since 0.21.0 (decision 57 of the target's owner; `run` and `tour-runs` of
[`@glmsync/provider-tours`](../../packages/provider-tours/README.md), `RunKeeper` of `@glmsync/browser/runs`,
`tour-run.ts` here). Where you pick a part at a time on your own pages, the line has **Fetch all** beside *Send*, and it
does those picks for you, one step at a time, in the tab you tapped in:

- **Alps Tour**, on your profile: *This Season record*, *Results* and *Order of Merit* under *Select Report*.
- **europeantour.com**, on any of your pages: your overview of the DP World Tour and of the HotelPlanner Tour, *Wins &
  Results* with each season of the last two years picked in its select, *Stats* with each tour picked.
- **Ladies European Tour, LET Access Series**, on your profile: each season of the last two years, then each of those
  seasons' Order of Merit.
- **pgatour.com, lpga.com, epsontour.com**, on your *Results* or *Stats* page: each season of the last two years in the
  page's own *Season* picker (on pgatour.com for the PGA Tour and the Korn Ferry Tour, picked in *Tour*), on *Results*
  and then on *Stats*.

Each page is read exactly as when you pick it yourself. A person's pace: 6-10 s after each page's answer, at most 30
steps, three runs a day per tour; a season you didn't play is skipped. The line says *Fetching all for you: step n of m*
with **Stop**. At the end (or on *Stop*, or when the tab closes) what was read goes out once: the tournaments of the last
two years, at most 50. Another player's page opened in the meantime stops it, and then nothing goes. The run is planned
from your page's address, opens only your own pages of that site (by the site's own addresses) and picks only in the
page's own pickers; it asks the sites nothing of its own. The companion app does the same in its own window since its
0.11.0 (the same plans, keeper and pace; the pick by its page script with the same steps, `operate.pickSettled`).

## The bridge on the app's page

[spec/page-bridge.md](../../spec/page-bridge.md). A small content script (`bridge-content.ts`) goes on the pages
of each connected app's address - the address you allowed when connecting, so no new permission - registered at
run time for those addresses only, top frame only, and removed with the connection. The app's page can ask where
the extension stands (`state`: the sign-in, whether it is fetching) and to **fetch now** (`fetch`): a manual sync of
that app's connection (since 0.8.0, spec 1.12.0, one with reason `open` when the app says you came back to it - the
app's plan then decides), the plan first and the guard as always, not again within 10 s, answered `started` and then
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
