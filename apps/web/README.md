<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# Golf Launch Monitor Sync — web app

Static pages on GitHub Pages: <https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/>.
No server of its own; everything runs in your browser and stays there.

| Page | What for |
| --- | --- |
| `index.html` | What this is; the extension; the way by hand. |
| `pair.html` (also `pair/`) | **The pairing page.** A target app sends the player to `…/pair#target=<its address>&code=<code>`. The part after `#` reaches no server. With the [extension](../extension/README.md) installed, it takes over and this page says how it went; without it, the page offers the extension (and connects by itself once it is installed, within the code's ten minutes) or to connect this page instead. The code is taken out of the address once used. |
| `app.html` | **By hand, without the extension**: paste your Trackman key (a bookmark copies it from the signed-in portal), answer "Is this you?", *Fetch now* to a connected app (still only when its plan says so), or *download* what is new as an olmd/1 file, and the older history a part at a time. The same client, load guard and rules as the extension; nothing runs when the page is closed. |

- The pages keep what the extension keeps in its storage (the key until it runs out, the pairings,
  the guard's counts) in this browser's `localStorage` for the project's own address.
- A content security policy without `unsafe-eval` and without inline scripts; the bookmark is the
  only `javascript:` there is, built from `src/bookmarklet.ts` into one line.
- English and German, by the browser's language.

```
pnpm --filter @glmsync/web build     # dist/
pnpm e2e                             # click checks (from the repository root)
```

`pages.yml` publishes `dist/` from `main` once the tests are green (Settings › Pages › Source:
*GitHub Actions*, set once by an owner).
