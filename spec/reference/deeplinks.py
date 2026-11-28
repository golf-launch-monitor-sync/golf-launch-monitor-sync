# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The deep links and the pairing fragment (spec/deep-links.md).

    glmsync://pair?target=<target base URL>&code=<pairing code>[&provider=<id>[,<id>…]][&kind=hcp|pro][&return=<URL to go back to>]
                  [&mode=signin[&key=<public key>&nonce=<nonce>]]                  (mode, key, nonce: 1.27.0)
    glmsync://signin?[target=<target base URL>&]provider=<id>&key=<public key>&nonce=<nonce>&return=<URL to go back to>
                                                                         (1.27.0, spec/deep-links.md, handover.py)
    glmsync://sync?[target=<target base URL>&]return=<URL to go back to>
    glmsync://test?[target=<target base URL>&]code=<test code>           (1.8.0, spec/test-mode.md)
    glmsync://read?kind=hcp|pro                                          (1.11.0, spec/hcp.md; pro 1.15.0)
    Android: a bound service with the action glmsync.intent.action.SYNC, data glmsync://sync?target=…,
             extra glmsync.extra.REASON = open | manual
    https://<web app>/pair#target=<target base URL>&code=<pairing code>[&provider=<id>[,<id>…]][&kind=hcp|pro]

Parsed by hand rather than with a URL library, so that every port reads the same strings the same
way. A link is data from outside: anything unexpected makes it invalid rather than guessed at.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote_plus

CODE = re.compile(r"^[0-9A-Za-z-]{6,64}$")
PROVIDER = re.compile(r"^[a-z][a-z0-9_-]{1,39}$")
# A target: https, or http only to this machine (development). No user info, no query, no fragment.
TARGET = re.compile(r"^(?:https://[A-Za-z0-9.-]+(?::\d{1,5})?|http://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?)"
                    r"(?:/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*)?$")
SCHEME = re.compile(r"^([a-z][a-z0-9+.-]*):")
NEVER_RETURN = {"javascript", "data", "file", "vbscript", "about", "blob", "glmsync"}
LINK = re.compile(r"^glmsync://(pair|sync|test|read|signin)/?(?:\?([^#]*))?$")
MAX_LEN = 2048
# Which target API a pairing's base URL speaks (1.10.0): `lm` (the launch monitor one, also when no kind is given)
# or `hcp` (spec/hcp.md), and (1.15.0) `pro`: the handicap target API for a professional's pages (spec/prores.md). Any
# other is invalid: pairing with an API the client doesn't know would only be refused.
KINDS = {"lm", "hcp", "pro"}
# What a read link may open (1.11.0): a client's way of reading along - the handicap record (spec/hcp.md) and (1.15.0) a
# professional's own pages (spec/prores.md).
READ_KINDS = {"hcp", "pro"}
# A launch monitor target that takes only some providers names them (1.18.0): one id as before, or several separated by
# commas, at most this many; none named means any the client can connect.
MAX_PROVIDERS = 10
BAD_ESCAPE = re.compile(r"%(?![0-9A-Fa-f]{2})")  # a '%' that starts no escape: invalid, not guessed at


def _params(query: str, allowed: set[str]) -> dict[str, str] | str:
    """key=value pairs, percent- and plus-decoded; an error text for a known key given twice or
    left empty. Unknown keys are ignored (a later version may add some)."""
    out: dict[str, str] = {}
    for part in query.split("&") if query else []:
        if not part:
            continue
        if BAD_ESCAPE.search(part):
            return "invalid:encoding"
        key, _, value = part.partition("=")
        try:
            key, value = unquote_plus(key, errors="strict"), unquote_plus(value, errors="strict")
        except UnicodeDecodeError:
            return "invalid:encoding"
        if key not in allowed:
            continue
        if key in out:
            return f"duplicate:{key}"
        if not value:
            return f"empty:{key}"
        out[key] = value
    return out


def valid_target(url: str) -> bool:
    return len(url) <= MAX_LEN and bool(TARGET.fullmatch(url))


def valid_return(url: str) -> bool:
    """Where a sync may jump back to: an absolute URL of a scheme that opens an app or a page -
    https, http to this machine, or an app's own scheme; never one that runs code or reads files."""
    m = SCHEME.match(url)
    if not m or len(url) > MAX_LEN or any(c.isspace() for c in url):
        return False
    scheme = m.group(1)
    if scheme in NEVER_RETURN:
        return False
    if scheme == "http":
        return bool(re.match(r"^http://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:/|\Z)", url))
    if scheme == "https":
        return bool(re.match(r"^https://[A-Za-z0-9.-]+(?::\d{1,5})?(?:/|\Z)", url))
    return url.startswith(scheme + "://")


def providers_of(provider: str | None) -> list[str] | None:
    """The providers a link's `provider` names (1.18.0): `trackman`, or `trackman,other` - each a lower-case id, none
    twice, at most MAX_PROVIDERS. None for a value that isn't one (the link is then invalid); an empty list for no
    `provider` at all: any provider the client can connect."""
    if provider is None:
        return []
    ids = provider.split(",")
    if len(ids) > MAX_PROVIDERS or len(set(ids)) != len(ids) or not all(PROVIDER.fullmatch(i) for i in ids):
        return None
    return ids


def _key_nonce(p: dict[str, str]) -> str | None:
    """`key` and `nonce` of a sign-in question (1.27.0): both, each valid, and a way back to answer to."""
    from handover import valid_key, valid_nonce  # noqa: PLC0415 - one module of rules uses the other's

    for k in ("key", "nonce", "return"):
        if k not in p:
            return "missing:" + k
    if not valid_key(p["key"]):
        return "invalid:key"
    if not valid_nonce(p["nonce"]):
        return "invalid:nonce"
    return None


#: What a pair link's `mode` may say (1.27.0): `signin` - the target fetches itself (an engine of this project in its
#: own app); the client only signs in for this connection and hands the sign-in over (spec/deep-links.md).
LINK_MODES = {"signin"}


def _pair(p: dict[str, str]) -> dict[str, Any]:
    if "target" not in p or "code" not in p:
        return {"ok": False, "error": "missing:" + ("target" if "target" not in p else "code")}
    if not valid_target(p["target"]):
        return {"ok": False, "error": "invalid:target"}
    if not CODE.fullmatch(p["code"]):
        return {"ok": False, "error": "invalid:code"}
    if "provider" in p and providers_of(p["provider"]) is None:
        return {"ok": False, "error": "invalid:provider"}
    if "kind" in p and p["kind"] not in KINDS:
        return {"ok": False, "error": "invalid:kind"}
    if "return" in p and not valid_return(p["return"]):
        return {"ok": False, "error": "invalid:return"}
    # 1.27.0: only signing in for this connection, and the sign-in handed over at once when the link asks with a key.
    if "mode" in p:
        if p["mode"] not in LINK_MODES or p.get("kind", "lm") != "lm":
            return {"ok": False, "error": "invalid:mode"}
        if "key" in p or "nonce" in p:
            err = _key_nonce(p)
            if err:
                return {"ok": False, "error": err}
    elif "key" in p or "nonce" in p:
        return {"ok": False, "error": "unexpected:" + ("key" if "key" in p else "nonce")}
    return {"ok": True, "action": "pair",
            **{k: p[k] for k in ("target", "code", "provider", "kind", "return", "mode", "key", "nonce") if k in p}}


def _signin(p: dict[str, str]) -> dict[str, Any]:
    """1.27.0: hand the provider sign-in over to the target app that asks, sealed for its key (handover.py)."""
    for k in ("provider", "key", "nonce", "return"):
        if k not in p:
            return {"ok": False, "error": "missing:" + k}
    if "target" in p and not valid_target(p["target"]):
        return {"ok": False, "error": "invalid:target"}
    if not PROVIDER.fullmatch(p["provider"]):
        return {"ok": False, "error": "invalid:provider"}
    err = _key_nonce(p)
    if err:
        return {"ok": False, "error": err}
    if not valid_return(p["return"]):
        return {"ok": False, "error": "invalid:return"}
    return {"ok": True, "action": "signin", **{k: p[k] for k in ("target", "provider", "key", "nonce", "return") if k in p}}


def parse_link(url: str) -> dict[str, Any]:
    if not isinstance(url, str) or len(url) > MAX_LEN:
        return {"ok": False, "error": "invalid:link"}
    m = LINK.fullmatch(url)  # fullmatch: "$" alone would let a trailing newline through
    if not m:
        return {"ok": False, "error": "invalid:link"}
    action, query = m.group(1), m.group(2) or ""
    if action == "pair":
        # `return` (1.2.0): where to jump back once paired - checked against the target's return_prefixes only after
        # POST /pair, like a sync's (return_allowed).
        p = _params(query, {"target", "code", "provider", "kind", "return", "mode", "key", "nonce"})
        return p_error(p) or _pair(p)  # type: ignore[arg-type]
    if action == "signin":
        p = _params(query, {"target", "provider", "key", "nonce", "return"})
        return p_error(p) or _signin(p)  # type: ignore[arg-type]
    if action == "test":
        # 1.8.0: a test code for the pairing with `target` (or the only one); never a token, never a return.
        p = _params(query, {"target", "code"})
        if isinstance(p, str):
            return {"ok": False, "error": p}
        if "code" not in p:
            return {"ok": False, "error": "missing:code"}
        if "target" in p and not valid_target(p["target"]):
            return {"ok": False, "error": "invalid:target"}
        if not CODE.fullmatch(p["code"]):
            return {"ok": False, "error": "invalid:code"}
        return {"ok": True, "action": "test", **{k: p[k] for k in ("target", "code") if k in p}}
    if action == "read":
        # 1.11.0: open the client's way of reading along for `kind` (a companion app: its window on golf.de). It
        # never pairs, sends nothing by itself and has no `return` (one window reads for every pairing of its kind, so
        # no one target's return_prefixes could vouch for the address).
        p = _params(query, {"kind"})
        if isinstance(p, str):
            return {"ok": False, "error": p}
        if "kind" not in p:
            return {"ok": False, "error": "missing:kind"}
        if p["kind"] not in READ_KINDS:
            return {"ok": False, "error": "invalid:kind"}
        return {"ok": True, "action": "read", "kind": p["kind"]}
    p = _params(query, {"target", "return"})
    if isinstance(p, str):
        return {"ok": False, "error": p}
    if "target" in p and not valid_target(p["target"]):
        return {"ok": False, "error": "invalid:target"}
    if "return" in p and not valid_return(p["return"]):
        return {"ok": False, "error": "invalid:return"}
    return {"ok": True, "action": "sync", **{k: p[k] for k in ("target", "return") if k in p}}


def p_error(p: dict[str, str] | str) -> dict[str, Any] | None:
    return {"ok": False, "error": p} if isinstance(p, str) else None


def parse_pair_fragment(fragment: str) -> dict[str, Any]:
    """The web app's pairing page: the part after '#' (it reaches no server). No `return`: the page stays where it is."""
    if not isinstance(fragment, str) or len(fragment) > MAX_LEN:
        return {"ok": False, "error": "invalid:link"}
    p = _params(fragment[1:] if fragment.startswith("#") else fragment, {"target", "code", "provider", "kind"})
    return p_error(p) or _pair(p)  # type: ignore[arg-type]


def return_allowed(url: str, prefixes: list[str]) -> bool:
    """Whether a sync may jump back to `url`: it is a valid return URL and starts with one of the
    prefixes the target named at pairing. A prefix must end with '/' or '://', so that
    'https://app.example' can't be stretched to 'https://app.example.evil.test'."""
    if not valid_return(url):
        return False
    return any((p.endswith("/") or p.endswith("://")) and url.startswith(p) for p in prefixes)


SYNC_INTENT_REASONS = {"open", "manual"}


def parse_sync_intent(data: Any, reason: Any = None) -> dict[str, Any]:
    """What a target asks for when it binds to the companion app's sync service on Android: the intent's
    data, a sync link that names the target (and nothing to jump back to: a service opens nothing), and
    the extra glmsync.extra.REASON. A missing or unknown reason reads as manual; a target app can't
    claim a reason of the client's own (timer, connect, backfill)."""
    link = parse_link(data)
    if not link["ok"]:
        return link
    if link["action"] != "sync":
        return {"ok": False, "error": "invalid:action"}
    if "target" not in link:
        return {"ok": False, "error": "missing:target"}
    if "return" in link:
        return {"ok": False, "error": "unexpected:return"}
    return {"ok": True, "target": link["target"],
            "reason": reason if isinstance(reason, str) and reason in SYNC_INTENT_REASONS else "manual"}


# The result in the way back (since 1.22.0)
# ---------------------------------------------------------------------------

#: What a sync came to, handed to the target with the jump back (`result` added to `return`): new data handed over, a
#: sync that brought nothing new, a plan that wasn't due (the guard or the provider's pause included), a sign-in that
#: isn't ready, a client too old for the target, or anything that failed.
RESULTS = ("new", "nothing", "not_due", "signin", "outdated", "failed")


def with_result(url: str, result: str) -> str | None:
    """`return` with `result=<result>` in its query (before a fragment); a `result` it had already is dropped, so a
    target never reads two. The URL as it was when the result would make it longer than a link may be (the target then
    reads none); None for a URL that is no valid return or a result that isn't one."""
    if not isinstance(url, str) or not valid_return(url) or result not in RESULTS:
        return None
    head, hash_, frag = url.partition("#")
    path, q, query = head.partition("?")
    kept = [p for p in query.split("&") if p and p.partition("=")[0] != "result"] if q else []
    out = f"{path}?{'&'.join([*kept, f'result={result}'])}" + (hash_ + frag if hash_ else "")
    return out if len(out) <= MAX_LEN else url


def read_result(url: Any) -> str | None:
    """The result a target finds in the address it was opened at: exactly one `result` in the query, one of RESULTS.
    None for none, two, another value or an address that isn't one."""
    if not isinstance(url, str) or len(url) > MAX_LEN:
        return None
    head = url.partition("#")[0]
    if "?" not in head:
        return None
    found: list[str] = []
    for part in head.partition("?")[2].split("&"):
        key, _, value = part.partition("=")
        if key == "result":
            found.append(value)
    return found[0] if len(found) == 1 and found[0] in RESULTS else None


# Universal links (since 1.22.0)
# ---------------------------------------------------------------------------

#: The project's own https address for the pair and sync links, beside glmsync://. The phone opens the companion app
#: when it is installed (iOS Universal Links, Android App Links, vouched for by the host's .well-known files); else the
#: host's page, which shows the way to install it. A fork that publishes its own companion app has its own host.
UNIVERSAL_BASE = "https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync/link/"
UNIVERSAL = re.compile(r"^https://golf-launch-monitor-sync\.github\.io/golf-launch-monitor-sync/link/(pair|sync|signin)/?"
                       r"(?:#([^#]*))?$")


def parse_universal(url: Any) -> dict[str, Any]:
    """`https://…/link/pair#…`, `…/link/sync#…` or (1.27.0) `…/link/signin#…`: the keys of the glmsync:// link in the fragment (which no
    server sees), read by the same rules - the same answer as parse_link of `glmsync://<action>?<fragment>`. A query
    (it would reach the host's server) or another host or path: invalid."""
    if not isinstance(url, str) or len(url) > MAX_LEN:
        return {"ok": False, "error": "invalid:link"}
    m = UNIVERSAL.fullmatch(url)
    if not m:
        return {"ok": False, "error": "invalid:link"}
    return parse_link(f"glmsync://{m.group(1)}?{m.group(2) or ''}")


def universal_link(link: str) -> str | None:
    """The universal form of a valid glmsync:// pair, sync or (1.27.0) signin link (its query into the fragment); None for
    any other."""
    if not parse_link(link)["ok"]:
        return None
    m = LINK.fullmatch(link)
    if not m or m.group(1) not in ("pair", "sync", "signin"):
        return None
    out = UNIVERSAL_BASE + m.group(1) + (f"#{m.group(2)}" if m.group(2) else "")
    return out if len(out) <= MAX_LEN else None
