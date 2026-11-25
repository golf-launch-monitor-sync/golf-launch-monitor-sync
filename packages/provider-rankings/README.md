<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/provider-rankings

A professional's own page of the **world rankings** — the Official World Golf Ranking (OWGR, men) and the Rolex Women's
World Golf Rankings (women) — read in the player's own browser when they tap *Send* there, into
[prores/1](../../spec/prores.md). Unofficial: not affiliated with, endorsed by or supported by the OWGR, Rolex or any
tour.

## What it reads, and how

Only **a player's own page**, by its address (`sites.ts`): `owgr.com/playerprofile/<name>-<id>` and
`rolexrankings.com/players/<id>`. Nothing else of the sites — no ranking table, no search, no event page — and **no
request of its own** to them: the page is read as the site's own scripts built it in the player's tab (`read.ts`),
only on the player's tap, never by a timer.

It goes by what the page *says*, not by its markup's classes:

| On the page | Read as | prores/1 |
| --- | --- | --- |
| OWGR's head: *Current OWGR Rank*, *Average Points*, *Divisor* (else *Actual Events Played*) | the figure before each label | `rankings[0]`: `rank`, `points` (average), `events` (divisor) |
| Rolex's head: *rank*, *avg pts*, *events* | the same | the same |
| The table whose heads are *Event*, *Week*, *Year* and a finish (*Finish Pos.*, *Position*) | one row per tournament, each column by its head | `tournaments`: `ref` (`owgr-<id>` / `rolex-<id>` from the event's link), `week` (`YYYY-Www`), `tour` (`tour_of`), `name`, `place`/`tied` or `result` (`place_of`), `points` (*Points Won*, *Points*) |
| The player's name: OWGR the text that is the name its address spells, Rolex its title | — | `player.name`, for the target's check |

A line without an event link (OWGR's *Multi Win Bonus*) is no tournament and left out. A world ranking has **no
rounds**: the tournaments go by their week, and a target takes rounds from the tours (spec/prores.md, *Sites*). OWGR's
table comes a moment after its page: the caller waits for it (`hasTable`) a little before reading. A page that doesn't
say what this module knows (no rank, no average, no name) is read as nothing (`changed_page`), never guessed at; what
arrives from a page is read again strictly where it is sent from (`checkPage`).

The site's id of the player goes only into the `account_ref` (`subjectOf`: `<site>:<id>`), never into a batch as it is.

## The sites' terms

A module for a site comes only with its terms noted here (spec/prores.md). As read on 22 Nov 2026:

- **OWGR** (`owgr.com`, Terms & Conditions): text and data mining and scraping are expressly forbidden ("robot, bot,
  spider, scraper"); content may be copied only for private viewing on one device; no commercial use by consumers.
- **Rolex Rankings** (`rolexrankings.com`, operated by Rolex SA, Geneva; Legal notice): content may not be copied,
  downloaded or passed on without written permission; commercial use only with permission. Nothing on automated access.

That is why this module is what it is: it sends nothing to the sites, reads only the page the player opened themselves,
only on their tap, and only their own line. Whether a player may hand their own page to an app, and whether that app may
use it, is not answered here: each project that uses this module settles it for itself.
