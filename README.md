<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Golf Stats Sync

Syncs your golf data from **your own** accounts into apps of your choice, in open formats. Open source
(MIT). Formerly *Golf Launch Monitor Sync*: the repository, its packages and the code keep that name.

- **Launch monitor data** — practice sessions, every shot, simulator rounds — from your launch
  monitor's cloud account (Trackman first), in [olmd/1](spec/olmd.md).
- **Your handicap record** — the History Sheet, the Scoring Record and your own place in a result
  list — from golf.de, the German Golf Association's site, in [dgvhcp/1](spec/hcp.md). The extension
  and the companion app (in its own golf.de window) only read along while **you** open these pages - or,
  once you signed in and tap *Fetch all*, click through them for you at a person's pace; while you are signed
  in, the extension also does that by itself in a background tab once a day when the app says your record is
  due, and the companion app while you have it open (phones don't let it run in the back). They send golf.de
  nothing of their own and never sign in for you. And (since spec 1.19.0) **one tournament** of golf.de's
  tournament calendar, the one whose page you have open, into your own calendar in the app - on your tap, in
  [dgvevent/1](spec/hcp.md#taking-one-tournament-dgvevent1).
- **A professional's world ranking** — rank, points and tournaments — from the player's own page of the
  Official World Golf Ranking or the Rolex Women's World Golf Rankings, in [prores/1](spec/prores.md)
  (since spec 1.15.0). The extension reads that page only when **you** tap *Send* on it, as it shows it to
  you, and asks the site nothing of its own.
- **A professional's tour** — the season's ranking and his tournaments with their rounds — from his own pages of a tour,
  in prores/1: on the Pro Golf Tour his profile and his own line of each tournament's final result (opened by him, or
  by *Fetch all* on his tap), in the extension or the companion app's window; on europeantour.com (DP World Tour,
  HotelPlanner Tour), in the extension or the companion app's window, his own pages as he opens them (results with
  rounds, season statistics); on the
  PGA Tour, the Korn Ferry Tour, the LPGA Tour and the Epson Tour, in the extension or the companion app's window, his
  *Results* page, which shows the whole season (read on *Send*, nothing opened); on the Ladies European Tour and the LET
  Access Series, in the extension or the companion app's window, her profile (results with rounds) and her own line of
  the Order of Merit; on the Alps Tour, in the extension or the companion app's window, the reports of his profile as he
  picks them (the season's rounds, the totals to par, the Order of Merit), merged. Nobody else's line leaves the page.
  Where he picks a part at a time (a season, a tour, a report), *Fetch all* in the extension or the companion app's
  window picks them for him on his tap, at a person's pace: the last two years, at most 50 tournaments.

> **Unofficial.** This project is not affiliated with, endorsed by or supported by Trackman, any
> other launch monitor maker, the Deutscher Golf Verband (DGV), golf.de, the OWGR, Rolex or any tour. It uses your own sign-in,
> for your own account, the way the maker's web portal does - or, for golf.de, only reads what golf.de's
> own page loaded in your browser. Trademarks belong to their owners and are used here only to say
> which accounts the project can read.

**Status:** the spec (format, target API, planning rules, load guard, deep links, test vectors), the
TypeScript core with the load guard, the Trackman provider, a demo provider, the
[browser extension](apps/extension/README.md), the [web app](apps/web/README.md) and the companion app
for the phone are written; none of them is in a store yet.

## How it works

```
your launch monitor's cloud account  ──(your sign-in, on your device)──▶  Golf Stats Sync
golf.de, as you open it in your browser  ──(what the page loaded)──────▶       │  olmd/1, dgvhcp/1
                                                                               ▼
                                                                   an app of your choice, or a file
```

- **Providers** read a launch monitor maker's cloud account. The first is Trackman; another maker
  with a cloud account plugs in the same way. **golf.de** is read differently: only by observing the
  pages you open ([spec/hcp.md](spec/hcp.md)).
- **Clients** run with you: a browser extension (Chrome, Edge, Firefox), a web app for doing it by
  hand, and a small companion app for the phone. Your sign-in stays in them; it is never sent to a
  target or to any server of this project — there is none.
- **Targets** are apps that receive your data through an open [target API](spec/target-api.md) — or
  simply a file. A target decides *when* a client fetches; a client never fetches on its own.
- **olmd/1** ([Open Launch Monitor Data](spec/olmd.md)) is the format: JSON, SI units, a JSON Schema,
  test vectors. Anyone may produce or read it.

## Connecting, step by step

Every client opens on the same main view: **Connect new** and the **list of connections**, one per service and
account, each with where it stands (*running*, *loading the history*, *run out – sign in again*, *test mode*, *not set
up yet – continue*); a row opens its details. And every client connects the same way, for every service (Trackman,
golf.de, those to come) - one frame, [`packages/browser`'s wizard](packages/browser/README.md#connecting-step-by-step),
not one per module, one button per step:

1. **the service**: the app that wants the data asks (its pairing link, by its address: *Connect with …*, *your data
   then goes to … – nowhere else*), and your tap on what to connect is the yes - one button when one service fits
   (*Connect launch monitor*, *Connect handicap record*; later more launch monitors, each by its name); only then the
   connection is made. In the extension the same tap is the click the browser needs for its own prompt for that one
   address. Started from *Connect new*, the step says where to start in that app;
2. **sign in** at the service (its own page, in your browser or the companion app's window); small, under it, *Enter
   a test code* for an app's test account instead - a code that is right goes on like a sign-in, one that isn't stays
   here with its sentence;
3. **your account**: the service names it - *Is this your account?* - and nothing is fetched or sent before
   *Yes, that's me*;
4. **the first data**, shown plainly (*10 sessions, 6 rounds fetched*, then *older data follows bit by bit,
   about 140 sessions still to come*); for a launch monitor you are done here already (*Done – fetching your
   data …*), with *Back to …* right there - the rest comes by itself. This first fetch hands your sessions to the
   app in parts while it still fetches, a part every two sessions or so, so the app can count them as they come;
   the rounds follow with their shots in the last part;
5. **done**: *Back to …* where the client can take you there, else the sentence that you can go back and the
   rest comes by itself.

Each step shows only what is due there: nothing of another step, no notes above or below it - on *Is this your
account?* only the account and *Yes, that's me* / *No*. Until step 3 is answered the tools show no count that looks
as if anything were running; step 3 says, big, *Not yet connected with … – sign in at …*. Then the usual overview. A
connection in test mode never asks for the provider's sign-in - not in the list, its details or on the icon.

## Gentle by design

The load on a provider must never exceed what a person causes by looking through their own sessions
in the maker's web portal. Every client keeps a [load guard](spec/guard.md) that no setting and no
target can switch off:

- one request at a time, with a pause of 1–3 seconds before each;
- at most 40 requests per sync, 60 per hour and 300 per day (rolling), the history included — a long
  history arrives over days, as if paged through by hand;
- after a `429`, a server error or no answer, a growing pause (60 s, doubled, up to an hour);
  `Retry-After` is always honoured;
- the counts are shown, and a log of the last 14 days (times and statuses, no content) can be
  exported.

And, as a rule for every line of code here:

- **no disguise**: no faked User-Agent, no TLS fingerprint spoofing, nothing meant to make the
  traffic look like the maker's own apps;
- **no borrowed credentials**: never another application's OAuth client id;
- **only your own account**, with your own sign-in;
- **nothing on a server**: no sign-in, token or password of yours is ever sent to or kept on a
  server, ours or anyone's;
- **golf.de: reads only what golf.de's own page loaded in your tab; sends no request of its own.**
  Nothing happens unless you open the page or tap *Fetch all* there - or, while you are signed in, the app
  you connected says your record is due (once a day at most): then the extension opens golf.de in a
  background tab by itself, and the companion app, while it is open, in a window you don't see (it says so on its
  home page). Either way it clicks golf.de's own links and buttons for you, as you would, with a
  pause between pages ([spec/hcp.md](spec/hcp.md)); golf.de's page asks what it asks. It never signs in for
  you, and you can switch the background fetch off. Names of other players never leave the page.
- **World rankings: only your own page, only on your tap, only what it shows you; no request of its own**
  ([spec/prores.md](spec/prores.md)).
- **Tours: only your own profile and your tournaments' pages, only your own line of a result; no request of its own**.
  *Fetch all* opens those pages, or picks the seasons, tours and reports in the page's own pickers, on your tap, with a
  pause above the Pro Golf Tour's crawl delay, three runs a day, the last two years
  ([packages/provider-tours](packages/provider-tours/README.md)).

## Repository

| | |
| --- | --- |
| [`spec/`](spec/README.md) | The format, the target API, the planning rules, the load guard, deep links, test vectors, and the Python reference that writes the vectors. |
| `packages/spec` | The spec for TypeScript: olmd types and schema check, limits, deep links, `account_ref`. |
| [`packages/core`](packages/core/README.md) | One sync from a target's plan to an imported batch: plan and push client, the file target and its cursor, the load guard, errors. |
| [`packages/provider-trackman`](packages/provider-trackman/README.md) | Reading your own Trackman account, into olmd. |
| [`packages/provider-golfde`](packages/provider-golfde/README.md) | Reading along on golf.de's pages (your handicap record), into dgvhcp/1: the page script and its mapping. |
| [`packages/provider-rankings`](packages/provider-rankings/README.md) | A pro's own page of the world rankings (OWGR, Rolex Rankings), read as the page shows it on the player's tap, into prores/1. |
| [`packages/provider-tours`](packages/provider-tours/README.md) | A pro's own pages of a tour (Pro Golf Tour, DP World Tour, HotelPlanner Tour, LET, LET Access Series, PGA Tour, Korn Ferry Tour, LPGA Tour, Epson Tour): his ranking, his tournaments with their rounds, his season statistics, into prores/1; *Fetch all* on his tap on every tour (the Pro Golf Tour's tournament pages; elsewhere his pages opened and the seasons, tours and reports picked in the page's own pickers), on the season pages (PGA Tour, Korn Ferry, LPGA, Epson) his *Results* page on *Send*. |
| [`packages/provider-demo`](packages/provider-demo/README.md) | A made-up player's sessions and rounds, for tests, trying it out and app reviews. |
| [`packages/shape`](packages/shape/README.md) | The shape recorder: the shape of a launch monitor portal's traffic (addresses with placeholders, names of fields and headers, types, ranges) without its values - for adding another provider. The extension's options page. |
| [`packages/browser`](packages/browser/README.md) | What the extension and the web app share: the key, pairings, "Is this you?", syncs, texts (English, German). |
| [`apps/extension`](apps/extension/README.md) | The browser extension (Manifest V3; Chrome, Edge, Firefox): syncs in the background when a target's plan says so; reads along on golf.de; sends a pro's world ranking page on *Send*. |
| [`apps/web`](apps/web/README.md) | The web app on GitHub Pages: the pairing page, and syncing by hand without the extension. |
| [`apps/companion`](apps/companion/README.md) | The companion app for the phone (Expo, iOS and Android): the provider's sign-in window, pairing by deep link, syncs when a target's plan says so; reads along on golf.de in its own window; sends a pro's world ranking page and his tour pages from its own window on *Send*, and *Fetch all* there on every tour. |

## Development

Node 22 and pnpm 10 (`corepack enable`), Python 3 for the reference.

```
pnpm install
pnpm typecheck
pnpm test                    # vitest; offline, synthetic data only
pnpm vectors                 # rewrite spec/testvectors from spec/reference
pnpm vectors:check           # CI: are they up to date?
pnpm build                   # the extension (apps/extension/dist) and the web app (apps/web/dist)
pnpm e2e                     # click checks: Chromium with the extension, everything answered in the test
```

The click checks need Playwright's full Chromium once: `pnpm exec playwright install chromium`.

Contributions are welcome — please read [`CLAUDE.md`](CLAUDE.md) (the house rules, for humans
too) first. Test data is **synthetic only**: never commit data from a real account, yours included.
Security issues: see [`SECURITY.md`](SECURITY.md). What the tools do with your data: [`PRIVACY.md`](PRIVACY.md).

## License

[MIT](LICENSE) © 2026 Reginald Stadlbauer.
