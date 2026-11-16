<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Reference implementation (Python)

The rules of the spec as plain Python (standard library only), and the generator of
[`../testvectors/`](../testvectors/). It is the yardstick, not a product: the TypeScript packages
must match its vectors field for field.

| File | Rule |
| --- | --- |
| `values.py` | Reading untrusted values: numbers are JSON numbers only, times RFC 3339 only. |
| `clubs.py` | Club names → canonical codes. |
| `trackman.py` | Trackman's answers → olmd/1, including the distances to the flag worked out from the course's points. |
| `account.py` | `account_ref`. |
| `plan.py` | The reference planning rules of a target. |
| `guard.py` | The load guard. |
| `deeplinks.py` | Deep links and the pairing fragment. |
| `cases_trackman.py`, `generate.py` | The synthetic inputs, and the generator. |

```
python3 spec/reference/generate.py           # write the vectors
python3 spec/reference/generate.py --check   # CI: fail if they are out of date
```

The Trackman mapping and the planning rules come from an earlier implementation that has been in use
with real accounts; they were moved here unchanged, except that the reading of values became
stricter so that every language reads them alike: a number written as text, `true`/`false` where a
number belongs, a time that isn't RFC 3339, or a score with a fraction is now dropped instead of
being coerced. The vectors pin both the behaviour and these edges.
