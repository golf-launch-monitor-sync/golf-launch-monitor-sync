<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/provider-golfde

The player's handicap record from **golf.de** (the German Golf Association's site), read along while the player opens
it — into [dgvhcp/1](../../spec/hcp.md). Unofficial: not affiliated with, endorsed by or supported by the DGV or
golf.de.

## Reads along, asks nothing

golf.de's API answers only with the client id of golf.de's own web app. Sending it would pose as golf.de's app — *no
disguise*, *no borrowed client id* ([CLAUDE.md](../../CLAUDE.md) §2) — so this module **sends golf.de nothing at all**.
The page script (`@glmsync/provider-golfde/page`) runs inside golf.de's own page, before golf.de's scripts, and looks
at the answers golf.de's page receives in the player's tab — a clone, read after the page got it:

| Answer (asked by golf.de's page) | What is kept |
| --- | --- |
| `api-v2.golf.de/graphql`, `GetMemberDetails` | the account's stable id (its number, for `account_ref`) and the index now |
| `…/graphql`, `GetHandicapHistorySheet` | the page's entries of the History Sheet (ten a page) |
| `…/graphql`, `GetScoringRecords` | the Scoring Record, with the Score Differential |
| `api-v2.golf.de/v1.0/tournaments/<n>/results` | per line only the result's id, its place and its list's size |
| `login.golf.de/api/sessions/me` | whether the player is signed in |

Everything else is never looked at. What the page script posts is already dgvhcp/1 results, made by a whitelist
(`mapping.ts`): names (the player's, a marker's in a registered private round, everyone's in a result list), card and
member numbers, and every field nobody mapped never leave golf.de's page. The extension's side reads it again just as
strictly (`readSeen`), and keeps of a result list only the line of a result the record named.

Not read: a scorecard's holes. golf.de shows them only as a picture.

## Pieces

- `mapping.ts` — an entry of the History Sheet or the Scoring Record as a dgvhcp/1 result; the account's id and index.
  A value of the wrong kind or out of range is left out, never bent; nothing is worked out (a course handicap with
  decimals is not rounded; the Scoring Record's course handicap of a nine-hole result, which is the one for 18, is
  left out).
- `observe.ts` — which answers are looked at (`watchOf`), what is made of them (`reduce`), reading that again
  (`readSeen`), the player's own line of a result list (`ownLine`).
- `page.ts` — the page script: wraps `fetch` and `XMLHttpRequest` to look at those answers; never in the page's way.
- `batch.ts` — dgvhcp/1 batches, cut to a target's limits.
- `testing.ts` — golf.de's answers made up by hand in their shape (with made-up names, so the tests can show none of
  them leaves the page script). Never a recorded answer.

The clients put it together: the browser extension (`apps/extension`, `golfde-main.ts` and `golfde-relay.ts`, with
`HcpClient` in `@glmsync/browser`), and the companion app's golf.de window (`apps/companion`, `GolfdeView`: the same
page script, bundled into `src/lib/golfdePageScript.ts` and injected before golf.de's own scripts, with the same
`HcpClient`).
