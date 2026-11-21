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
| `deep-links.json` | parsing deep links and the pairing fragment, where a sync may return to, what the Android sync service reads from a binding | exact |
| `signin.json` | the `signin` a target reads from a client ([target-api.md](../target-api.md), *The client's sign-in*) | exact |
| `page-bridge.json` | the extension's bridge on a target's page: requests and replies ([page-bridge.md](../page-bridge.md)) | exact |
| `olmd-examples.json` | batches that must (`valid: true`) or must not validate against the schema | — |
| `hcp-plan.json` | the handicap target's rules: `is_due`, `busy`, `cards_to_read` ([hcp.md](../hcp.md), [reference/hcp.py](../reference/hcp.py)) | exact; `most: null` is the rules' `max_cards` |
| `dgvhcp-examples.json` | dgvhcp/1 batches that must (`valid: true`) or must not validate against [hcp/dgvhcp-1.schema.json](../hcp/dgvhcp-1.schema.json) | — |

All data here is **synthetic**: made up for the vectors, never recorded from anyone's account.
