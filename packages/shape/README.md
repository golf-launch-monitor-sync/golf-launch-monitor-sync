<!-- SPDX-License-Identifier: MIT -->
<!-- Copyright (c) 2026 Reginald Stadlbauer -->
# @glmsync/shape

The **shape recorder**: what a launch monitor maker's portal sends and receives, as its *shape* - never its values. It
is how a new provider is looked at without passing recordings of anyone's traffic around (a HAR file holds the sign-in
and the person's data). The browser extension offers it on its options page
([apps/extension](../../apps/extension/README.md#the-shape-recorder-developer-page)); the companion app may later.

- `page` (`@glmsync/shape/page`): `watchShapes(window, post)` runs in the portal's own page before its scripts, reads
  along with `fetch` and `XMLHttpRequest` and with its storage, and posts only shapes. The page's calls and answers
  are untouched (a copy of an answer is made before the page reads it; a failure of ours never reaches the page), and
  `stop()` gives the page its functions back.
- `classify`: what a value, key or path part looks like (`email`, `jwt`, `id`, `time` …), which keys are a person's or
  a credential's, which numbers may name something (`hidden`: id, time, place, personal), the scheme of an
  `Authorization` header (a known word or `other`), placeholders for path parts, hashes of a person's words.
- `shape`: the shape of a JSON value and merging shapes (types, fields, lengths, ranges; short recurring texts as
  candidates).
- `exchange`: one request and its answer as a shape (`exchangeOf`), the page's storage (`storageOf`).
- `check`: what a page posted, read again strictly (`readSeen`) - the portal's own scripts can post on its window too.
- `recording`: exchanges merged by address, and the file (`toFile`, format `glmsync-shape/1`): every literal word checked
  once more against the hashes of the person's words and of ids the whole recording saw, numbers as ranges rounded
  outward to two digits, candidates (`candidates`) written only where the player ticked them.
- `portals`: the fixed list of portals the recorder may be pointed at (`PORTALS`); a new one is an entry there.

What stays out, and is tested with made-up answers (`testing.ts`): tokens (also in JWT form, also in storage), keys,
cookie values, passwords, names (also as a slug in a path or a key of a map), e-mail addresses, ids, phone numbers,
places, times, the person's numbers (handicap, year of birth) and every exact number - the file's numbers are only
rounded ranges, counts and a token's lifetime.

Rules of the repository hold here too: synthetic test data only, nothing of a real account.
