<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/provider-trackman

Reads the player's **own** Trackman account with their **own** sign-in, on their own device, into
olmd/1.

> **Unofficial.** Not affiliated with, endorsed by or supported by Trackman. Trackman's web API is
> not a public, documented API; this module asks it what the player's own web portal asks, at a
> person's pace, through the load guard.

```ts
const provider = trackman();               // keep one per client
await guard.beginRun(account);             // "Is this you?" before the first connect
const who = await provider.who(providerContext({ guard, account }), token);
// … then `sync` from @glmsync/core does the rest
```

## Rules this module keeps

- **The token goes to `api.trackmangolf.com` and nowhere else** — not to a target, not to any server
  of this project (there is none). It is handed in per call, so a sync keeps the sign-in it started
  with. How the client gets it (from the portal, from a sign-in window) is the client's business.
- **No disguise**: plain requests with `Authorization`, `Content-Type` and `Accept`; no User-Agent,
  no cookies, no copied headers. **No borrowed OAuth client id.**
- **Every request through the guard**, the plan first: this module never decides *when* to fetch.
- **Ask only for what is mapped**: the queries ask for the fields `mapping.ts` reads (a test checks).
- **Untrusted answers**: every field is mapped or dropped; one bad value never fails a sync.

## Files

| | |
| --- | --- |
| `mapping.ts` | Trackman's answers → olmd/1: the port of [`spec/reference/trackman.py`](../../spec/reference/trackman.py), checked against `trackman-olmd.json` (round distances within the vectors' tolerance). |
| `fetch.ts` | One sync against a plan: activities, each session, the scorecards, each shot of a round (five rounds a request, at most two requests a regular sync and five a history chunk), "Is this you?". |
| `client.ts` | One GraphQL call through the guard: 401 is the sign-in, any other refusal stops the fetch, an answer with errors only costs that item. |
| `queries.ts` | The portal's own queries, cut down to the mapped fields. |
| `account.ts` | The account a sign-in opens (the token's `sub`), read without verifying and without `atob`. |
| `testing.ts` | `FakeTrackman`: a made-up Trackman for tests and click checks (synthetic data only). |

## How a fetch behaves

- Each session is asked for with the fragment of its own type only (the list says which,
  `__typename`); with every type in one query Trackman refused the whole query as soon as one
  type's stroke `time` turned non-null (Nov 2026).
- A session Trackman answers with errors is asked for once more right away and taken as it comes;
  one it can't send waits (`failed`), and the target asks for it again later.
- Trouble with Trackman as a whole — the sign-in (`auth_expired`), no network or no permission to
  ask (`provider_blocked`), a refusal, a timeout or a maintenance page (`provider_unavailable`, with
  `Retry-After`), or the guard (`guard_limit`) — ends the fetch; what it has goes on with the notice.
- The shots of rounds failing cost the shots, not the sync (`partial`), and regular syncs leave them
  alone for six hours.
- Since spec 1.4.0 a round's shots are asked for with their ball and club data (the fields of a bay
  session's strokes), and the round says so (`shots_measured`). That answer has to come whole; where
  Trackman refuses it but sends the same page without those fields, the shots come without them and
  the larger question waits a day (in memory, `MEASURED_OFF_MS`).
- A history chunk reuses the activity list of the chunk before for 12 hours; once the older sessions
  are in (`max_sessions: 0`) it lists nothing and asks only for the shots of the rounds it is named.
