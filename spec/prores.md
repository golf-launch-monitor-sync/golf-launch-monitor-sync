<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# A professional's own pages: prores/1

Since 1.15.0. A professional golfer has no handicap; what tells how they play is their place on the tours they play
and in the world ranking (the Official World Golf Ranking for men, the Rolex Women's World Golf Rankings for women).
Each of those sites keeps a public page per player. **prores/1** is how a client of this project hands what *the
player's own page* shows to a target that keeps their golf data - on the player's tap, in their own browser or the
companion app's window: their tournaments (with rounds, where the page has them), their ranks, their season statistics.

It uses the **handicap target API** ([hcp.md](hcp.md), [api/hcp-api.yaml](api/hcp-api.yaml)) with a kind of its own:
everything said there holds (pairing code, import token, plan and lease, errors, CORS, limits) unless this file says
otherwise.

| | Machine-readable |
| --- | --- |
| The format **prores/1** | [prores/prores-1.schema.json](prores/prores-1.schema.json) |
| A world ranking's tour codes | [prores/tours.json](prores/tours.json) |
| Its rules (a finish, a tour code, a week, whose name) | [reference/prores.py](reference/prores.py) |
| Vectors | [testvectors/prores-examples.json](testvectors/prores-examples.json) |

## What a client reads, and what never

- **Only the player's own page**, on a site of the list below, and only what that page shows the player's browser
  anyway. No search, no ranking table, no other player's page, no request of the client's own to the site or its API,
  no header or sign-in that isn't the browser's. The client reads the page **as it is shown**: the document the site's
  own scripts built in the player's tab.
- **Nothing by itself.** The client reads when the player taps *Send* on their page (or asks the client to); no timer,
  no background reading, no paging the player didn't do. A target can't make it read; when the page is due, the target
  app reminds the player (on a phone with the read link `glmsync://read?kind=pro`, [deep-links.md](deep-links.md)).
- **Never another person's name or score** in a batch: of a tournament only the player's own line (place, rounds,
  points), of a field only its size.
- **The player's name on the page** goes into the batch (`player.name`) so the target can check it is theirs; the
  target compares it with the name it knows and keeps nothing of it. Where they differ, the target answers
  `409 other_player`; the client asks the player once ("This page is for *X*. Is that you?") and sends again with
  `player.confirmed: true`. The question is asked where the site's own scripts can't answer it (the client's own page
  or window), never on the site's page.
- **A site's terms come first**: a module for a site is added only with its terms noted in the module's README. Some
  sites forbid automated tools (their terms are the reason the client reads only what the player opened, on their tap);
  whether a player may hand their own page to an app is a question for each project that uses this - this spec doesn't
  answer it.

### Sites

| `site` | Page | What it gives |
| --- | --- | --- |
| `owgr` | the player's page of the Official World Golf Ranking (`owgr.com/playerprofile/<name>-<id>`) | rank, average points, divisor; the tournaments of the last two years by week, with place and points won |
| `rolex` | the player's page of the Rolex Women's World Golf Rankings (`rolexrankings.com/players/<id>`) | rank, average points, events; the tournaments by week, with tour, place and points |
| `tour:<key>` | the player's page of a tour | the season ranking (Order of Merit, Race to …), tournaments with rounds and place, season statistics |

Tour keys: `pro_golf_tour`, `alps`, `hotelplanner`, `dp_world`, `korn_ferry`, `pga_tour`, `let_access`, `let`, `epson`,
`lpga`, `other`.

**A world ranking has no rounds.** Its page names each tournament by the week it counted in, with the player's place
and points; it never names a round or a score. A client sends such a tournament with its `week` and no `rounds`; a
target that keeps rounds takes them from the tour's own page (or wherever else it keeps rounds) and may hang the world
ranking's place and points on the round of the same tournament - it never makes a round of its own out of a world
ranking's line.

## Pairing and the plan

- Pairing as in [hcp.md](hcp.md) with **`kind=pro`** on the pairing page (`…/pair#target=…&code=…&kind=pro`) and
  **`provider: "pro"`** in `POST /hcp/v1/pair`; the companion app's link is
  `glmsync://pair?target=…&code=…&provider=pro&kind=pro`. A client older than 1.15.0 doesn't know the kind and refuses
  the link (`invalid:kind`), so nothing half-paired remains.
- One connection of this kind per player, beside a handicap record's (a target may keep both). Its `PairResponse` has
  no `account_ref`: each site's page is an account of its own (below). Since 1.18.0 it may name `return_prefixes` as in
  [hcp.md](hcp.md), and the pair link a `return`.
- `GET /hcp/v1/plan` as in [hcp.md](hcp.md): before every batch, with the reason `manual` (the player tapped), for the
  lease, `disconnected`, and whether the target wants it now. A plan of this kind names neither `cards_have` nor
  `max_cards` nor `account_ref`. One plan covers all of the player's pages.

## The batch

`POST /hcp/v1/import` with one page per batch ([prores/prores-1.schema.json](prores/prores-1.schema.json)):

```json
{
  "format": "prores/1", "provider": "pro", "site": "owgr",
  "account_ref": "<account_ref over 'owgr:<the page's player id>'>",
  "generated_at": "2026-11-25T18:00:00Z",
  "generator": { "name": "Golf Stats Sync", "version": "0.13.0" },
  "sync": { "plan_id": "…", "reason": "manual" },
  "player": { "name": "Max Mustermann" },
  "rankings": [ { "source": "owgr", "rank": 412, "points": 0.9871, "events": 40, "as_of": "2026-11-25" } ],
  "tournaments": [
    { "ref": "owgr-90012", "tour": "dp_world", "name": "Musterstadt Open", "week": "2026-W40",
      "place": 17, "tied": true, "points": 2.16597 },
    { "ref": "owgr-89950", "name": "A Major Somewhere", "week": "2026-W29", "result": "MC" }
  ]
}
```

- `account_ref`: the rule of [olmd.md](olmd.md) with provider `pro` and the subject `<site>:<the page's player id>`,
  with the connection's `account_salt`. **One account per site**: a batch of the same site with another `account_ref`
  is refused (`409 other_account`) until the player disconnects; pairing again forgets the accounts.
- `player`: `name` as the page writes it; `confirmed: true` only after the player said the page is theirs (above).
- `rankings`: the ranks the page shows (`owgr`, `rolex`, `tour:<key>`), rank or points or both: a world ranking's
  `points` are its **average** points (the number its rank comes from), its `events` its **divisor** where it shows one,
  else its events; a tour's are its season points and events. `as_of`: the day the page names for its ranking, else the
  day it was read.
- `tournaments`: the player's own line of each tournament the page lists. `ref`: the page's stable id of it (a client
  writes it with the site's prefix, `owgr-<id>`, `rolex-<id>`); a line without one (a bonus line) is left out. Each
  names its `start` (the first day) or, where the page has no day, its `week`: the ISO week it ended in,
  `YYYY-Www`. Rounds only with a `start`. `place` and `tied` (`T17`, `17T`) or `result` (`MC` for a missed cut or
  *CUT*, `WD` also for *RTD*, `DQ`, `DNS`): the rule `place_of`. `tour` where the page names one this spec knows
  ([prores/tours.json](prores/tours.json): the rule `tour_of`; a major names none). `points`: what the tournament
  brought in the page's ranking (a world ranking's points won).
- `rounds`: a round's `played_on` only where the page names it; else the target counts from `start` (round n on
  start + n − 1) and marks the day as estimated. A round without a score is left out; a round on a day still to come
  is not sent.
- `stats`: the season's statistics as key and value, **metric**, the keys below; a target ignores keys it doesn't know.
- Unknown values are left out, never `null`; unknown fields are dropped by the target. At most 300 tournaments, 20
  rankings, 10 statistics and 500 rounds with a score a batch (`413 too_large`: split by season).
- `notice`, `generator`, `sync`: as dgvhcp/1. `changed_page`: the page no longer looks as the client knows it, and it
  read nothing of it rather than guess.

**The answer** is `ImportResult` of [api/hcp-api.yaml](api/hcp-api.yaml) counting the **rounds** (`read` = rounds with a
score, `errors` by the round's place counted through the tournaments from 1); ranks, tournaments and statistics are
kept with it. A batch of a world ranking's page therefore answers `read: 0`.

### Statistics

| Key | Unit | Key | Unit |
| --- | --- | --- | --- |
| `scoring_average` | strokes per round | `putts_per_round` | putts |
| `driving_distance_m` | metres | `putts_per_gir` | putts per green in regulation |
| `driving_accuracy_pct` | % of fairways | `birdies_per_round` | birdies |
| `gir_pct` | % of greens in regulation | `proximity_m` | metres to the hole from approach shots |
| `scrambling_pct` | % | `par3_average`, `par4_average`, `par5_average` | strokes |
| `sand_saves_pct` | % | `sg_total`, `sg_off_tee`, `sg_approach`, `sg_around_green`, `sg_putting` | strokes gained per round |
| `rounds`, `events`, `cuts_made`, `top10`, `wins` | counts | | |

A page in yards converts (1 yd = 0.9144 m, one decimal); feet to metres likewise (0.3048).

## Vectors

[testvectors/prores-examples.json](testvectors/prores-examples.json): each batch valid or not against the schema, with
what a target keeps (`expect`: rounds, rankings, tournaments, statistics) or refuses (`refused`: `invalid`,
`too_large`); `rules`: `place_of`, `tour_of` and `iso_week`; `names`: whether a page's name is the player's (lower
case, ß and umlauts spelled out, accents dropped, anything but letters and digits a gap; every part of the shorter name
among the other's parts, at least two).
