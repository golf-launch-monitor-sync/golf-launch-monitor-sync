<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Reference implementation (Python)

The rules of the spec as plain Python (standard library only), and the generator of
[`../testvectors/`](../testvectors/). It is the yardstick, not a product: the TypeScript packages
must match its vectors field for field.

| File | Rule |
| --- | --- |
| `values.py` | Reading untrusted values: numbers are JSON numbers only, times RFC 3339 only, digits ASCII only. |
| `clubs.py` | Club names → canonical codes. |
| `trackman.py` | Trackman's answers → olmd/1, including the distances to the flag worked out from the course's points. |
| `account.py` | `account_ref`. |
| `plan.py` | The reference planning rules of a target. |
| `guard.py` | The load guard. |
| `wake.py` | The wake: what a client registers, when a target wakes it, what a wake is (since 1.9.0). |
| `deeplinks.py` | Deep links, the pairing fragment and the Android sync service's intent; the result in the way back and the universal links (since 1.22.0). |
| `ask.py` | Asking and answering (since 1.22.0): `cause`, `version`, `env` as a target reads them, the answer over the Android binding, when a client's own look may ask (`next_at`). |
| `prores.py` | A professional's pages (since 1.15.0): a finish, a world ranking's tour code, an ISO week, whose name. |
| `event.py` | One tournament from golf.de's page the player has open (since 1.19.0): its lines, by their label, as dgvevent/1. |
| `testmode.py` | A target's test scenario as a client reads it (1.8.0). |
| `cases_trackman.py`, `cases_prores.py`, `cases_event.py`, `generate.py` | The synthetic inputs, and the generator. |

```
python3 spec/reference/generate.py           # write the vectors
python3 spec/reference/generate.py --check   # CI: fail if they are out of date
```

The Trackman mapping and the planning rules come from an earlier implementation that has been in use
with real accounts; they were moved here unchanged, except that the reading of values became
stricter so that every language reads them alike: a number written as text, `true`/`false` where a
number belongs, a time that isn't RFC 3339, or a score with a fraction is now dropped instead of
being coerced. Since 1.0.1 digits are ASCII digits and the spaces inside a club name ASCII spaces
(`re.ASCII`): Python's `\d` would also read other scripts' digits, which no other language reads
alike. The vectors pin both the behaviour and these edges.
