<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/provider-tours

A professional's own pages of a **tour**, read along as the player opens them, into
[prores/1](../../spec/prores.md) (`site: tour:<key>`). One module per tour; each asks its site nothing of its own.
Unofficial: not affiliated with, endorsed by or supported by any tour or its operator.

## The tours

| Tour | Module | Pages | Terms |
| --- | --- | --- | --- |
| **Pro Golf Tour** (`tour:pro_golf_tour`) | `progolftour.ts`, `progolftour-run.ts` | the player's profile `progolftour.de/player-profile/<id>?year=<season>`; a tournament's page `progolftour.de/tournament-details/<slug>` (its *Final result*) | `robots.txt` (read 25 Nov 2026): `User-agent: * Allow: / Crawl-delay: 5`. The site shows an imprint and a privacy policy; no terms of use were found. |
| **DP World Tour** (`tour:dp_world`), **HotelPlanner Tour** (`tour:hotelplanner`) | `europeantour.ts` | the player's pages `europeantour.com/players/<name>-<id>/` (overview), `…/results` (*Wins & Results*), `…/stats` (*Stats*), each with `?tour=dpworld-tour` or `?tour=hotelplanner-tour` | `robots.txt` (read 25 Nov 2026): `User-Agent: *`, `Disallow: /api/` (the site's own data service, which this module never asks), `/search/`, `/european-tour/`, `/legends-tour/` and a few more; `/players/` is not disallowed. *Terms of Website Use* (`/terms-of-use`, read 25 Nov 2026, English law): you may print one copy and download extracts of any page for your personal use; no part of the content (live scoring data included) may be used for commercial purposes without a licence; a consumer uses the site for domestic and private use only. Nothing about robots or automated access. Whether an app may use what a player hands it of his own page is a question for each project that uses this. |

| **PGA Tour** (`tour:pga_tour`), **Korn Ferry Tour** (`tour:korn_ferry`) | `pgatour.ts` | the player's *Results* page `pgatour.com/player/<id>/<name>/results` and his *Stats* page `…/stats` (the Korn Ferry Tour's also under `/korn-ferry-tour/…`) | `robots.txt` (read 25 Nov 2026): disallows only some query strings (`?…player=`, `?…webview=` …) and internal paths, not the player pages. The terms of use (`pgatour.com/company/terms-of-use`, updated April 2024, read 25 Nov 2026), section 7: for personal, non-commercial use only, its data for no commercial purpose unless licensed (A); no automated processes, robots, scrapers or other programs that copy or download its data, nor facilitating others to use them (C); scores and statistics only for news reporting and personal, non-commercial purposes (D). This module reads only the page the player opened, on his tap, and opens nothing; whether a player may hand his own page to an app is for each project using it to answer (spec/prores.md). |
| **LPGA Tour** (`tour:lpga`), **Epson Tour** (`tour:epson`) | `lpga.ts` | the player's *Results* page `lpga.com/athletes/<name>/<id>/results`, `epsontour.com/athletes/<name>/<id>/results`, and her *Stats* page `…/stats` | `robots.txt` (read 25 Nov 2026), both sites: `User-Agent: * Allow: /`. The terms of use (`lpga.com/terms-and-conditions`, effective 5 Sep 2024, for both sites) allow use for the visitor's own non-commercial purposes; commercial use, *systematic retrieval* to build a collection and tools that harvest information *for any commercial purpose* only with written consent; statistics only for news or private, non-commercial purposes, with attribution. Same answer as above. |
| **Ladies European Tour** (`tour:let`) | `ocs.ts` | her profile `ladieseuropeantour.com/player-profiles/<id>/`; the Order of Merit `ladieseuropeantour.com/order-of-merit` | Read 25 Nov 2026, as far as reachable: the site sits behind Cloudflare's bot check, which stopped a cloud browser (not a player's own browser) at the profile and at `/terms-and-conditions`; the players list (`/players`) showed the same layout and ids as the LET Access Series. `/robots.txt` is answered by the site's app itself (no robots.txt). **Its terms were not read yet.** |
| **LET Access Series** (`tour:let_access`) | `ocs.ts` | her profile `letaccess.com/player-profiles/<id>/` (the same id as on the LET); the Order of Merit `letaccess.com/letas-order-of-merits?id=<season>` | Read 25 Nov 2026: no robots.txt (the site's app answers the address), no terms of use of its own (`/terms-and-conditions` is empty; the operator is the LET's company, Ladies European Golf Venture Limited). |
| **Alps Tour** (`tour:alps`) | `alps.ts` | his profile `alpstourgolf.com/playerprofile/<code>` (e.g. `VAN054`), its reports *This Season record*, *Results* and *Order of Merit* | `robots.txt` (read 25 Nov 2026): `User-agent: *`, `Allow: /`, `Content-Signal: search=yes, ai-train=no, use=reference`, AI crawlers shut out by name. The site sits behind Cloudflare's bot check (a cloud browser was stopped at pages opened directly, not at those reached from the start page). **Its terms were not found yet.** The module reads only the profile the player opened, the report he picked, and opens nothing. |

Other tours come as modules of their own, each with its terms noted here before it is added. The old information
centre of OCS (`ocs-let.com/tic/…`, `alps.ocs-ffg.com/tic/tmtic.cgi`) answers 404.

## DP World Tour and HotelPlanner Tour

- **One site, one page per player for both tours.** The site's scripts build the page in the player's tab; the module
  reads the document they built (`snapshotOf` with the labels the site writes *under* a figure) and asks the site
  nothing - neither its pages nor its data service. Of the player's pages: the head (the rank of the tour the address
  names: *R2DR*, *R2M*), the overview (the tour's *Rankings*: current rank, tournaments played, the season's points; the
  last five tournaments), *Wins & Results* (the season picked in the page's own select) and *Stats* (the season
  statistics of the tour picked in its select, one table a season). News and career records are not read.
- **A tournament's tour is the first part of its link** (`/dpworld-tour/…`, `/hotelplanner-tour/…`; older seasons
  `/european-tour/…`, `/challenge-tour/…`). The site lists Legends Tour and G4D Tour events among them; those aren't
  read. Majors and other co-sanctioned events are on the DP World Tour (their link says so).
- **A tournament goes only with its rounds** (R1-R4; a match play has none). The page names only the last day; the
  first is taken as three days before (the site's week), and the target counts each round's day from it as estimated.
  The par of each round where the total and *To Par* say it alike for every round. Place and tie as written (`42T`); a
  missed cut the site writes as the place after two rounds with dashes for the rest and the total - read as `MC`. The
  points are the column of the tournament's own tour (*R2DR Points*, *R2MR Points*); prize money is never read. A
  tournament that hasn't ended by the player's day isn't sent.
- **Statistics** of a season: stroke average, driving distance (yards to metres), driving accuracy, greens in
  regulation, sand saves, putts per round and per green in regulation - the keys of prores/1; a label the module doesn't
  know is left out. A past season as at its last day, the running one as read.
- **What goes**: the client keeps what his pages showed (another player's page replaces it all) and sends a page of
  prores/1 per tour with something of it: its ranking, its tournaments, its statistics. No *Fetch all*: *Wins &
  Results* has the rounds, a season at a time, as the player picks it; each pick is read as the page shows it.

## Pro Golf Tour

- **The profile** shows his rank and points of the season's Order of Merit and his tournaments of that season (start,
  end, name, place, Order of Merit points; prize money is never read). No rounds: the profile alone gives the ranking
  (`tour:pro_golf_tour`, rank, points, events).
- **A tournament's page** shows R1-R3 of the whole field. Only his own line is taken, by the name of the profile read
  last (`ownLine`: lower case, accents plain, "(AM)" dropped; two lines of that name: neither), and of the field only
  how many played. The page's other lines never leave the page's script.
- **A tournament goes only with its rounds**: one whose page wasn't read yet isn't sent (no list of tournaments without
  rounds). Place, tie or MC/WD/DQ, the field's size, the Order of Merit points, the course and its country go with it;
  each round with the page's par. The id is the site's own number of the tournament (`pgt-<n>`).
- **Fetch all**, only on the player's tap on his profile: the pages of his finished tournaments of that season whose
  rounds aren't read yet, newest first, at most 30, opened one by one in the same tab as their links would; a pause of
  6-10 s after each page (above the site's crawl delay), a page that doesn't answer in 30 s is skipped, three in a row
  end the run; three runs a day; a page opened within a week isn't opened again (`TOUR_CLICKS`, which moves down after a
  measurement, never up without one). What it read goes out once at the end.

## The season pages: PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour

- **One page holds the season**: the player's *Results* page shows the season he picked (on pgatour.com also the tour)
  with its standing and a table of the season's tournaments with R1-R4. It is read on his *Send* and nothing is opened
  for it (no *Fetch all*): `seasonPage.ts` says where a client's script runs, which page is a player's and what to take
  from it (`seasonTakes`), and reads it (`readSeasonPage`).
- **The standing** (FedExCup, Points List; Race to CME Globe, Race for the Card) is taken beside its label
  (`figures.ts`: "83" before "PTS: 494", "134" above "CME Points Rank") as the ranking `tour:<key>`, with the season's
  tournaments as its events.
- **Days**: pgatour.com names a tournament's last day, lpga.com and epsontour.com its first. The other is counted by
  the round columns the table has (four: the last day minus three); on lpga.com and epsontour.com no `end` is sent. The
  rounds carry no day (the target counts them from `start` and marks them estimated).
- **What is left out**: a tournament not over yet (its last day is today or later), a round not played ("-"), and a
  **team event** (Zurich Classic, Grant Thornton Invitational, Dow Championship, QBE Shootout: a pair's score per
  round, not his strokes), which then isn't sent at all (no tournament without its rounds). Winnings are never read.
- **Ids**: pgatour.com's own tournament id from the row's shot-tracker link (`pga-R2026002`; a major has none:
  `pga-<last day>-<name>`); lpga.com's tournament page and the year (`lpga-2026-<slug>`, `epson-2026-<slug>`).
- **The tour**: on pgatour.com the *Tour* picker's (the address may still name another); PGA Tour Champions and PGA
  Tour Americas aren't read (`other_tour`), prores/1 has no key for them.
- The page's other players (pgatour.com's leaderboard strip at the top) never leave the page's script.
- **The season's statistics** come from the player's *Stats* page, read the same way on *Send* (`seasonStats.ts`; the
  page with the same pickers). pgatour.com writes a table *STAT, VALUE, RANK, SUPPORTING STAT, VALUE*: strokes gained
  (total, off the tee, approach, around the green, putting), driving distance (yards to metres) and accuracy, greens in
  regulation, proximity to hole (feet and inches to metres), scrambling, sand saves, putting average (putts per green
  in regulation), putts per round, the actual scoring average, birdie average and the par 3/4/5 averages. lpga.com and
  epsontour.com write the strokes gained as cards (a label, its value after it) and a table *PERFORMANCE, YEAR TO DATE,
  RANKING* with the same kinds (*Drive Distance Avg* in yards), rounds, events, cuts made, top 10s and official wins;
  her birdies a round are her season's birdies over its rounds, and the row of the standing's points (*CME Points*,
  *Race for the Card Points*) with its rank is the ranking. Ranks of single statistics, supporting figures and money
  are never read; a label not in a module's `STAT_RULES` is left out. The season is the picker's (a page that doesn't
  name it is not read); a past season's statistics are as at its year's end. A page of statistics sends no tournament,
  and no ranking where it shows no standing (prores/1 wants a rank or points).
## Ladies European Tour and LET Access Series

- Both sites run on one platform (OCS Sport), each an app that changes its address without loading a page; the extension
  looks again whenever the address changes. One module (`ocs.ts`) reads both; each is a tour of its own.
- **Her profile** shows her results of the season picked there (`2026 Season`): per tournament its link
  (`/tournaments-information/<code>/<season>`, the ref `let-<code>-<season>` or `letas-<code>-<season>`), its start
  (`12/04/26`), her place (`2`, `9=` tied; a missed cut is a place after two rounds there), **every round in one cell**
  (`72 69 69`) and the total with its score to par (`210 (-6)`). The par of a round is the total minus its score to par,
  over the rounds - only when the total equals the rounds and the par comes out whole. Prize money is never read. Her
  name is the heading above her season's figures (*… Tournaments Played*). No rank on the profile.
- **The Order of Merit** (*Pos, Name, Nat, Points, Played*): only her own line, found by the link to the profile read
  last on that tour (never by a name): rank, points, events of that season. The page's other lines never leave the
  page's script.
- A tournament goes with its rounds, and only three days after its start (four rounds at most), so one still running
  isn't sent half. The ranking goes with every send: the events of the profile, and rank and points once her line of
  that season's Order of Merit was read.
- Nothing is opened for her: one page has the whole season; no *Fetch all*.

## Alps Tour

- **One page, one report at a time**: his profile (`/playerprofile/<code>`, the code the ref of his page, lower case)
  shows the report picked in its own select (*Select Report*); the site, an app of OCS Sport like the LET's, changes its
  address without loading a page. Three reports are read, each as the page shows it after his pick, and kept merged
  (`mergeRead`; another player's profile replaces it all):
  - **This Season record**: the running season's tournaments - first day (`17/02/26`), place (`6=` tied; a missed cut
    is the place after two rounds there, kept as written), **every round in one cell** (`69 67 73`). No par, no link.
  - **Results** (the season of the report's own picker): each tournament's total and score to par, no rounds. Kept is
    the score to par, by the tournament's ref; with the rounds of *This Season record* it gives the par of each round
    (the total minus it, over the rounds) - only when the totals agree and the par comes out whole.
  - **Order of Merit**: a line per season with rank, points and tournaments played.
  *Statistics* (his career, not a season) and the highlights aren't read.
- **His name** is no heading: the box just before the one headed *Represents* (`nameIn`, taken with the snapshot by
  `snapshotAt`).
- **What goes**: the tournaments of *This Season record* with their rounds, three days after their first (so one still
  running isn't sent half), each `alps-<first day>-<name made plain>` (the profile links no tournament); the ranking of
  that season (rank, points, events of its Order of Merit line). Earlier seasons aren't sent: the profile shows their
  rounds nowhere. Prize money is never read. Nothing is opened for him; no *Fetch all*.

## Pieces

- `snapshot.ts` - a page as text (title, headings and list lines, labelled values, tables, links), taken in the page's
  script by `snapshotOf`; everything after it is pure.
- `page.ts` - a tour's page as a client hands it on (`TourPage`), read again strictly where it arrives
  (`checkTourPage`), one prores/1 batch of it (`tourBatchOf`, cut to the format's limits), the tours read today
  (`TOUR_SITES`).
- `progolftour.ts` - the profile (`readProfile`; `profileOf` by its address), his line of a final result (`ownLine`), what a read hands on
  (`siteRead`), the addresses a run may open (`mayOpen`), the strict re-reads of what a content script sends
  (`checkProfile`, `checkOwnLine`).
- `progolftour-run.ts` - *Fetch all* as a value: `startRun`, `nextStep`, `seeRun`, `stopRun`, `mayStart`.
- `europeantour.ts` - a page of his on europeantour.com (`readPage`, `shows`), what the client keeps of them
  (`mergeRead`, `checkRead`) and a page per tour to send (`pagesOf`).
- `ocs.ts` - the LET and the LET Access Series: where a page is (`siteAt`, `profileIdOf`, `isOomPage`), her profile
  (`readProfile`), her line of the Order of Merit (`readOom`), what a read hands on (`siteRead`), the strict re-reads
  (`checkProfile`, `checkOom`).
- `alps.ts` - the Alps Tour: where a page is (`onSite`, `profileIdOf`), his name (`nameIn`, `snapshotAt`), a report of
  his profile (`readPage`, `shows`), what the client keeps of them (`mergeRead`, `checkRead`) and the page to send
  (`pageOf`).
- `testing.ts` - the tours' pages made up by hand in their shape (made-up players, made-up numbers; the season pages in
  `testing-season.ts`), and a tiny DOM (`h`, `docOf` of a snapshot) for the tests of a page's script. Never a recorded
  page.

The extension puts it together (`apps/extension`: `tours-content.ts`, `europeantour-content.ts`, `season-content.ts` and
`ocs-content.ts` and `alps-content.ts` on the sites; `TourKeeper` of `@glmsync/browser/tours`, `EtKeeper` of `@glmsync/browser/europeantour`,
`OcsKeeper` of `@glmsync/browser/ocs` and `AlpsKeeper` of `@glmsync/browser/alps` keeping what was read; `ProClient` of `@glmsync/browser` sending it). The
companion app the same in its own window (`apps/companion`: `ToursView` with the page script
`scripts/tours-page.entry.ts`; `toursSession.ts` over the same `TourKeeper`, run and `ProClient` for the Pro Golf Tour,
`etSession.ts` over the same `EtKeeper` for europeantour.com, `ocsSession.ts` over the same `OcsKeeper` for the LET and
the LET Access Series, `seasonSession.ts` for the season pages, read on *Send* through `readSeasonPage` and `figuresOf`
as in the extension, `alpsSession.ts` over the same `AlpsKeeper` for the Alps Tour, since companion 0.9.0). A new tour
joins the app's window with its module's reading in the page script and its pages in `src/lib/toursPage.ts`; the window
shows only the sites it reads (`APP_TOURS`): every tour the extension reads, so far.
