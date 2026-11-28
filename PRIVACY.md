<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Privacy

This covers the browser extension, the web app and the companion app of Golf Stats Sync (formerly Golf Launch Monitor
Sync). The store listings link here.

**In short: this project runs no server and receives nothing.** The tools run on your device; they move your launch
monitor data from your own account at the maker of your launch monitor (today Trackman), and your handicap record as
golf.de shows it to you, to an app you connect yourself (a *target*). Nobody behind this project sees your data, your sign-in or how you use the tools.

> Unofficial: not affiliated with, endorsed by or supported by any launch monitor maker, the DGV, golf.de, the OWGR, Rolex or any tour.

## What the tools handle, and where it goes

| What | Where it is kept | Where it goes |
| --- | --- | --- |
| Your sign-in at the provider (e.g. Trackman's), read from its own web portal or its sign-in page | on your device only: the extension's own storage, the phone's secure store | only to the provider's own API, to fetch your data; and (companion app, since spec 1.27.0) on the same phone to an app you connected that fetches itself with this project's engine, when that app asks for it: sealed so that only that app can read it, by the way back it named when you connected it, to be kept in its secure store on your phone. Never to a target's server, this project or anyone else |
| On a phone, the User-Agent of the sign-in window (the phone's web view: its browser engine, system version and device type, no name or number of yours), read with every sign-in and renewal | beside the sign-in in the phone's secure store, gone with it | with every call to the provider's own API (as the browser you signed in with would send it); with the sign-in, sealed, to an app on the same phone that asks for it (above), so its calls carry the same; never to a target's server, this project or anyone else |
| Your launch monitor data (practice sessions, shots, rounds) | only while it is being passed on; a file only if you save one | to the target app you connected, when its plan asks for it - and nowhere else |
| A connection: the target's address and name, its import token | on your device | the token goes to that target only |
| Where your sign-in stands (one of: none, waiting for your yes, signed in, run out, another account) | on your device | to the targets you connected, so their app can show you the next step; to the connected app's own page in this browser if it asks the extension (the extension's bridge) |
| On iPhone, the companion app's push address (an Expo push token for this app on this phone; since 1.9.0) | on your device | to the targets you connected, so a target that can push to this app may wake it when a sync is due ([spec/wake.md](spec/wake.md)). Such a wake is a silent push with nothing of yours in it (only "ask for the plan"); it passes Expo's push service and Apple's, shows nothing and asks no permission. Off with *Background App Refresh* for the app in iOS's settings, or by disconnecting |
| A connected app's test scenario, if you enter its test code (test mode, made up by that app, no one's real data; since 1.8.0) | on your device: a file of the companion app's own, IndexedDB of the extension or of the web app's address; until you end the test, its connection ends or the app's end date for it passes | nowhere: the made-up data it plays back goes, marked as test data, to that connected app only ([spec/test-mode.md](spec/test-mode.md)) |
| Your handicap record as golf.de's pages show it to you (History Sheet, Scoring Record, your own place in a result list, your index) - only once you connected an app for it, and only while you open those pages yourself, tap *Fetch all*, or - while you are signed in on golf.de and unless you switch it off - the app says your record is due (once a day at most): then the extension opens golf.de in a background tab itself and closes it again, and the companion app, only while you have it open, in a window you don't see (its home page says so, with *Stop*). It never signs in for you. The extension reads what golf.de's own page loaded; it asks golf.de nothing. Names (yours, a marker's, other players'), card and member numbers never leave golf.de's page | in the extension's own storage on your device: what was seen (up to 600 results), a fingerprint of what each app has, and fingerprints (not the ids) of the golf.de accounts you answered *Is this your account?* about; which golf.de account the pages showed only until the browser closes. Nothing goes to an app before your yes | to the app you connected for it (each batch after its plan), and nowhere else; your golf.de account only as a hash (`account_ref`) |
| A professional's own page of a world ranking (OWGR, Rolex Rankings) as it shows it to you: your rank, average points, divisor or events, and your tournaments with week, tour, place and points - only once you connected an app for it, and only when you tap *Send* on that page. The extension reads what the page shows; it asks the site nothing. The site's id of you never leaves as it is | in the extension's own storage, or the companion app's, on your device: what each app last answered, fingerprints (not the ids) of the pages you said are yours, and, until you answer it (a day at most), a page an app asked about | to the app you connected for it (after its plan), with the name the page writes so the app can check it is yours, and nowhere else; the page's id only as a hash (`account_ref`) |
| A professional's own pages on europeantour.com (DP World Tour, HotelPlanner Tour) as they show them to you: your rank on each tour, its season points and tournaments played, your tournaments of the seasons you pick (or *Fetch all* picks on your tap) with end date, place, the tour's points and your rounds, the season statistics of the tour you pick. Only once you connected an app for it. Never prize money, never anyone else's | in the extension's own storage, or the companion app's, on your device: what your pages showed, merged (another player's page replaces it) | to the app you connected for it (after its plan), a page per tour, with the name the page writes so the app can check it is yours, and nowhere else; the page's id only as a hash (`account_ref`) |
| A professional's own pages of a tour (today the Pro Golf Tour, the Ladies European Tour and the LET Access Series) as they show them to you: your rank and points of the season's ranking, your tournaments of the season with place and points, and - from each tournament's page you open, or that *Fetch all* opens on your tap - only your own line (place, rounds, par, the course, how many played); on the LET's and the LET Access Series' sites your profile's results with their rounds of each season you (or *Fetch all*) pick and, from the Order of Merit you (or *Fetch all*) open, only your own line. Only once you connected an app for it. Nobody else's line leaves the page | in the extension's own storage, or the companion app's, on your device: the profile you opened last (on the LET's sites each season picked) and your own lines of its tournaments or of the Order of Merit (another player's profile replaces them), when each tournament page was opened, the last runs of *Fetch all* and the one going on | to the app you connected for it (after its plan), with the name the page writes so the app can check it is yours, and nowhere else; the page's id only as a hash (`account_ref`) |
| A professional's own *Results* page of a tour that shows the whole season (PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour; since extension 0.16.0) as it shows it to you: the season's standing (rank, points) and your tournaments of that season with place, points and your own rounds (a team event's not at all). Only once you connected an app for it, and only when you tap *Send* there - or *Fetch all*, which picks the seasons (and on pgatour.com the tours) of the last two years on *Results* and *Stats* for you. The page's other players (a leaderboard at the top) never leave it | in the extension's own storage, or the companion app's (since 0.11.0), on your device: what each app last answered; during a run of *Fetch all* the seasons it read, until it ends | to the app you connected for it (after its plan), with the name the page writes so the app can check it is yours, and nowhere else; the page's id only as a hash (`account_ref`) |
| The shape recorder's file (extension 0.25.0, on its options page, for adding another launch monitor): only the shape of a portal's traffic while you record - addresses with ids and personal words replaced, names of fields, headers and cookies, types, lengths, number ranges rounded outward; short repeating values (club names, units) only where you tick them; never a sign-in, token, cookie value, name, e-mail address or number of yours | while recording, in the browser's session memory (gone when the browser closes); the file only where you save it | nowhere: you save the file and decide whom to give it. The recorder reads along only on the portal you picked, only with the permission you gave for it, only while it records |
| The tool's own counts and log (times, kinds of request, statuses - never content), and the companion app's last 20 background runs (when, how long, how many chunks of the older history, how each ended; since 0.17.0) | on your device, the last 14 days (the runs: the last 20) | nowhere, unless you export the log yourself |

The target you connect gets your data and an `account_ref`, a hash that tells your accounts apart without naming you.
What the target does with your data is up to its own privacy policy; you choose which targets to connect and can
disconnect them in the tool at any time.

The web app is a set of static pages on GitHub Pages: GitHub sees a visit as for any web page, and the part of a
pairing link after `#` (the code) never reaches it. The companion app asks GitHub when it starts whether a newer build is out (it reads a small file of this repository's
releases); that request carries nothing of yours. It asks Expo's update server for a newer version of its JavaScript
when it starts, and since 0.19.0 also after a background run or a target's nudge, at most every six hours (the
download applies at the next start); that request names the app's build, nothing of yours. With every plan a tool
names its own version to the target (since spec 1.22.0's `version`), as it does at pairing. Installing and updating happen through the store or site you got
the tool from (Chrome Web Store, Microsoft Edge Add-ons, Mozilla, Google Play, Apple's TestFlight or App Store,
GitHub), under their own terms.

## What the tools don't do

- No analytics, no tracking, no advertising, no crash reporting to anyone.
- Nothing is sold or shared, and nothing is used for any purpose other than moving your data to the targets you
  connected.
- The extension reads only the provider's portal and API, the pairing page of the web app and, on golf.de, your *Mein
  Bereich* and a tournament's result list (only what golf.de's page itself loaded there; it sends golf.de nothing,
  opens those pages itself only on your *Fetch all* or, while you are signed in, once a day when your app says the
  record is due, and shows a small line on those pages only once an app is connected for it), and on the OWGR's and the Rolex Rankings'
  sites only a player's own page (read only when you tap *Send* in its line, which shows only once an app is connected
  for it), and on a tour's site (the Pro Golf Tour; the Ladies European Tour and the LET Access Series) your profile and
  your tournaments' pages or the Order of Merit (only once an app is connected for it; it opens those pages itself only when you tap *Fetch all*, with a pause between them), and on
  europeantour.com only a player's own pages (only once an app is connected for it; it opens your own pages there and
  picks in their own selects only when you tap *Fetch all*), and on
  pgatour.com, lpga.com and epsontour.com your *Results* and *Stats* pages (read only when you tap *Send* or *Fetch all*
  in its line, which shows only there and only once an app is connected for it; *Fetch all* picks in the page's own
  pickers, with a pause between steps), and on the Alps Tour your profile (*Fetch all* picks its reports for you); a target's address only once you allowed it,
  one at a time. On a connected app's own pages it adds a small bridge (only those addresses)
  through which that page can ask it to fetch now - it hands the page nothing of yours but whether you are signed in
  and whether it is fetching.

## Removing it

Disconnect a target in the tool (or in the target app), sign out of the provider, or uninstall the tool: what it kept
on your device goes with it. What a target already received stays with that target; ask it to delete it.

## Contact

Questions about this project: open an issue at
<https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/issues> (never post a sign-in, token or anyone's
data). Security problems: see [SECURITY.md](SECURITY.md).
