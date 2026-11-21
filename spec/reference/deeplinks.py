# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""The deep links and the pairing fragment (spec/deep-links.md).

    glmsync://pair?target=<target base URL>&code=<pairing code>[&provider=<id>][&return=<URL to go back to>]
    glmsync://sync?[target=<target base URL>&]return=<URL to go back to>
    glmsync://test?[target=<target base URL>&]code=<test code>           (1.8.0, spec/test-mode.md)
    Android: a bound service with the action glmsync.intent.action.SYNC, data glmsync://sync?target=…,
             extra glmsync.extra.REASON = open | manual
    https://<web app>/pair#target=<target base URL>&code=<pairing code>[&provider=<id>]

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
LINK = re.compile(r"^glmsync://(pair|sync|test)/?(?:\?([^#]*))?$")
MAX_LEN = 2048
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


def _pair(p: dict[str, str]) -> dict[str, Any]:
    if "target" not in p or "code" not in p:
        return {"ok": False, "error": "missing:" + ("target" if "target" not in p else "code")}
    if not valid_target(p["target"]):
        return {"ok": False, "error": "invalid:target"}
    if not CODE.fullmatch(p["code"]):
        return {"ok": False, "error": "invalid:code"}
    if "provider" in p and not PROVIDER.fullmatch(p["provider"]):
        return {"ok": False, "error": "invalid:provider"}
    if "return" in p and not valid_return(p["return"]):
        return {"ok": False, "error": "invalid:return"}
    return {"ok": True, "action": "pair", **{k: p[k] for k in ("target", "code", "provider", "return") if k in p}}


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
        p = _params(query, {"target", "code", "provider", "return"})
        return p_error(p) or _pair(p)  # type: ignore[arg-type]
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
    p = _params(fragment[1:] if fragment.startswith("#") else fragment, {"target", "code", "provider"})
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
