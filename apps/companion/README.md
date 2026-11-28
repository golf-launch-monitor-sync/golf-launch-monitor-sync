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
  "Is this you?" names the account (through the load guard, like every request). With the key the script hands on
  the window's own User-Agent (`navigator.userAgent`, read anew at every sign-in and quiet renewal), which is kept
  beside the key and sent with every call to the provider: a call from this phone carries the User-Agent of the
  browser the player signed in with, nothing else (no cookies, no `Origin`, no `Referer`).
- **Fetches with the engine** ([`@glmsync/engine`](../../packages/engine/README.md)): pairings, the sign-in kept on the
  phone, a sync per pairing, the older history chunk by chunk, the background run. Another app can embed the same
  engine; what is this app's own is the screens, the sign-in window, golf.de, the tours, the rankings and the wake.
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
  *Connect new* (German *Neue Verbindung*, which doesn't read as *reconnect*; 0.14.0) and one row per provider account,
  per connection in test mode, golf.de's record and a pro's world ranking pages, each with where
  it stands; a row opens its details (`Home`'s `focus`). *Connect new* without a pair link says to start in the app
  (and offers the demo). A pairing its app ended (the token refused, or disconnected there) stays as a row of its own,
  *No longer connected with <app> – pair again there* (0.14.0, `Pairings.end`): only that app can start a pairing, so
  the list says where. The row goes when that app pairs again, or with *Remove from the list* in its details.
- **Connects as steps** (`@glmsync/browser`'s wizard, the same as the extension's; `src/lib/wizard.ts`,
  `src/ui/WizardFrame.tsx`), one button each: *Connect with <host>* (the pair link) with what to connect, sign in, *Is
  this your account?* (its name and newest activity - no count), the first
  data shown plainly (*10 sessions, 6 rounds fetched*, how much older data is still to come), and done. Paired but
  never signed in here, the home page says so big (*Not yet connected with … – sign in at Trackman*) instead of a card
  that looks as if things were running. Each step only its own content (`stepParts`): on *Is this your account?* the
  account and yes or no. golf.de the same: *Is this your golf.de account?* (its handicap index) in the
  window's bar and on the home page's card; nothing goes to an app before the yes.
- **The first sync before going back**: after signing in the app stays in front showing that it fetches until the
  first sync is through (at most two minutes; `firstSync` of the engine): iOS suspends an app in the back within seconds,
  so a first sync left running behind a jump brought nothing. The step says at once that the player is done
  (*Done – fetching your data …*), with *Back to …* where the target named a way back (the player taps it; the app
  doesn't jump), else *OK*, and the sentence that the rest comes by itself; going back sooner leaves the rest to the
  phone and the target's wake. The older history follows a chunk at a time while the app is open.
- **Syncs only when a target's plan says so**: on opening the app (`open`), after pairing or signing
  in (`connect`), on "fetch now" and on a sync link (`manual`), when a target app binds on Android
  (`open` or `manual`, as it says), and in the background (`timer`,
  `expo-background-task`: Android's WorkManager about every 30 minutes, iOS as often as it starts the
  app for it). Each asks the plan first; the provider is asked only when it is due, and never past the
  [load guard](../../spec/guard.md), whose counts outlive restarts. The older history comes a chunk at
  a time while the app is open, spaced as the target says; in the background one chunk per run on Android and per
  wake, and on the iPhone chunk after chunk while iOS lets the app work ([below](#the-older-history-at-night)).
- **One sync at a time, and a tap joins it** (the engine's `runner.ts`): "fetch now" or a sync link while a sync is
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
- **Loads the older history at night on the iPhone** (companion 0.17.0, the engine's `longRun.ts`; [below](#the-older-history-at-night)):
  while iOS lets the background task work, the history goes on chunk after chunk, each after the target's plan and pause,
  until it is through, ten minutes are up, iOS ends the task or the player opens the app. iOS ending it in the middle of
  a chunk stops it there; that chunk hands nothing over and comes again with the next plan, so nothing reaches a target
  twice. The exported log shows the last runs (`background_runs`).
- **Says what keeps iOS from waking it** (companion 0.16.0, `src/lib/wakeHints.ts`, `src/ui/WakeHints.tsx`): on the
  iPhone with a pairing, one sentence when *Background App Refresh* is off (with *Open settings*, the app's own page
  there) or restricted (Screen Time, a managed phone), or Low Power Mode is on (that one first: it turns background
  refresh off for every app). It closes with ×, stays away a day and comes back while the cause stays; another cause
  is said at once. `expo-background-task`'s status can't tell (on a phone it answers *available* whatever the switch
  says), so the state comes from the app's own module `modules/glmsync-power` (`backgroundRefreshStatus`,
  `isLowPowerModeEnabled`, a native part: only builds made after it have it); a build without it says nothing. And once, after the first pairing, not to swipe the app
  away in the app switcher: iOS then wakes it no more until it is opened. Nothing of this goes to a target.
- **Tells the target where its sign-in stands** with every plan (spec 1.5.0, `signin`): `ready` with a
  sign-in it can fetch with, `expired` when it ran out here, `none` when there never was one on this
  phone - and `other` (by a status, no lease) when the target has another account connected.
- **Jumps back** after `glmsync://sync?return=…` - only to an address that starts with a prefix the
  paired target named as its own at pairing; otherwise it stays and says what it did. A pair link's
  `return` (spec 1.2.0) the same way, once paired: right away when signed in already, else after the
  sign-in ("Then back to *name*"), and only to a prefix the target named in its answer to the pairing. Since spec
  1.18.0 (companion 0.12.0) golf.de's record and a pro's pages too: *Back to …* in their window.
- **Keeps a link's focus** (spec 1.18.0, [deep-links.md](../../spec/deep-links.md), *The focus of a link*;
  `src/lib/done.ts`): a link shows only the kind it came for, from its first step to *Done* - a launch monitor link
  only the launch monitors it names (one button each where it names several), golf.de's only golf.de. Where *Done* can't
  jump back (no `return`, an address the target didn't name, the app gone), it shows that one connection's card with
  *Done*, not the list; the list comes when the player opens the app themselves (also once it went to the back). A sync
  link without `return` whose sign-in has run out goes straight to the sign-in rather than a page of results saying so
  (0.14.0, `signInAfterLink`; the target heard `auth_expired` first, as always), then the first sync and that card.
- **Fetches without a switch on Android**: a target app in front binds to the sync service
  (`glmsync.intent.action.SYNC`, [spec](../../spec/deep-links.md#android)); every bind runs a sync of
  that target's pairings as a headless JavaScript task (`modules/glmsync-sync`, `src/nudge.ts`), in
  the same queue as the screen's runs, the plan first. Only a paired target, one at a time per target
  and not again within ten seconds (`src/lib/nudge.ts`); nothing comes back over the binding.
- **Shows the counts** ("requests today 14 of 300"), and **exports the guard's log** of the last 14 days
  (times, kinds, statuses, durations - never content) through the share sheet, with the last background runs beside
  it (`background_runs`, companion 0.17.0).
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
  only; its `return` since 1.18.0, when the target names return prefixes), then opens golf.de in the app's own window
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
- **Takes one tournament from golf.de's page** (spec 1.19.0, companion 0.13.0, [hcp.md](../../spec/hcp.md), *Taking one
  tournament*): when the player opens a tournament's page of golf.de's calendar in the window (club, regional federation
  or DGV), the bar offers *Add to …* for each app connected for golf.de. The page script (on the calendar's pages only,
  `onCalendarPage`) says whether the page is a tournament's once its lines are there; on the tap the app asks the page
  (`takeScript`), which reads that page's lines under *Turnierinformationen* by their label and posts that one
  tournament (`@glmsync/provider-golfde/event`); the app reads it again (`readEventMessage`, `HcpClient.takeEvent`) and
  sends it to that app, saying what came of it (*Added to your calendar in …*, *Already in …*, or the refusal in words,
  `src/lib/eventTake.ts`). Nothing without the tap, never on a list or a result list, never in the unseen window; it
  asks golf.de nothing, and the registration box beside the lines is never read.
- **Sends a pro's world ranking page** (spec 1.15.0, [prores.md](../../spec/prores.md)): a pair link with `kind=pro`
  asks "Connect with *host*" for the world ranking (*Connect world ranking* is the yes; provider `pro` only, its
  `return` since 1.18.0), then opens the app's own window on the sites (`src/ui/RankingsView.tsx`): the OWGR for men, the Rolex
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
  (`src/lib/etSession.ts`). *Fetch all* since 0.11.0 (below). A read is
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
  a new page. *Fetch all* on her profile since 0.11.0 (below). A profile is taken only of the profile the window shows, a
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
  window opens on that page next time. *Fetch all* on *Results* and *Stats* since 0.11.0 (below).
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
  window opens on his profile next time. *Fetch all* on his profile since 0.11.0 (below).
  **Fetch all on every tour** (companion 0.11.0; decision 57 of the target's owner, the extension's *Fetch all on every
  tour* since its 0.21.0): where he picks a part at a time - the Alps Tour's reports, europeantour.com's seasons and
  tours, the LET's seasons and Orders of Merit, the season pages' seasons and tours on *Results* and *Stats* - *Fetch
  all* in the bar does those picks for him, in the window, one step at a time. The run is the extension's: planned only
  from the window's address on his tap (`runPlanOf`), kept by its `RunKeeper` (`@glmsync/browser/runs`, three runs a day
  per tour, the window being its one tab), at its pace (6-10 s after each answer, 30 s for an answer, three without one
  end it, at most 30 steps); it opens only his own pages there (`runMayOpen`, checked before each open) and picks only in
  the page's own pickers. A pick is the page script's second function (`pickScript`): it picks as a person does, with the
  extension's very steps (`operate.pickSettled`: a `<select>` set with `input` and `change`, a picker the page draws
  pressed and its entry chosen, then waited for until the new table shows), and posts only how it went
  (`readPickAnswer`: `picked`, `already`, `absent`, `missing`); the page's own `change` of that pick isn't told the app
  as his. After each pick, and on each page the run opened once it has loaded, the app asks for the read as always and
  keeps it as always (the season pages' reads in the extension's `SeasonKeeper` until the run ends). At the end (or on
  *Stop*, or when the window closes) what was read goes out once, within the reach (the last two years, at most 50
  tournaments, `run.withinReach`); another player's page opened meanwhile ends it, and nothing goes. While it runs the
  bar says *Fetching all for you: step n of m* with only *Stop*; the window's own reads and *Send* wait. A run of a
  window that is gone (the app was closed during it) ends when a window opens again; what it read stays kept. The run
  without the window lives in `src/lib/pickRun.ts`, each tour's part in its session.
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

- **iOS** suspends an app within seconds of going to the back. A silent push (the wake `lm_plan`,
  [spec/wake.md](../../spec/wake.md)) gives it about half a minute, the background task (a `BGProcessingTask`, below)
  minutes, but when iOS chooses - mostly at night on the charger -, not when the record is due; a `WKWebView`'s page stops with the app, and WebKit even suspends the page of a web
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

## The older history at night

Found out for SY-16: a new player's history (years of sessions, a chunk of ten every minute or two)
took days of opening the app on the iPhone, since a wake gives half a minute, one chunk.

- **`expo-background-task` is already the right kind of task.** On iOS it submits a `BGProcessingTaskRequest`
  (`processing` in `UIBackgroundModes`, the network required, external power not), at the earliest `minimumInterval`
  (30 minutes) after the last run, and completes it only when the JavaScript task has ended. iOS runs such tasks mostly
  while the phone charges and nobody uses it, and gives them minutes. So no task of our own: the same task does more.
- **What it does there** (`backgroundWork` in the engine's `longRun.ts`, run by `src/background.ts`): the regular look
  (`timer`) first, then `Runner.backfill` chunk after chunk - each asks the target's plan (`backfill`), so its size, its
  pause (`wait_s`) and its limits are the target's and the guard's, unchanged - with the pause between them (at least
  5 s). It ends when no chunk is due within half an hour (the history done, or the guard holding), after **10 minutes**
  (`LONG_BUDGET_MS`: no chunk starts that wouldn't end by then, counted with the longest chunk so far, at first 90 s;
  no pause is slept after which none would fit), when iOS ends the task, or when the app comes to the front (its own
  loop goes on from there).
- **When iOS ends the time**: its expiration handler is the only word, and `expo-background-task`'s module drops it on
  the way to JavaScript (SDK 58: it looks for a `url` the handler never sends), so its `addExpirationListener` never
  fires. `modules/glmsync-power` listens to the same notification (`onTasksExpired`) and sends `onTaskExpired`
  (`onTaskExpired` in `src/power.ts`); either stops the run: the runner's chunk ends as `cancelled`, handing nothing over,
  and the next plan of this client takes its own lease over and asks for those sessions again (spec/planning.md, *The
  lease*). A request cut off halfway is covered by the guard's in-flight mark. `src/lib/native.test.ts` reads the
  installed package and fails if an upgrade changes any of this.
- **Android** keeps one chunk per run: WorkManager gives up to ten minutes but says nothing before it stops, and its
  timer comes every half hour anyway.
- **Measured** (one night on an iPhone on the charger, 27/28 Nov, 0.17.0): iOS started the task all night, every half
  hour (the earliest `minimumInterval` allows), and let a run work **20 s to about a minute** before ending it (one run
  that finished by itself took two minutes; one in the morning got five) - never the ten. At night its end mostly never
  reached the run: `expo-background-task`'s expiration handler posts the notification and completes the task at once, the
  app is suspended, and of six runs cut so one heard `onTaskExpired` only on the thaw, an hour and a half later, the
  others not at all (the morning run heard it in time). So they froze in the middle of a chunk or a pause and went on when
  iOS next woke the app, often only with the next task half an hour later, and then ended `budget` with 30 minutes, as if
  they had worked the ten. Nothing broke by it:
  the thawed chunk handed over what it fetched, the target kept each session once, and the runner's one queue kept the
  thawed run and the new one from fetching side by side. What ended the history that night was the
  [guard](../../spec/guard.md)'s day (300 requests in 24 hours, much of it spent by day): from then on each run asked
  nothing and ended `done` within seconds, until the oldest requests left the window in the morning - as the guard means
  it (a long history over days, not one night).
- **Since 0.23.0 it tells what the system allows** with every plan and status (spec `env`, `power` and on a status since
  1.29.0; `src/env.ts`, engine 0.7.0's `systemEnv`): the background task's status, on the iPhone Background App Refresh
  and Low Power Mode (`glmsync-power`), on Android that it keeps no push address. The target app can then name the one
  setting in the way; nothing of the player goes with it.
- **Since 0.21.1 a frozen run says so** (`LongEnd` `frozen`, engine 0.5.0): a step that comes back more than five minutes
  past the run's time (`FROZEN_SLACK_MS`; iOS's next task comes half an hour later at the earliest) can only come back from
  such a freeze; the run ends there, its `ms` the time it was seen working, up to the step it froze in (so at least what
  iOS gave), nothing more is started and nothing is done afterwards. iOS's word heard only on the thaw counts as frozen
  too. The step's own result stands. The exported log's `background_runs` (the last 20: when, how long, how many chunks,
  how each ended: `done`, `budget`, `expired`, `frozen`, `front`, `failed`) shows it. The ten minutes stay: iOS ends the
  runs long before them, and a shorter time would change nothing; `expired` or `frozen` with a short `ms` is the normal
  night on an iPhone.

A build older than 0.17.0 has no `onTaskExpired`: there the ten minutes still bound the run, and iOS ending it sooner
freezes it in the middle of a chunk, which the next plan repairs the same way.

## Signing in for an app that fetches itself

Since 0.20.0 (spec 1.27.0, [spec/deep-links.md](../../spec/deep-links.md#signing-in-for-a-target)). An app may fetch your
data itself, on this phone, with this project's engine built in. The sign-in at the provider still happens here: that
app shows none. It asks with a signin link (or a pair link with `mode=signin`) and a key of its own; this app answers by
the way back that app named when it paired - nowhere else - with your sign-in sealed so that only that app can read it
(`lib/handover.ts`, `ui/HandoverView.tsx`):

- a key that runs out within three days (or was kept without its browser's User-Agent) is renewed quietly first, as at
  the opening; where that can't be done, you sign in and confirm the account as always;
- a key of another provider account than the one that app connected is never handed over (`other_account`);
- the connection is then one that only signs in (`mode: signin_only`, until that app's plans say otherwise): this app
  fetches nothing for it - no first sync after pairing, nothing in the background, no history, a wake asks nothing for
  it - and shows on its card that the app fetches itself. Opening this app or *Fetch now* still asks its plan, so the
  app can say when this one is to fetch again.

**Test mode** (since 0.21.0, spec 1.28.0, [spec/test-mode.md](../../spec/test-mode.md#only-signing-in-for-a-target)):
in that app's question, small under the sign-in, *Enter a test code* (or scan that app's test QR with the camera while
the question is open: its link brings the code here). The scenario comes from that app with this app's pairing, *Is this
your account?* as always, then the code goes over sealed as a test sign-in (`test: true`, the scenario's made-up account,
running out after its `signin_valid_s`, this phone's browser's User-Agent read from an empty web view - Trackman's page
is never opened). At every later question of that app it goes over again with a new end, without asking, while the test
lasts; the connection's card says so and has *End test mode*. A test link outside a question, at a connection that only
signs in, says to start the test in that app. Nothing is fetched here for it, and no new native build is needed.

The seal's secret key is this app's own, made for each answer: from the phone's random source where React Native has
one, always mixed with the pairing's import token and the question, so that it is never one an outsider could know.
Android's binding has no part in it; the link is the way on both phones, and it needs no new native build.

## Universal links

Since spec 1.22.0 the pair and sync links also have an `https` form,
`https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/pair#…` and `…/link/sync#…` (since 1.27.0
also `…/link/signin#…`; the files of `tools/link-files.mjs` name it, so the host's copy is written anew)
([spec/deep-links.md](../../spec/deep-links.md#universal-links)): a phone opens this app for them where it is installed,
and the web app's page where it isn't ([apps/web](../web/README.md)). Three parts, of which the spec and the page are
built:

1. **The host vouches for the app**: `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` at
   the root of `golf-launch-monitor-sync.github.io` - the organisation's own site (the repository
   `golf-launch-monitor-sync/golf-launch-monitor-sync.github.io`, public, Pages from its `main`), since the web app lives
   below the root. `node tools/link-files.mjs <that repository>` writes both and `.nojekyll`; `assetlinks.json` needs
   the SHA-256 fingerprint of the Android signing certificate (`GLMSYNC_ANDROID_CERT_SHA256`, expo.dev › the project ›
   Credentials › Android). Apple's CDN reads the file some hours after it changes.
2. **The app names the host** (a new native build, not an update over the air): `ios.associatedDomains`
   (`applinks:golf-launch-monitor-sync.github.io`) and an Android intent filter with `autoVerify` for `https`, that host
   and the path prefix `/golf-launch-monitor-sync/link/`, in `app.config.ts`; the App ID gets *Associated Domains*.
3. **The app reads them**: `parseUniversal` of `@glmsync/spec`, which answers what `parseLink` answers for the
   `glmsync://` form (`lib/links.ts` reads an `https` address so since 0.20.0).

Until all three stand, the page's *Open Golf Stats Sync* opens the app by its scheme.

## What it keeps, and where

| What | Where |
| --- | --- |
| The provider sign-in (and the account it was of, for the quiet renewal), with the sign-in window's User-Agent | the secure store (Keychain / Keystore), readable after the first unlock, this device only; cut into pieces where long (`ChunkedSecrets`) |
| Each pairing's import token | the secure store |
| Whether a pairing only signs in for an app that fetches itself (spec 1.27.0) | app storage, with the rest of the pairing |
| The secret key of a sealed answer (spec 1.27.0) | memory only, for that one answer |
| A test sign-in for an app that only asks this one to sign in (spec 1.28.0): the test code, the made-up account, the test's end, this phone's browser's User-Agent | the secure store, per pairing; which pairings have one in app storage; until the test is over, the pairing ends or *End test mode* |
| The rest of a pairing (address, name, limits, return prefixes), the guard's counts and log, the last run per pairing | app storage (AsyncStorage) |
| The last 20 background runs: when, how long, how many history chunks, how each ended (nothing of the player) | app storage; in the exported log |
| A pairing its app ended: which app and provider, when (no token, no address; the last ten) | app storage, until that app pairs again or the player removes the row |
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
| *Fetch all* on the other tours (since 0.11.0): the run going on in the tour window with its steps, and the starts of each tour's runs of the last day (the extension's `RunKeeper`) | app storage; a run ends at its end, on *Stop*, when the window closes, or when a window opens after the app was closed during it |
| The season pages (PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour) a run of *Fetch all* read, merged per tour (the extension's `SeasonKeeper`) | app storage, until the run ends and they go out (or another player's page ends it); a new run starts without them |
| The sites' cookies (a consent banner's choice) | the window's web view, on this phone |

Android backups leave the secure store out (`allowBackup: false`). A sign-in goes to the provider
only; a target gets batches and nothing else (the engine's `runner.test.ts` checks both directions). A
target that disconnects, or revokes the token, ends the pairing here (its row says so until it pairs again); with the
last pairing of a provider the sign-in goes too.

## Layout

```
index.ts            entry: the background task and the Android sync task first, then the screen
app.config.ts       ids (from the environment for forks), scheme glmsync, EAS project and updates
src/lib/            everything without a screen, tested with vitest: secrets, sign-ins, pairings,
                    links, the runner (pair, sync, history, file, "Is this you?"), test mode (tests),
                    the Android sync service's rules (nudge), whether a new build is out (newBuild),
                    golf.de's Fetch all (fetchAll) and when it runs by itself (autoFetch), what keeps iOS
                    from waking the app (wakeHints), the background task's work (longRun), signing in for an
                    app that fetches itself (handover), the wording
src/ui/             the screens: App (links, opening, quiet renewal), Home, PairView, SignInView, HandoverView,
                    FirstSyncView, SyncView, TestView, Licenses, TrackmanLoginView, PairHcpView, GolfdeView,
                    UnseenGolfde (the window behind the screen), HcpCard, PairProView, RankingsView, ToursView,
                    ProCard, WakeHints
src/platform.ts     the phone's parts: secure store, storage, files, share sheet
src/background.ts   the background task
src/nudge.ts        the headless task behind the Android sync service
src/power.ts        Background App Refresh, Low Power Mode and the end of the background task's time, from
                    modules/glmsync-power (iOS)
modules/glmsync-sync  the Android sync service (Kotlin, a local Expo module; its manifest adds the
                    service to the app)
modules/glmsync-power  Background App Refresh and Low Power Mode on the iPhone, and iOS ending the background
                    task (Swift, a local Expo module; since 0.16.0 and 0.17.0, in builds made after them)
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

**Updates in the background** (since 0.19.0): after a background run, with the time left, and after a target's nudge,
the app asks the update server and downloads what is there (`src/update.ts`, the rules in `src/lib/otaUpdate.ts`): at
most every six hours, never applied there - Expo calls downloading in a background task safe and reloading there
experimental, so the update applies at the next start. Without it a player who never opens the app would run an old
version for weeks, and a target that needs a newer one (`outdated`, spec 1.22.0) would get nothing meanwhile.

**The version a target sees** is `version` in `app.config.ts` (sent at pairing, with every plan as `version` since
0.19.0, and with every batch as `generator`). A target that needs a newer one answers the plan `outdated` and gets
nothing until the update.

**"Too old" on the screen** (since 0.22.0, engine 0.6.0): a plan with `outdated` is a run of its own
(`status: 'outdated'`, with the version it was said of), over the last result rather than beside it, and before a
sign-in that ran out (signing in again wouldn't help first). The list's row says *Update needed*; the connection's card
says *<app> needs a newer version of this app.* with **Update now** (`src/lib/outdated.ts`, `updateNow`): an update over
the air is downloaded and applied at once (in the foreground, at the player's tap, a restart is safe), else the new
build opens (the APK, TestFlight: `newBuild.ts`), else it says nothing newer is out yet - not held back by the
background's six hours. It holds only while that version runs: once another one does, the next plan says how it goes.
A sync link's way back carries `result=outdated` (spec 1.22.0, *The result in the way back*; the other results too,
`wayBack`).
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
