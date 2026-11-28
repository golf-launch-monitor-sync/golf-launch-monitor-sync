<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Test vectors

One set of vectors for every implementation of a rule: `packages/*` read them with vitest, the
reference in [`../reference/`](../reference/) wrote them, and a target that implements the planning
rules or reads olmd can check itself against the same files. **Generated — don't edit by hand**:
change the reference or its cases and run

```
python3 spec/reference/generate.py
```

CI runs it with `--check` and fails when a file is out of date. Every file names the
`spec_version` it belongs to (`spec/VERSION`); a copy of these files kept elsewhere checks that it
matches the version it says.

| File | Rule | How to compare |
| --- | --- | --- |
| `trackman-olmd.json` | Trackman's answers (synthetic) → olmd/1 batch ([reference/trackman.py](../reference/trackman.py)) | JSON values; in `rounds[].shots[]` numbers within `compare.round_shot_tolerance` |
| `clubs.json` | club names → canonical codes (`camel` for CamelCase provider names, `normalize` for the rest) | exact |
| `values.json` | reading untrusted values: `when`, `integer`, `num` | exact |
| `account-ref.json` | `account_ref` | exact |
| `plan.json` | the reference planning rules ([planning.md](../planning.md)) | times as instants within `compare.time_tolerance_s`; objects regardless of key order |
| `guard.json` | the load guard ([guard.md](../guard.md)): scenarios replayed step by step | exact (`until` in seconds) |
| `deep-links.json` | parsing deep links and the pairing fragment, where a sync may return to, what the Android sync service reads from a binding; since 1.22.0 the result in the way back (`with_result`, `read_result`) and the universal links (`parse_universal`, `universal_link`); since 1.27.0 the signin link and a pair link's `mode`, `key`, `nonce` | exact |
| `ask.json` | asking and answering (1.22.0; [target-api.md](../target-api.md), [deep-links.md](../deep-links.md#the-answer-over-the-binding), [planning.md](../planning.md)): `cause`, `version`, `env` as a target reads them, the answer over the Android binding, when a client's own look may ask (`own_ask_at`, `may_ask`) | exact; times as instants |
| `handover.json` | signing in for a target (1.27.0; [deep-links.md](../deep-links.md#signing-in-for-a-target), [reference/handover.py](../reference/handover.py)): `public_key`, `seal` (fixed keys and nonce, so every NaCl box can check its bytes), `open`, `with_answer`, `read_answer` | exact |
| `signin.json` | the `signin` a target reads from a client ([target-api.md](../target-api.md), *The client's sign-in*) | exact |
| `page-bridge.json` | the extension's bridge on a target's page: requests and replies ([page-bridge.md](../page-bridge.md)) | exact |
| `test-scenario.json` | the answer of `GET /test-scenario` as a client reads it ([test-mode.md](../test-mode.md), [reference/testmode.py](../reference/testmode.py)) | exact; `limits` are the reader's |
| `wake.json` | the wake ([wake.md](../wake.md)): `read_wake` (the body of `PUT /wake`), `should_wake` (the target's rule), `is_wake` (a push's data) | exact |
| `olmd-examples.json` | batches that must (`valid: true`) or must not validate against the schema | — |
| `hcp-plan.json` | the handicap target's rules: `is_due`, `busy`, `cards_to_read` ([hcp.md](../hcp.md), [reference/hcp.py](../reference/hcp.py)) | exact; `most: null` is the rules' `max_cards` |
| `dgvevent-page.json` | a golf.de tournament page (its address, heading and lines) → dgvevent/1's `event`, or why not ([hcp.md](../hcp.md), *Taking one tournament*; [reference/event.py](../reference/event.py)) | JSON values |
| `dgvevent-examples.json` | dgvevent/1 bodies that must (`valid: true`) or must not validate against [hcp/dgvevent-1.schema.json](../hcp/dgvevent-1.schema.json), and what a target does reading each (`target`: `refused`, or the fields left out as `dropped`) | — |
| `dgvhcp-examples.json` | dgvhcp/1 batches that must (`valid: true`) or must not validate against [hcp/dgvhcp-1.schema.json](../hcp/dgvhcp-1.schema.json); since 1.10.0 also `page_history`, `page_scoring`, `page_own_place`: one result sent page by page by a client that only observes, which a target keeps as one | — |

All data here is **synthetic**: made up for the vectors, never recorded from anyone's account.
