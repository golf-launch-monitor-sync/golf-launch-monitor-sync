<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# The extension's bridge on a target's page

Since 1.5.0. A target app that runs in a browser (its web app) can ask the browser extension to
**fetch now** and learn where the extension's sign-in stands - the way a target on Android binds to
the companion app's sync service ([deep-links.md](deep-links.md#android)), with no switch to another
page. The target asks; the extension fetches as always: the target's plan first (`reason=manual`, or
`open` when the page says the player came back, since 1.12.0), through the load guard. Reference: [`reference/bridge.py`](reference/bridge.py); vectors:
[`testvectors/page-bridge.json`](testvectors/page-bridge.json).

## Where it runs

- Only on pages of a **paired target's origin**: the scheme, host and port of the base URL the
  player paired with. That is the address the player allowed the extension to talk to when pairing
  (the browser's own prompt), so the bridge needs no permission of its own. A target whose web app
  runs on another origin than its API has no bridge (its players use the extension's popup).
- Only in the page's top frame, and only while the pairing stands: the extension adds its bridge when
  the player pairs (also to pages of that origin already open) and takes it away when the pairing ends.
- Once there, the bridge sets the attribute `data-glmsync-bridge="1"` on the page's `<html>`. That is a
  hint; whether the extension is there and paired with this target is what a `state` request answers.

## Messages

Page and extension talk with `window.postMessage` on the page's own window, with the page's own
origin as `targetOrigin`; each side takes only messages whose `source` is that window and whose
`origin` is the page's. Every message is read strictly; one that isn't exactly one of these is
ignored (unknown keys are allowed, a later version may add some).

**Request** (page → extension):

```json
{ "glmsync": "request", "v": 1, "id": "r-1", "ask": "state" }
```

- `id`: 1–64 of `A-Z a-z 0-9 _ -`, chosen by the page; the replies carry it back.
- `ask`: `state` (where the extension stands for this target) or `fetch` (fetch now).
- `reason` (with `fetch`, optional, since 1.12.0): `manual` (the player asked; the default) or `open`
  (the player came back to the target app: the plan is asked with `reason=open`, so the target decides
  whether anything is due - [planning.md](planning.md), *When the player is there*). Anything else is
  `manual`, as before 1.12.0.

**Reply** (extension → page): `{ "glmsync": "reply", "v": 1, "id": <the request's>, "answer": …, … }`

| `answer` | To | Fields | Means |
| --- | --- | --- | --- |
| `state` | `state` | `signin`, `fetching` (boolean) | The sign-in as on the plan ([target-api.md](target-api.md), *The client's sign-in*); whether a sync for this target runs right now. |
| `started` | `fetch` | – | A sync of this target is under way (with the request's reason); a `finished` reply follows. |
| `busy` | `fetch` | – | A sync for this target runs already, or the page asked less than 10 s ago: nothing new started. |
| `signin` | `fetch` | `signin` (not `ready`) | Nothing fetched: the extension has no sign-in it can fetch with. |
| `guard` | `fetch` | `until` (RFC 3339) | Nothing fetched: the load guard holds until then. |
| `unpaired` | either | – | This page's origin is no paired target's (any more). |
| `finished` | `fetch`, after `started` | `outcome`, `until` (optional) | How the sync ended: `synced` (the target has the batch), `not_due` (its plan said not now), `other_account`, `failed`, `guard` (with `until`), `signin` (the provider refused the sign-in). |

A page that hears nothing within a second or two has no extension paired with it (or one older than
1.5.0). What the data was, the page's target learns from its own import, as with any sync.

## What the bridge never does

- It hands the page nothing of the player's: no sign-in, no import token, no name, no account - only
  the five words of `signin`, whether it is fetching, and the guard's `until`.
- It starts nothing but a `manual` (or `open`) sync of the pairing whose origin the page has; it never pairs,
  disconnects or changes a setting, and it fetches only what that target's plan says, through the guard.
- At most one fetch per pairing at a time, and not again within `10` s of the last a page started
  (`fetch_gap_s` in the vectors): a page that asks again and again costs a target a plan request now
  and then, and the provider nothing the plan and the guard don't allow.
