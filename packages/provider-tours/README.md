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

Other tours come as modules of their own, each with its terms noted here before it is added.

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
- `progolftour.ts` - the profile (`readProfile`), his line of a final result (`ownLine`), what a read hands on
  (`siteRead`), the addresses a run may open (`mayOpen`), the strict re-reads of what a content script sends
  (`checkProfile`, `checkOwnLine`).
- `progolftour-run.ts` - *Fetch all* as a value: `startRun`, `nextStep`, `seeRun`, `stopRun`, `mayStart`.
- `testing.ts` - the tours' pages made up by hand in their shape (made-up players, made-up numbers). Never a recorded
  page.

The extension puts it together (`apps/extension`: `tours-content.ts` on the site, `tours.ts` keeping what was read,
`ProClient` of `@glmsync/browser` sending it). The companion app doesn't read tour pages yet.
