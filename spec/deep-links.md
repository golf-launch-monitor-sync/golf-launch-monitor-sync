<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Deep links and the pairing page

How a target app hands a pairing code to a client, and how it asks the companion app to fetch now.
The scheme is open: any app may implement the receiving side. Reference:
[`reference/deeplinks.py`](reference/deeplinks.py); vectors:
[`testvectors/deep-links.json`](testvectors/deep-links.json).

## Links

```
glmsync://pair?target=<target base URL>&code=<pairing code>[&provider=<id>]
glmsync://sync?[target=<target base URL>&]return=<URL to go back to>
https://<web app>/pair#target=<target base URL>&code=<pairing code>[&provider=<id>]
```

- **pair** opens the companion app (on a phone) with what it needs to call `POST /pair`. On a
  computer the target opens the web app's pairing page instead; the code travels in the
  **fragment** (after `#`), which a browser sends to no server — the extension picks it up from the
  page.
- **sync** asks the companion app to fetch now (it still asks the target's plan first) and then to
  jump back to `return`. `target` picks the pairing when there are several.

## Reading a link

A link comes from outside and is read strictly; anything unexpected makes it invalid:

- exactly `glmsync://pair` or `glmsync://sync` (an optional `/` before `?`), no fragment;
- `key=value` pairs separated by `&`, percent- and `+`-decoded as UTF-8. A `%` that starts no valid
  escape, or bytes that aren't UTF-8, make the link invalid. A known key twice, or empty: invalid.
  Unknown keys are ignored (a later version may add some);
- `target`: `https://host[:port][/path]`, or `http://` only to `localhost`, `127.0.0.1` or `[::1]`
  (development); no user info, no query, no fragment;
- `code`: 6–64 of `0-9 A-Z a-z -`;
- `provider`: a lower-case id (`^[a-z][a-z0-9_-]{1,39}$`);
- `return`: an absolute URL — `https://host/…`, `http://` to this machine, or an app's own scheme
  written `scheme://…`; never `javascript:`, `data:`, `file:`, `vbscript:`, `about:`, `blob:` or
  `glmsync:`. At most 2048 characters for every link.

## Where a sync may jump back to

Only to a URL that starts with one of the `return_prefixes` the target named at pairing
(`POST /pair`). A prefix ends with `/` or `://`, so that `https://app.example` can't be stretched to
`https://app.example.evil.test`. Otherwise the companion app stays where it is.

## What a link never carries

No provider sign-in, no import token, nothing about the player. A pairing code is good for ten
minutes and once; whoever reads it first pairs, so a target shows it only to the signed-in player.
