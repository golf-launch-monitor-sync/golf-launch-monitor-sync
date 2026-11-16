<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The spec

Everything another implementation needs, in one place, independent of this project's code. Version:
[`VERSION`](VERSION) (semantic versioning; every change to a schema, a rule or a vector moves it).

| | Description | Machine-readable |
| --- | --- | --- |
| The format **olmd/1** | [olmd.md](olmd.md) | [olmd/olmd-1.schema.json](olmd/olmd-1.schema.json) |
| The **target API** an app implements to receive data | [target-api.md](target-api.md) | [api/target-api.yaml](api/target-api.yaml) |
| The **planning rules** a target keeps | [planning.md](planning.md) | [plan/rules.json](plan/rules.json) |
| The **load guard** every client keeps | [guard.md](guard.md) | [guard/limits.json](guard/limits.json) |
| **Deep links**, the pairing page and the Android sync service | [deep-links.md](deep-links.md) | — |
| **Test vectors** for all of the above | [testvectors/README.md](testvectors/README.md) | [testvectors/](testvectors/) |
| The **reference** that writes the vectors | [reference/README.md](reference/README.md) | [reference/](reference/) |

## Roles

- A **provider** is where the data lives: a launch monitor maker's cloud account (Trackman is the
  first). A provider module knows how to read it and turns it into olmd.
- A **client** runs with the player — the browser extension, the web app, the companion app — holds
  the player's own provider sign-in, and fetches. It never fetches without a plan and never past
  the guard.
- A **target** is an app that receives the data (or a file on disk). It plans when a client fetches
  and stores what arrives. Nothing here is specific to one target.

## License

MIT, like the rest of the repository. The format and the API may be implemented by anyone, in any
language, under any license.
