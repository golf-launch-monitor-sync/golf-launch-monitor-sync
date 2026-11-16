<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Golf Launch Monitor Sync

Syncs the data of your launch monitor — practice sessions, every shot, simulator rounds — from
**your own** cloud account into apps of your choice, in an open format. Open source (MIT).

> **Unofficial.** This project is not affiliated with, endorsed by or supported by Trackman or any
> other launch monitor maker. It uses your own sign-in, for your own account, the way the maker's web
> portal does. Trademarks belong to their owners and are used here only to say which accounts the
> project can read.

**Status:** the spec (format, target API, planning rules, load guard, deep links, test vectors), the
TypeScript core with the load guard, the Trackman provider and a demo provider are written. The
browser extension, the web app and the companion app follow.

## How it works

```
your launch monitor's cloud account  ──(your sign-in, on your device)──▶  Golf Launch Monitor Sync
                                                                              │  olmd/1
                                                                              ▼
                                                                  an app of your choice, or a file
```

- **Providers** read a launch monitor maker's cloud account. The first is Trackman; another maker
  with a cloud account plugs in the same way.
- **Clients** run with you: a browser extension (Chrome, Edge, Firefox), a web app for doing it by
  hand, and a small companion app for the phone. Your sign-in stays in them; it is never sent to a
  target or to any server of this project — there is none.
- **Targets** are apps that receive your data through an open [target API](spec/target-api.md) — or
  simply a file. A target decides *when* a client fetches; a client never fetches on its own.
- **olmd/1** ([Open Launch Monitor Data](spec/olmd.md)) is the format: JSON, SI units, a JSON Schema,
  test vectors. Anyone may produce or read it.

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
  server, ours or anyone's.

## Repository

| | |
| --- | --- |
| [`spec/`](spec/README.md) | The format, the target API, the planning rules, the load guard, deep links, test vectors, and the Python reference that writes the vectors. |
| `packages/spec` | The spec for TypeScript: olmd types and schema check, limits, deep links, `account_ref`. |
| [`packages/core`](packages/core/README.md) | One sync from a target's plan to an imported batch: plan and push client, the file target and its cursor, the load guard, errors. |
| [`packages/provider-trackman`](packages/provider-trackman/README.md) | Reading your own Trackman account, into olmd. |
| [`packages/provider-demo`](packages/provider-demo/README.md) | A made-up player's sessions and rounds, for tests, trying it out and app reviews. |
| `apps/extension`, `apps/web`, `apps/companion` | *(later)* The clients. |

## Development

Node 22 and pnpm 10 (`corepack enable`), Python 3 for the reference.

```
pnpm install
pnpm typecheck
pnpm test                    # vitest; offline, synthetic data only
pnpm vectors                 # rewrite spec/testvectors from spec/reference
pnpm vectors:check           # CI: are they up to date?
```

Contributions are welcome — please read [`CLAUDE.md`](CLAUDE.md) (the house rules, for humans
too) first. Test data is **synthetic only**: never commit data from a real account, yours included.
Security issues: see [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Reginald Stadlbauer.
