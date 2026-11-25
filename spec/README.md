<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The spec

Everything another implementation needs, in one place, independent of this project's code. Version:
[`VERSION`](VERSION) (semantic versioning; every change to a schema, a rule or a vector moves it).

| | Description | Machine-readable |
| --- | --- | --- |
| The format **olmd/1** | [olmd.md](olmd.md) | [olmd/olmd-1.schema.json](olmd/olmd-1.schema.json) |
| The **target API** an app implements to receive data | [target-api.md](target-api.md) | [api/target-api.yaml](api/target-api.yaml) |
| The **planning rules** a target keeps (when the player is there: since 1.12.0; the lease is a client's, busy names its holder: since 1.13.0) | [planning.md](planning.md) | [plan/rules.json](plan/rules.json) |
| The **load guard** every client keeps | [guard.md](guard.md) | [guard/limits.json](guard/limits.json) |
| **Deep links** (the read link since 1.11.0), the pairing page and the Android sync service | [deep-links.md](deep-links.md) | — |
| **Test mode**: a target's test scenarios, played back to the real provider code (since 1.8.0) | [test-mode.md](test-mode.md) | [api/target-api.yaml](api/target-api.yaml) (`/test-scenario`) |
| The extension's **bridge** on a target's page (*fetch now*, the sign-in) | [page-bridge.md](page-bridge.md) | — |
| The **wake**: a silent push from the target when a plan is due (since 1.9.0) | [wake.md](wake.md) | [api/target-api.yaml](api/target-api.yaml) (`/wake`) |
| The player's **handicap record** (dgvhcp/1) and its target API (since 1.6.0; clients that only observe a provider's page since 1.10.0, and click for the player on it since 1.14.0) | [hcp.md](hcp.md) | [hcp/dgvhcp-1.schema.json](hcp/dgvhcp-1.schema.json), [api/hcp-api.yaml](api/hcp-api.yaml), [hcp/rules.json](hcp/rules.json), [hcp/clicks.json](hcp/clicks.json) |
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
