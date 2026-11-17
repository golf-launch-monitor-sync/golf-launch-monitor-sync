<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Privacy

This covers the browser extension, the web app and the companion app of Golf Launch Monitor Sync. The store listings
link here.

**In short: this project runs no server and receives nothing.** The tools run on your device; they move your launch
monitor data from your own account at the maker of your launch monitor (today Trackman) to an app you connect yourself
(a *target*). Nobody behind this project sees your data, your sign-in or how you use the tools.

> Unofficial: not affiliated with, endorsed by or supported by any launch monitor maker.

## What the tools handle, and where it goes

| What | Where it is kept | Where it goes |
| --- | --- | --- |
| Your sign-in at the provider (e.g. Trackman's), read from its own web portal or its sign-in page | on your device only: the extension's own storage, the phone's secure store | only to the provider's own API, to fetch your data; never to a target, this project or anyone else |
| Your launch monitor data (practice sessions, shots, rounds) | only while it is being passed on; a file only if you save one | to the target app you connected, when its plan asks for it - and nowhere else |
| A connection: the target's address and name, its import token | on your device | the token goes to that target only |
| The tool's own counts and log (times, kinds of request, statuses - never content) | on your device, the last 14 days | nowhere, unless you export the log yourself |

The target you connect gets your data and an `account_ref`, a hash that tells your accounts apart without naming you.
What the target does with your data is up to its own privacy policy; you choose which targets to connect and can
disconnect them in the tool at any time.

The web app is a set of static pages on GitHub Pages: GitHub sees a visit as for any web page, and the part of a
pairing link after `#` (the code) never reaches it. The companion app asks GitHub when it starts whether a newer build is out (it reads a small file of this repository's
releases); that request carries nothing of yours. Installing and updating happen through the store or site you got
the tool from (Chrome Web Store, Microsoft Edge Add-ons, Mozilla, Google Play, Apple's TestFlight or App Store,
GitHub), under their own terms.

## What the tools don't do

- No analytics, no tracking, no advertising, no crash reporting to anyone.
- Nothing is sold or shared, and nothing is used for any purpose other than moving your data to the targets you
  connected.
- The extension reads only the provider's portal and API and the pairing page of the web app; a target's address only
  once you allowed it, one at a time.

## Removing it

Disconnect a target in the tool (or in the target app), sign out of the provider, or uninstall the tool: what it kept
on your device goes with it. What a target already received stays with that target; ask it to delete it.

## Contact

Questions about this project: open an issue at
<https://github.com/golf-launch-monitor-sync/golf-launch-monitor-sync/issues> (never post a sign-in, token or anyone's
data). Security problems: see [SECURITY.md](SECURITY.md).
