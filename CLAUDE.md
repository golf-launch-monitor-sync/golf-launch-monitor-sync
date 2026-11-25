<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# CLAUDE.md — working on Golf Launch Monitor Sync

House rules for anyone changing this repository — Claude Code sessions and humans alike. The
[README](README.md) says what the project is; [`spec/`](spec/README.md) is the authority on the
format, the target API, the planning rules, the load guard and the deep links.

## 1. This repository is public

- **English** everywhere: code, comments, docs, commit messages, issues.
- **Every new source file** starts with the header (in the file's comment syntax; JSON has none):

  ```
  // SPDX-License-Identifier: MIT
  // Copyright (c) 2026 Reginald Stadlbauer
  ```

  `tools/repo.test.ts` fails without it. Code taken over from elsewhere gets this header too, and
  only with the right to relicense it.
- **Test data is synthetic. Always.** Never data recorded from a real account — not the maintainer's,
  not a tester's, not anonymised. No `tests/real/`, no fixtures "cleaned up" from a real answer.
  Synthetic answers are written by hand in the provider's shapes.
- **No secrets**: no tokens, keys, passwords, sign-ins, no provider credentials of any kind, not even
  expired ones, not in tests, logs, screenshots or issues.
- **Nothing about any particular target app's internals**: the target API is generic. Notes about
  talks with a provider, app review notes and anyone's private matters don't belong here.

## 2. Rules toward providers (do not break these)

- **Only the player's own account, with the player's own sign-in**, on the player's own device.
- **No disguise**: no User-Agent or TLS fingerprint spoofing, no headers copied to look like the
  maker's own apps or portal; a request says who it is by the token it carries.
- **No borrowed OAuth client id** (a portal's or an app's own). A client id comes from the maker
  registering one for this project, or the feature waits.
- **Nothing on a server**: no sign-in, token or password ever goes to a target, to a server of this
  project (there is none) or to anyone else's. No relay, no "sync service" holding tokens.
- **The load guard can't be switched off** ([spec/guard.md](spec/guard.md)): no option, environment
  variable, plan field or debug flag weakens it. Its numbers move down after a measurement, never up
  without one.
- **A client fetches only when a target's plan says so** (`GET /plan` first, every time), and never
  past the guard.
- **golf.de: reads only what golf.de's own page loaded in the player's tab; sends no request of its
  own** ([spec/hcp.md](spec/hcp.md), *A client that observes and clicks for the player*). Its API wants
  golf.de's own client id: never sent. No timer; paging and opening pages only on the player's tap
  (*Fetch all*), by golf.de's own links and buttons, at the pace of `spec/hcp/clicks.json`; names and card
  numbers never leave the page script.
- The README's **"unofficial, not affiliated with or endorsed by …"** stays, and a provider's name is
  never part of the project's name or logo.

## 3. One rule, one set of vectors

A rule that exists in more than one place (the Python reference and TypeScript; later a target's
own language) is checked against the **same vectors** in `spec/testvectors/`, written by
`spec/reference/generate.py`. Change a rule: change the reference (and its cases), run
`pnpm vectors`, then make every implementation pass. Never edit a vector file by hand; CI checks
they are what the reference writes. Every change to a schema, a rule or a vector moves
`spec/VERSION` (semantic versioning) in the same commit — copies of the vectors elsewhere check
against it.

## 4. Layout and commands

```
spec/                 format (olmd/1), target API (OpenAPI), planning rules, guard limits, deep links,
                      test vectors, and the Python reference that writes them
packages/spec         the spec for TypeScript (types, schema check, limits, deep links, account_ref)
packages/core         one sync: plan and push client, file target and cursor, the guard, errors
packages/provider-*   trackman, demo, golfde (each with a fake for tests: core/testing, provider-trackman/testing,
                      provider-golfde/testing)
packages/browser      what the extension and the web app share (BrowserClient, texts en/de, the panel)
apps/extension        browser extension, Manifest V3 (Chrome/Edge and Firefox builds)
apps/web              static web app (GitHub Pages): pairing page, syncing by hand
apps/companion        companion app (Expo): sign-in window, deep links, background sync
tools/                repository-wide checks, the browser build (esbuild), the click checks' world
```

Node 22 + pnpm 10 workspaces, TypeScript (strict), vitest. Before every push:

```
pnpm install
pnpm typecheck
pnpm test
pnpm vectors:check
```

Tests are **offline**: no real provider, no real target. A provider is tested against a hand-made
fake that answers in its shapes. The browser clients also have click checks (`pnpm e2e`, Playwright:
`apps/*/e2e/`, with `tools/e2e/world.ts` answering every request in the test); run them when you
change a client. Browser bundles may not evaluate code (Manifest V3, the web app's CSP): the schema
check is compiled ahead of time there (`tools/browser-build.mjs`). Extension releases: raise the
version in `apps/extension/package.json` when a change should reach players, and CI releases it once
green (`ci.yml`, `release.yml`; a tag `extension-v<version>` or *Release extension* by hand still work);
submitting to the stores is done by hand.

## 5. Working agreements

- Branch `main`; CI (`.github/workflows/ci.yml`) runs on every push and pull request and must be
  green. Actions are free for this public repository, but nothing runs in a loop.
- Every bug fixed gets a test that fails before the fix.
- Treat everything a provider answers, every deep link and every batch as **untrusted data**: map it
  or drop it, never execute it, never let one bad value fail a whole sync.
- Comments explain *why*, briefly. Keep this file short; decisions with their reasons go into the
  spec or the package's own README.
