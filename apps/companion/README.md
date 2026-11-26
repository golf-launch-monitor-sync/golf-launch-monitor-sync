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
  A pair link only asks: "Connect with *host*" shows the address the data would go to, and nothing
  happens without the player's yes - the tap on *Connect launch monitor* (any app or page can open such a link).
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
- **Opens on the list of connections** (`src/lib/connections.ts`, `src/ui/Connections.tsx`, as in the extension):
  *Connect new* and one row per provider account, per connection in test mode, golf.de's record and a pro's world
  ranking pages, each with where
  it stands; a row opens its details (`Home`'s `focus`). *Connect new* without a pair link says to start in the app
  (and offers the demo).
- **Connects as steps** (`@glmsync/browser`'s wizard, the same as the extension's; `src/lib/wizard.ts`,
  `src/ui/WizardFrame.tsx`), one button each: *Connect with <host>* (the pair link) with what to connect, sign in, *Is
  this your account?* (its name and newest activity - no count), the first
  data shown plainly (*10 sessions, 6 rounds fetched*, how much older data is still to come), and done. Paired but
  never signed in here, the home page says so big (*Not yet connected with … – sign in at Trackman*) instead of a card
  that looks as if things were running. Each step only its own content (`stepParts`): on *Is this your account?* the
  account and yes or no. golf.de the same: *Is this your golf.de account?* (its handicap index) in the
  window's bar and on the home page's card; nothing goes to an app before the yes.
- **The first sync before going back**: after signing in the app stays in front showing that it fetches until the
  first sync is through (at most two minutes; `src/lib/firstSync.ts`): iOS suspends an app in the back within seconds,
  so a first sync left running behind a jump brought nothing. The step says at once that the player is done
  (*Done – fetching your data …*), with *Back to …* where the target named a way back (the player taps it; the app
  doesn't jump), else *OK*, and the sentence that the rest comes by itself; going back sooner leaves the rest to the
  phone and the target's wake. The older history follows a chunk at a time while the app is open.
- **Syncs only when a target's plan says so**: on opening the app (`open`), after pairing or signing
  in (`connect`), on "fetch now" and on a sync link (`manual`), when a target app binds on Android
  (`open` or `manual`, as it says), and in the background (`timer`,
  `expo-background-task`: Android's WorkManager about every 30 minutes, iOS as often as it wakes the
  app). Each asks the plan first; the provider is asked only when it is due, and never past the
  [load guard](../../spec/guard.md), whose counts outlive restarts. The older history comes a chunk at
  a time while the app is open (and one chunk per background wake), spaced as the target says.
- **One sync at a time, and a tap joins it** (`src/lib/runner.ts`): "fetch now" or a sync link while a sync is
  queued or under way waits for it and takes what it brought (*Waiting for the fetch under way …*); only if it
  fetched nothing (not due, another device holds the lease) does the tap ask a plan of its own. A plan that is busy
  or not due goes beside the last real result (*8 new sessions · 11:18: the browser extension on your computer is
  fetching, since 11:17*), never over it: the target names who holds its lease (spec 1.13.0), and since the lease
  is this app's own when it asks again, "another device" is never this phone.
- **Can be woken on iOS** (spec 1.9.0, [wake.md](../../spec/wake.md)): iOS wakes a background app when it likes,
  so each paired target hears this phone's Expo push address (`PUT /wake`, `src/lib/wake.ts`; again when it changes
  and weekly, a target without a wake left be for a week). A target that can push to it sends a silent push
  `{"kind": "lm_plan"}` when a plan is due; the app then does what its timer does - each plan with `timer`, one
  history chunk - at most once in five minutes (`src/wake.ts`, `expo-notifications` with
  `enableBackgroundRemoteNotifications`). It shows no notification and asks no permission for one; Android
  registers no address (its timer and the sync service do the job). Switched off with iOS's *Background App
  Refresh* for the app, or by unpairing.
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
- **Test mode** (spec 1.8.0, [test-mode.md](../../spec/test-mode.md)): for testing a connected app by hand, the
  app's test code instead of the sign-in - *Enter a test code*, small under Trackman's sign-in (the sign-in window's
  bar, step 3 on the home page, a connection's card while it isn't signed in), or brought by its link
  `glmsync://test?code=…` (a QR code on the app's test page opens it) - for one of this phone's pairings; a test code
  never pairs (without a pairing: "connect with the app first"). The scenario comes from that app with the pairing's
  import token (`GET /test-scenario`, the code in its header); "Is this your account?" asks about its made-up
  account through the guard, and only after the yes does the pairing sync from it - the real Trackman provider code
  against the made-up Trackman (`replay` in `@glmsync/provider-trackman`), at the scenario's response times, the plan
  first, through the guard under the scenario's own account, every batch marked `test: true`. The first sync runs
  while the app is in front, then the history a chunk at a time, in the background too. Nothing is asked of Trackman;
  a real sign-in and other pairings go on as before. A *test mode – made-up data* card on the page shows it, with
  *End test mode*; the scenario goes with that, with its pairing, or when its `valid_until` has passed
  (`Tests` of `@glmsync/provider-trackman`, shared with the browser clients). Each way it can fail has its sentence in German and English (wrong or expired code, no test
  account, an app without test mode, a provider this app lacks, no network, a real account refusing test data).
- **Reads along on golf.de** for the handicap record (spec 1.10.0/1.11.0, [hcp.md](../../spec/hcp.md), *A client that
  only observes*): a pair link with `kind=hcp` asks "Connect with *host*" for the handicap record (*Connect handicap record* is the yes) (provider `golfde`
  only; no `return`: a handicap pairing names no return prefixes), then opens golf.de in the app's own window
  (`src/ui/GolfdeView.tsx`) - golf.de's History Sheet, loaded as this web view is, nothing added; the player signs in
  there. The extension's page script (`@glmsync/provider-golfde/page`) is injected before golf.de's own scripts, only
  on the pages the extension reads too (`src/lib/golfdePage.ts`, `onReadPage`), and posts what golf.de's page loaded,
  already without names and numbers; the app reads every message again strictly (`readGolfdeMessage`, only from
  `www.golf.de`) and keeps it with the extension's `HcpClient` (`src/lib/hcp.ts`: the pairings in the secure store,
  whose golf.de account the pages named only in memory). It sends a little after the last new page, at once on
  *Done* or when the app goes to the back, or on *Send* (`HcpSender`); every batch after the target's plan (`manual`).
  The window shows the extension's line (*20 results seen · 3 new for …*); the home page a card with each connection,
  what it last answered, *Open golf.de*, *Send now*, *Send by itself*, *Disconnect*. A read link
  `glmsync://read?kind=hcp` (spec 1.11.0, from a target's reminder that the record is due) opens the window - only
  with a handicap pairing. What the app says plainly: Google or Apple sign-in often doesn't work in an app's window
  (e-mail and password do); nothing happens in the background (below); golf.de's own app isn't read. The window keeps every
  load in the app (`golfdeWindowRules`, as the Trackman window's).
- **Clicks through golf.de for the player** (spec 1.14.0, *Fetch all*): once signed in and the account confirmed, *Fetch
  all* in the window's bar opens every page of the History Sheet, the Scoring Record and the result lists of the last two
  years for them, at a person's pace (`src/lib/fetchAll.ts` drives `HcpClient`'s run; the page script takes golf.de's own
  pager and button), and sends once at the end; *Stop*, *Done* or the app going to the back ends it.
- **Does that by itself while it is open** (spec 1.17.0, companion 0.10.0; [below](#golfde-by-itself-what-the-phone-allows)):
  when the app comes to the front and a connected app's plan (`timer`) says the record is due, it runs *Fetch all* in a
  golf.de window the player doesn't see, behind its own screen (`src/ui/UnseenGolfde.tsx`, `src/lib/autoFetch.ts`); the
  home page's card says so, with the run's progress and *Stop*. Only while golf.de last said the player is signed in, with
  the account confirmed; it never signs in, and keeps one of the day's three runs for the player's tap. *Fetch all by
  itself* on the card switches it off.
- **Sends a pro's world ranking page** (spec 1.15.0, [prores.md](../../spec/prores.md)): a pair link with `kind=pro`
  asks "Connect with *host*" for the world ranking (*Connect world ranking* is the yes; provider `pro` only, no
  `return`), then opens the app's own window on the sites (`src/ui/RankingsView.tsx`): the OWGR for men, the Rolex
  Women's World Golf Rankings for women, loaded as this web view is, nothing added. The player searches for their name
  there and opens their own page; only then does *Send* appear in the app's bar. A page script (`scripts/rankings-page.entry.ts`,
  bundled into `src/lib/rankingsPageScript.ts`) gives the page one function and nothing else: on *Send* the app calls it
  with a fresh ask, and it reads the page as it shows - the extension's very reading (`@glmsync/provider-rankings`),
  OWGR's table waited for a little - and posts it back. It reads nothing before the tap and sends the sites nothing.
  The app takes only an answer to its open ask, from the player's page the window shows, read again strictly
  (`readRankingMessage`), and sends it with the extension's `ProClient` (`src/lib/pro.ts`) to each connected app after
  its plan (`manual`). When an app finds another name on the page, *Is this page yours?* is asked right in the app's bar
  (the site's page can't reach it) and on the connection's card. The window opens on the page last sent from here, else
  asks which ranking; it keeps every load in the app (`rankingsWindowRules`). A read link `glmsync://read?kind=pro`
  opens the window - only with a pairing of this kind. Nothing happens in the background.
- **Sends a pro's tour pages** (spec 1.15.0, `site: tour:<key>`; the Pro Golf Tour, and the DP World Tour and the
  HotelPlanner Tour below), with the same pairing: the
  app's own window on the tour's site (`src/ui/ToursView.tsx`), opened from the home page's card (*Open Pro Golf Tour*),
  from the world ranking window's choice, or by a read link when the page last sent from here was his tour profile;
  it opens on that profile, else on the tour's Order of Merit, loaded as this web view is, nothing added. On his own
  profile *Send* and *Fetch all* appear in the bar. A page script (`scripts/tours-page.entry.ts`, bundled into
  `src/lib/toursPageScript.ts`) gives the page one function: called with a fresh ask, it reads with the extension's very
  module (`@glmsync/provider-tours`) - on his profile his Order of Merit and his season's tournaments, on a tournament's
  page only his own line of the final result (by his profile's name, which the app hands in) and the field's size; the
  snapshot with everyone else's names never leaves the page script. *Send* reads the profile and sends his ranking with
  every tournament whose rounds were read; *Fetch all* reads the profile, then opens his finished tournaments' pages one
  by one in the window and reads his line on each, at the extension's pace and limits (`TOUR_CLICKS`: a pause of 6-10 s,
  at most 30 pages, three runs a day), and sends once at the end. What the window does lives in `src/lib/toursSession.ts`
  over the extension's own parts (`TourKeeper` of `@glmsync/browser/tours`, the run of `progolftourRun`, `ProClient`);
  the bar's words in `src/lib/toursText.ts`. The app takes only an answer to its open ask, from the profile or the
  tournament page the window shows, read again strictly (`readTourMessage`). *Stop* or closing the window ends a run and
  sends what it read; a run of a window that is gone (the app was closed during it) ends when the window opens again.
  Nothing is read before his tap, and nothing happens in the background. The window keeps every load in the app
  (`tourWindowRules`).
  **europeantour.com** (DP World Tour, HotelPlanner Tour; companion 0.5.0): one window for both tours (*Open DP World
  Tour*, *Open HotelPlanner Tour* open the site's list of players of each; one page per player has both), the
  extension's way there: once a page of his (`/players/<name>-<id>/…`) has loaded, the app asks the page script for a
  read (`europeantour.readPage` with the player's day the app hands in) and keeps it merged in the extension's
  `EtKeeper` (`@glmsync/browser/europeantour`); when he picks another season or tour in the page's own select, the page
  script only posts that he picked (`readPickMessage`: nothing read, nothing of his) and the app asks for the read
  1.5 s later. *Send*, on any page of his, reads it once more and sends a page per tour with something of it
  (`src/lib/etSession.ts`). No *Fetch all*: his *Wins & Results* page has the rounds, a season at a time. A read is
  taken only of the player whose page the window shows (`readTourMessage`), only with a connection for a pro's pages,
  only while the window is open.
  **The LET and the LET Access Series** (ladieseuropeantour.com, letaccess.com; companion 0.6.0): a window per tour
  (*Open Ladies European Tour*, *Open LET Access Series* open its list of players), the extension's way there: once her
  profile (`/player-profiles/<id>/`) has loaded, the page script reads her results of the season shown with every round
  (`ocs.readProfile`), kept in the extension's `OcsKeeper` (`@glmsync/browser/ocs`); on the tour's Order of Merit, once
  a profile of this tour was read, the app hands the page script that profile's id and takes only her line
  (`ocs.readOom`; the other lines stay in the page script). *Send* on her profile, or on the Order of Merit, reads the
  page once more and sends her profile with her rank of that season (`src/lib/ocsSession.ts`, the bar's words `ocsBar`).
  Both sites change their address without loading a page, which the web view doesn't always tell: the page script looks
  at the address every second and posts only that it changed (`readMovedMessage`), and the window takes its address as
  a new page. No *Fetch all*: her profile has the rounds. A profile is taken only of the profile the window shows, a
  line only from that tour's Order of Merit (`readTourMessage`), only with a connection for a pro's pages, only while the
  window is open.
  **The season pages** (PGA Tour and Korn Ferry Tour on pgatour.com, LPGA Tour, Epson Tour; companion 0.7.0): his
  *Results* page (`/player/<id>/<name>/results`, `/athletes/<name>/<id>/results`) shows the whole season with its rounds,
  so the window reads only on *Send*, as the extension: the page script reads the season the page shows then (the season
  he picked there, on pgatour.com the tour too) with the standing beside it (`readSeasonPage`, `figuresOf`), and the app
  sends that page (`src/lib/seasonSession.ts`, the bar's words `seasonBar`). Since 0.8.0 his *Stats* page (`…/stats`)
  the same way: *Send* there sends the season's statistics (`seasonStats` of `@glmsync/provider-tours`). The leaderboard of others that runs along
  pgatour.com's top stays in the page script. One window for pgatour.com's two tours (*Open PGA Tour*, *Open Korn Ferry
  Tour* open each tour's list of players; his page has both), a window each for the LPGA Tour and the Epson Tour. A tour
  of the site the module doesn't read (PGA Tour Champions, Americas) or a season with nothing finished yet: the bar says
  so. These sites move between their pages without loading them too, so the page script watches their address as on
  the LET's. A season is taken only from his *Results* page, only of the player whose page the window shows, only of a
  tour of that site (`readTourMessage`), only with a connection for a pro's pages, only while the window is open; the
  window opens on that page next time. No *Fetch all*: nothing needs opening.
  **The Alps Tour** (alpstourgolf.com; companion 0.9.0): a window of its own (*Open Alps Tour* opens the site's Order of
  Merit, where he finds his name), the extension's way there: his profile (`/playerprofile/<code>`) shows one report at a
  time under *Select Report*, and the report shown is read once his profile has loaded (`alps.readPage`, his name from
  the box above *Represents*) and again 1.5 s after he picks another (the page script only posts that he picked,
  `readPickMessage`: nothing read, nothing of his); the reports are kept merged in the extension's `AlpsKeeper`
  (`@glmsync/browser/alps`; another player's profile replaces them). *This Season record* brings his rounds, *Results* the
  par, *Order of Merit* his rank; the bar says which report to pick until his rounds were read, then what was read
  (`alpsNote`, the extension's words; `alpsBar`). *Send* on his profile reads the report once more and sends the
  season's tournaments that are over, with their rounds, and his rank (`src/lib/alpsSession.ts`). The site changes its
  address without loading a page, so the page script watches it as on the LET's. A report is taken only of the profile
  the window shows (`readTourMessage`), only with a connection for a pro's pages, only while the window is open; the
  window opens on his profile next time. No *Fetch all*: his profile has the rounds.
- **Demo**: a made-up player (`@glmsync/provider-demo`) for trying the app without an account, and
  for app reviews. Its "requests" go through the guard too, so counters and log behave as for real.
- **Save as file**: a sync into an olmd file (the share sheet), planned gently by the file target -
  only when asked.
- **Licences**: every package the app is made of, with its licence text (`scripts/licenses.mjs`
  writes `src/licenses.json` after every install).

## golf.de by itself: what the phone allows

Found out for TE-10b-6 (spec 1.17.0, *By itself, when the record is due*): a run of *Fetch all* takes minutes (a few
seconds' pause after each page, up to 60 pages of the History Sheet and 100 result lists), and it needs golf.de's page in
a web view. Neither phone gives an app that in the back:

- **iOS** suspends an app within seconds of going to the back. A background task (`BGAppRefreshTask`, which
  `expo-background-task` uses) and a silent push (the wake `lm_plan`, [spec/wake.md](../../spec/wake.md)) give it about
  half a minute, when iOS chooses; a `WKWebView`'s page stops with the app, and WebKit even suspends the page of a web
  view that isn't at least partly on screen (in the view hierarchy, with a size). So no run in the back, and the wake
  doesn't start one: it couldn't finish, and an app woken in the back has no screen to keep a window in.
- **Android** runs the background task (WorkManager, about every 30 minutes, at most ten minutes) and the sync service's
  task as JavaScript without any view: there is no web view to load golf.de in. Keeping one alive would take a native
  foreground service with a notification that never goes away, a new build and a store declaration - not for a once-a-
  day read of a web page.

So the app runs it **only while it is open**: a few seconds after it comes to the front (or starts), at most every half
hour, `HcpClient.autoDue({ spare: 1 })` asks the connected apps' plans, and only `due` opens golf.de's *Mein Bereich* in
a window the full size of the screen, behind it (so the phone treats it as shown; it takes no touch and isn't read out).
Its top frame loads only the pages read along on (`unseenWindowRules`): a sign-in page or golf.de's start page doesn't
load and ends the run as an early stop (held until the player is back on golf.de, as in the extension). The app going to
the back, the player opening the golf.de window, a page that doesn't load within a minute or the phone ending the page
interrupt it instead (`interruptFetchAll`: what was read goes out, no hold - nothing went wrong). Whatever ends it, the
window goes. Not seen on a real phone yet: whether golf.de keeps the sign-in of the player's window in this one (they
share the web view's cookies), and whether iOS lets a web view behind the screen load as one in front.

## What it keeps, and where

| What | Where |
| --- | --- |
| The provider sign-in (and the account it was of, for the quiet renewal) | the secure store (Keychain / Keystore), readable after the first unlock, this device only; cut into pieces where long (`ChunkedSecrets`) |
| Each pairing's import token | the secure store |
| The rest of a pairing (address, name, limits, return prefixes), the guard's counts and log, the last run per pairing | app storage (AsyncStorage) |
| A test scenario (made up, up to 64 MiB; test mode) | a file in the app's document folder, until the test ends; what the page shows of it (name, account, end) in app storage |
| Each handicap pairing with its import token | the secure store (one entry, `glmsync.hcp.pairings`, in pieces where long) |
| What golf.de's pages showed (results, the index; no names, no numbers), what each handicap target has from here, what it last answered | app storage |
| Which golf.de account the pages of this run named, and results waiting for it | memory only (gone when the app ends, as a browser session is) |
| golf.de's own sign-in | golf.de's cookies in the window's web view, on this phone; the app never reads them |
| Each pairing for a pro's pages with its import token | the secure store (one entry, `glmsync.pro.pairings`, in pieces where long) |
| What each of those apps last answered, an open *Is this page yours?* with its page (a day at most), fingerprints of pages said to be the player's | app storage |
| The address of the player's own ranking page, tour profile or page on europeantour.com last sent from here (where the window opens next time) | app storage, until the player disconnects the last app for a pro's pages here |
| His tour profile as last read, his own line of each tournament read, which tournament pages were opened when, the runs of *Fetch all* (the extension's `TourKeeper`) | app storage; another player's profile replaces it all |
| What his pages on europeantour.com showed, merged: his ranks, his tournaments with their rounds of the seasons he picked, his season statistics (the extension's `EtKeeper`) | app storage; another player's page replaces it all |
| Per tour of the LET's her profile of each season read and her line of each season's Order of Merit (the extension's `OcsKeeper`; one season only until 0.20.0 of the extension) | app storage; another player's profile replaces it |
| The reports of his Alps Tour profile he picked, merged: the season's tournaments with their rounds, the totals to par, his line per season of the Order of Merit (the extension's `AlpsKeeper`) | app storage; another player's profile replaces it all |
| The sites' cookies (a consent banner's choice) | the window's web view, on this phone |

Android backups leave the secure store out (`allowBackup: false`). A sign-in goes to the provider
only; a target gets batches and nothing else (`src/lib/runner.test.ts` checks both directions). A
target that disconnects, or revokes the token, ends the pairing here; with the last pairing of a
provider the sign-in goes too.

## Layout

```
index.ts            entry: the background task and the Android sync task first, then the screen
app.config.ts       ids (from the environment for forks), scheme glmsync, EAS project and updates
src/lib/            everything without a screen, tested with vitest: secrets, sign-ins, pairings,
                    links, the runner (pair, sync, history, file, "Is this you?"), test mode (tests),
                    the Android sync service's rules (nudge), whether a new build is out (newBuild),
                    golf.de's Fetch all (fetchAll) and when it runs by itself (autoFetch), the wording
src/ui/             the screens: App (links, opening, quiet renewal), Home, PairView, SignInView,
                    FirstSyncView, SyncView, TestView, Licenses, TrackmanLoginView, PairHcpView, GolfdeView,
                    UnseenGolfde (the window behind the screen), HcpCard, PairProView, RankingsView, ToursView,
                    ProCard
src/platform.ts     the phone's parts: secure store, storage, files, share sheet
src/background.ts   the background task
src/nudge.ts        the headless task behind the Android sync service
modules/glmsync-sync  the Android sync service (Kotlin, a local Expo module; its manifest adds the
                    service to the app)
scripts/            licenses.mjs (the licences page), release.sh (builds and updates at Expo),
                    golfde-page.mjs, rankings-page.mjs and tours-page.mjs (bundle the golf.de, world ranking and
                    tour windows' page scripts into src/lib/*PageScript.ts, with page-script.mjs)
```

## Development

```
pnpm install                                   # also writes src/licenses.json
pnpm typecheck && pnpm test                    # from the repository root
pnpm --filter @glmsync/companion bundle:check  # Metro bundles for Android and iOS (CI too)
pnpm --filter @glmsync/companion start         # Expo dev server (a development build; the
                                               # web view and the secure store need one)
```

After a change to `@glmsync/provider-golfde`'s page script (or `src/lib/golfdePage.ts`, or
`scripts/golfde-page.entry.ts`): `node apps/companion/scripts/golfde-page.mjs` writes `src/lib/golfdePageScript.ts`
again; a test fails until it is. The same for the world ranking window: after a change to `@glmsync/provider-rankings`,
`src/lib/rankingsPage.ts` or `scripts/rankings-page.entry.ts`, `node apps/companion/scripts/rankings-page.mjs`; for the
tour window, after a change to `@glmsync/provider-tours`, `src/lib/toursPage.ts` or `scripts/tours-page.entry.ts`,
`node apps/companion/scripts/tours-page.mjs`. There is deliberately no npm script for it: `package.json`'s scripts are part of the
app's native fingerprint, and a changed script keeps every update from the builds out there until a new build.

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
   distribution certificate if the team has one; let Expo make the App Store provisioning profile). Since the wake
   (spec 1.9.0) the app has the push entitlement: say yes to *Push Notifications* and reuse the team's APNs key (one
   key serves every app of the team) or let Expo make one. A profile made before the wake lacks the entitlement:
   run the same command once more, and the next build signs with the new one.
2. The App Store Connect API key that EAS Submit uploads with: `npx eas-cli@27 credentials -p ios`, profile
   `testflight`, *App Store Connect: Manage your API Key* → *Set up your project to use an API Key for EAS Submit*
   (an existing team key with the role App Manager, or a new one).

Then **Companion build** with `ios`. The build goes to App Store Connect by itself and on to the internal testers'
group in TestFlight. Apple asks no export compliance question: `usesNonExemptEncryption: false` in `app.config.ts`
writes `ITSAppUsesNonExemptEncryption = NO` into the build (the app uses only the system's HTTPS and keychain).
Until an iOS build exists, **Companion update** says for `ios` that a new build is needed and updates Android only.

**A fork** sets its own ids through the environment (`GLMSYNC_APP_ID`, `GLMSYNC_EXPO_OWNER`,
`GLMSYNC_EAS_PROJECT_ID`) and its own Expo project and store records.
