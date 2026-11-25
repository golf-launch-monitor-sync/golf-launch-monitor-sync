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

Other tours come as modules of their own, each with its terms noted here before it is added.

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
- `testing.ts` - the tours' pages made up by hand in their shape (made-up players, made-up numbers), and a tiny DOM
  (`h`, `docOf` of a snapshot) for the tests of a page's script. Never a recorded page.

The extension puts it together (`apps/extension`: `tours-content.ts` and `europeantour-content.ts` on the sites;
`TourKeeper` of `@glmsync/browser/tours` and the extension's `europeantour.ts` keeping what was read; `ProClient` of
`@glmsync/browser` sending it). The companion app the same
in its own window (`apps/companion`: `ToursView` with the page script `scripts/tours-page.entry.ts`, `toursSession.ts`
over the same `TourKeeper`, run and `ProClient`). A new tour joins the app's window with its module's reading in the
page script and its pages in `src/lib/toursPage.ts`; the window shows only the sites it reads (`APP_TOUR_SITES`): DP World
Tour and HotelPlanner Tour are read in the extension only, so far.
