<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The spec

Everything another implementation needs, in one place, independent of this project's code. Version:
[`VERSION`](VERSION) (semantic versioning; every change to a schema, a rule or a vector moves it).

| | Description | Machine-readable |
| --- | --- | --- |
| The format **olmd/1** (which sessions asked for again were answered, `progress.sessions_asked`, since 1.25.0) | [olmd.md](olmd.md) | [olmd/olmd-1.schema.json](olmd/olmd-1.schema.json) |
| The **target API** an app implements to receive data (asking and answering - `cause`, `version`, `env`, `outdated` - since 1.22.0) | [target-api.md](target-api.md) | [api/target-api.yaml](api/target-api.yaml) |
| The **planning rules** a target keeps (when the player is there: since 1.12.0; the lease is a client's, busy names its holder: since 1.13.0; the whole history - older scorecards, sessions asked for again, `can` - since 1.20.0; a history that only fills gaps, `history.older`, since 1.21.0; who asks when, `next_at` and `due_at`, since 1.22.0; a first sync back to the last season with fewer sessions, `first_days` and `max_sessions`, since 1.23.0; the older scorecards first in a chunk and a try only when the client made it, since 1.25.0; the older scorecards past a stretch of games, `rounds_passed`, since 1.26.0) | [planning.md](planning.md) | [plan/rules.json](plan/rules.json) |
| The **load guard** every client keeps | [guard.md](guard.md) | [guard/limits.json](guard/limits.json) |
| **Deep links** (the read link since 1.11.0; a link's focus, several providers and a way back for every kind since 1.18.0; the result in the way back, universal links and the answer over the Android binding since 1.22.0), the pairing page and the Android sync service | [deep-links.md](deep-links.md) | [testvectors/ask.json](testvectors/ask.json) (the answer) |
| **Test mode**: a target's test scenarios, played back to the real provider code (since 1.8.0) | [test-mode.md](test-mode.md) | [api/target-api.yaml](api/target-api.yaml) (`/test-scenario`) |
| The extension's **bridge** on a target's page (*fetch now*, the sign-in) | [page-bridge.md](page-bridge.md) | — |
| The **wake**: a silent push from the target when a plan is due (since 1.9.0) | [wake.md](wake.md) | [api/target-api.yaml](api/target-api.yaml) (`/wake`) |
| The player's **handicap record** (dgvhcp/1) and its target API (since 1.6.0; clients that only observe a provider's page since 1.10.0, click for the player on it since 1.14.0, and by themselves when the record is due since 1.16.0, the companion app while it is open since 1.17.0; one tournament from golf.de's page, dgvevent/1, since 1.19.0) | [hcp.md](hcp.md) | [hcp/dgvhcp-1.schema.json](hcp/dgvhcp-1.schema.json), [hcp/dgvevent-1.schema.json](hcp/dgvevent-1.schema.json), [api/hcp-api.yaml](api/hcp-api.yaml), [hcp/rules.json](hcp/rules.json), [hcp/clicks.json](hcp/clicks.json) |
| A **professional's own pages** (prores/1): world ranking and tour pages, through the handicap target API with `kind=pro` (since 1.15.0) | [prores.md](prores.md) | [prores/prores-1.schema.json](prores/prores-1.schema.json), [prores/tours.json](prores/tours.json) |
| **Test vectors** for all of the above | [testvectors/README.md](testvectors/README.md) | [testvectors/](testvectors/) |
| The **reference** that writes the vectors | [reference/README.md](reference/README.md) | [reference/](reference/) |

## Roles

- A **provider** is where the data lives: a launch monitor maker's cloud account (Trackman is the
  first). A provider module knows how to read it and turns it into olmd.
- A **client** runs with the player — the browser extension, the web app, the companion app — holds
  the player's own provider sign-in, and fetches. It never fetches without a plan and never past
  the guard. A client that **only observes** a provider's page (since 1.10.0, [hcp.md](hcp.md)) holds no
  sign-in and fetches nothing: it reads what the provider's own page loaded in the player's browser.
- A **target** is an app that receives the data (or a file on disk). It plans when a client fetches
  and stores what arrives. Nothing here is specific to one target.

## License

MIT, like the rest of the repository. The format and the API may be implemented by anyone, in any
language, under any license.
