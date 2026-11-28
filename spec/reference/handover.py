# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Reginald Stadlbauer
"""Signing in for a target: the sealed handover (spec/deep-links.md, *Signing in for a target*; since 1.27.0).

A target app on the phone asks the companion app for the player's provider sign-in with a public key of its own
(X25519, made for this one question) and a nonce; the companion app answers in the fragment of the way back, the
sign-in sealed with NaCl's `box` (X25519, XSalsa20, Poly1305) for that key alone. An app that catches the way back
reads nothing; an app that asks without its own key gets nothing it could open.

NaCl's `box` is written out here with the standard library only, as every rule of the reference is: X25519 (RFC
7748), HSalsa20 and XSalsa20, Poly1305. It must give byte for byte what TweetNaCl's `nacl.box` gives - the vectors are
made with fixed keys so that every implementation can check that.

    public_key(secret)                                 -> the public key of a secret key (base64url)
    seal(message, key, nonce, secret)                  -> {"from", "box"}: the message sealed for `key`
    open_sealed(box, from_, nonce, secret)             -> the message, read strictly, or None
    with_answer(url, answer)                           -> the way back with the answer in its fragment, or None
    read_answer(url)                                   -> the answer a target finds in the address it was opened at
"""

from __future__ import annotations

import base64
import hmac
import json
import re
from typing import Any

from values import when

#: How a sign-in ended, in the way back: handed over sealed; the player didn't sign in; the player signed in with
#: another provider account than the one the target has connected; anything else.
RESULTS = ("sealed", "none", "other_account", "failed")
#: The answer's keys in the fragment of the way back (any other key there is the target's own and stays).
ANSWER_KEYS = ("signin", "from", "box")
#: The way back with the answer may be this long; the sealed sign-in makes it longer than a link (2048).
MAX_ANSWER = 8192
#: A provider's sign-in as it is handed over: printable ASCII without spaces, as it goes into a header.
TOKEN = re.compile(r"^[\x21-\x7e]{1,4096}$")
#: The User-Agent of the browser the player signed in with: a header value.
USER_AGENT = re.compile(r"^[\x20-\x7e]{1,512}$")
PROVIDER = re.compile(r"^[a-z][a-z0-9_-]{1,39}$")
ACCOUNT_REF = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
KEY_LEN, NONCE_LEN, TAG_LEN = 32, 24, 16
#: The sealed message: at most this many bytes before sealing.
MAX_MESSAGE = 6000


# base64url without padding, read strictly
# ---------------------------------------------------------------------------

_B64URL = re.compile(r"^[A-Za-z0-9_-]*$")


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def unb64url(text: Any, length: int | None = None, most: int | None = None) -> bytes | None:
    """The bytes of unpadded base64url, or None: only the alphabet, no padding, and only the one spelling of each value
    (the unused low bits of the last letter zero), so that every language reads a key alike."""
    if not isinstance(text, str) or not _B64URL.fullmatch(text) or len(text) % 4 == 1:
        return None
    try:
        data = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except ValueError:
        return None
    if b64url(data) != text:
        return None
    if length is not None and len(data) != length:
        return None
    if most is not None and len(data) > most:
        return None
    return data


def valid_key(text: Any) -> bool:
    """A public key in a link: 32 bytes, base64url (43 letters)."""
    return unb64url(text, KEY_LEN) is not None


def valid_nonce(text: Any) -> bool:
    """A nonce in a link: 24 bytes, base64url (32 letters)."""
    return unb64url(text, NONCE_LEN) is not None


# X25519 (RFC 7748)
# ---------------------------------------------------------------------------

_P = 2**255 - 19
_A24 = 121665


def x25519(scalar: bytes, point: bytes) -> bytes:
    k = bytearray(scalar)
    k[0] &= 248
    k[31] &= 127
    k[31] |= 64
    n = int.from_bytes(k, "little")
    u = bytearray(point)
    u[31] &= 127
    x1 = int.from_bytes(u, "little") % _P
    x2, z2, x3, z3, swap = 1, 0, x1, 1, 0
    for t in reversed(range(255)):
        bit = (n >> t) & 1
        swap ^= bit
        if swap:
            x2, x3, z2, z3 = x3, x2, z3, z2
        swap = bit
        a, b = (x2 + z2) % _P, (x2 - z2) % _P
        aa, bb = a * a % _P, b * b % _P
        e = (aa - bb) % _P
        c, d = (x3 + z3) % _P, (x3 - z3) % _P
        da, cb = d * a % _P, c * b % _P
        x3 = (da + cb) ** 2 % _P
        z3 = x1 * (da - cb) ** 2 % _P
        x2 = aa * bb % _P
        z2 = e * (aa + _A24 * e) % _P
    if swap:
        x2, x3, z2, z3 = x3, x2, z3, z2
    return (x2 * pow(z2, _P - 2, _P) % _P).to_bytes(32, "little")


_BASE = (9).to_bytes(32, "little")


def _public(secret: bytes) -> bytes:
    return x25519(secret, _BASE)


# Salsa20, HSalsa20, XSalsa20
# ---------------------------------------------------------------------------

_SIGMA = b"expand 32-byte k"
_M = 0xFFFFFFFF


def _words(b: bytes) -> list[int]:
    return [int.from_bytes(b[i:i + 4], "little") for i in range(0, len(b), 4)]


def _rounds(x: list[int]) -> list[int]:
    x = list(x)

    def q(a: int, b: int, c: int, d: int) -> None:
        def r(v: int, n: int) -> int:
            v &= _M
            return ((v << n) | (v >> (32 - n))) & _M
        x[b] ^= r(x[a] + x[d], 7)
        x[c] ^= r(x[b] + x[a], 9)
        x[d] ^= r(x[c] + x[b], 13)
        x[a] ^= r(x[d] + x[c], 18)

    for _ in range(10):
        q(0, 4, 8, 12)
        q(5, 9, 13, 1)
        q(10, 14, 2, 6)
        q(15, 3, 7, 11)
        q(0, 1, 2, 3)
        q(5, 6, 7, 4)
        q(10, 11, 8, 9)
        q(15, 12, 13, 14)
    return x


def _state(key: bytes, inp: bytes) -> list[int]:
    s, k, n = _words(_SIGMA), _words(key), _words(inp)
    return [s[0], *k[0:4], s[1], *n, s[2], *k[4:8], s[3]]


def _hsalsa20(key: bytes, inp: bytes) -> bytes:
    z = _rounds(_state(key, inp))
    return b"".join(z[i].to_bytes(4, "little") for i in (0, 5, 10, 15, 6, 7, 8, 9))


def _salsa20_stream(key: bytes, nonce8: bytes, length: int) -> bytes:
    out = bytearray()
    counter = 0
    while len(out) < length:
        st = _state(key, nonce8 + counter.to_bytes(8, "little"))
        z = _rounds(st)
        out += b"".join(((z[i] + st[i]) & _M).to_bytes(4, "little") for i in range(16))
        counter += 1
    return bytes(out[:length])


def _poly1305(msg: bytes, key: bytes) -> bytes:
    r = int.from_bytes(key[:16], "little") & 0x0FFFFFFC0FFFFFFC0FFFFFFC0FFFFFFF
    s = int.from_bytes(key[16:32], "little")
    p = (1 << 130) - 5
    acc = 0
    for i in range(0, len(msg), 16):
        acc = (acc + int.from_bytes(msg[i:i + 16] + b"\x01", "little")) * r % p
    return ((acc + s) & ((1 << 128) - 1)).to_bytes(16, "little")


def _shared(their_public: bytes, my_secret: bytes) -> bytes:
    """NaCl's box.before: HSalsa20 of the X25519 secret with a zero input."""
    return _hsalsa20(x25519(my_secret, their_public), bytes(16))


def _secretbox(msg: bytes, nonce: bytes, key: bytes) -> bytes:
    sub = _hsalsa20(key, nonce[:16])
    stream = _salsa20_stream(sub, nonce[16:], 32 + len(msg))
    c = bytes(m ^ s for m, s in zip(msg, stream[32:]))
    return _poly1305(c, stream[:32]) + c


def _secretbox_open(box: bytes, nonce: bytes, key: bytes) -> bytes | None:
    if len(box) < TAG_LEN:
        return None
    sub = _hsalsa20(key, nonce[:16])
    stream = _salsa20_stream(sub, nonce[16:], 32 + len(box) - TAG_LEN)
    tag, c = box[:TAG_LEN], box[TAG_LEN:]
    if not hmac.compare_digest(tag, _poly1305(c, stream[:32])):
        return None
    return bytes(x ^ s for x, s in zip(c, stream[32:]))


def box(msg: bytes, nonce: bytes, their_public: bytes, my_secret: bytes) -> bytes:
    """NaCl's crypto_box as TweetNaCl's `nacl.box` gives it: the 16-byte tag, then the ciphertext."""
    return _secretbox(msg, nonce, _shared(their_public, my_secret))


def box_open(sealed: bytes, nonce: bytes, their_public: bytes, my_secret: bytes) -> bytes | None:
    return _secretbox_open(sealed, nonce, _shared(their_public, my_secret))


# The handover
# ---------------------------------------------------------------------------

def public_key(secret: Any) -> str | None:
    """The public key (base64url) of a 32-byte secret key given as base64url; None for anything else."""
    raw = unb64url(secret, KEY_LEN)
    return None if raw is None else b64url(_public(raw))


def message_bytes(message: dict[str, Any]) -> bytes:
    """The message as it is sealed: compact JSON, its keys in this order, UTF-8. Only a sealer needs the order (the
    vectors pin its bytes); a reader takes the keys in any order."""
    out: dict[str, Any] = {"v": 1}
    for k in ("provider", "token", "account_ref", "expires_at", "user_agent"):
        if k in message:
            out[k] = message[k]
    return json.dumps(out, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def read_message(data: Any) -> dict[str, Any] | None:
    """The handed-over sign-in as a target reads it, strictly: an object with `v` 1, `provider`, `token`, `account_ref`
    and `user_agent`, `expires_at` when given (an RFC 3339 time, else left out). One wrong required value: none at all
    (a target never stores half a sign-in). Unknown keys are ignored; a later version may add some."""
    if not isinstance(data, dict) or data.get("v") != 1 or isinstance(data.get("v"), bool):
        return None
    provider, token, ref, ua = data.get("provider"), data.get("token"), data.get("account_ref"), data.get("user_agent")
    if not (isinstance(provider, str) and PROVIDER.fullmatch(provider)):
        return None
    if not (isinstance(token, str) and TOKEN.fullmatch(token)):
        return None
    if not (isinstance(ref, str) and ACCOUNT_REF.fullmatch(ref)):
        return None
    if not (isinstance(ua, str) and USER_AGENT.fullmatch(ua)) or ua != ua.strip():
        return None
    out: dict[str, Any] = {"provider": provider, "token": token, "account_ref": ref, "user_agent": ua}
    if "expires_at" in data and data["expires_at"] is not None:
        t = data["expires_at"]
        # Kept only as given and with its zone: a time without one could be read differently elsewhere.
        if isinstance(t, str) and when(t) == t:
            out["expires_at"] = t
    return out


def seal(message: dict[str, Any], key: Any, nonce: Any, secret: Any) -> dict[str, str] | None:
    """The sign-in sealed for the target's `key` with the link's `nonce`, under the client's own secret key made for
    this answer alone (`from` is its public key). None when the message isn't one a target would read, or a key or the
    nonce isn't one."""
    pk, n, sk = unb64url(key, KEY_LEN), unb64url(nonce, NONCE_LEN), unb64url(secret, KEY_LEN)
    if pk is None or n is None or sk is None or not isinstance(message, dict) or read_message({**message, "v": 1}) is None:
        return None
    if "expires_at" in message and (message["expires_at"] is None or when(message["expires_at"]) != message["expires_at"]):
        return None  # sealed only as a target reads it: a time it would drop isn't sealed either
    plain = message_bytes(message)
    if len(plain) > MAX_MESSAGE:
        return None
    return {"from": b64url(_public(sk)), "box": b64url(box(plain, n, pk, sk))}


def open_sealed(sealed: Any, from_: Any, nonce: Any, secret: Any) -> dict[str, Any] | None:
    """What the target reads from an answer with its secret key and the nonce of its question: the message, or None
    for anything that doesn't open (another key, another nonce, a changed byte) or doesn't read as one."""
    sk, n, pk = unb64url(secret, KEY_LEN), unb64url(nonce, NONCE_LEN), unb64url(from_, KEY_LEN)
    c = unb64url(sealed, most=TAG_LEN + MAX_MESSAGE)
    if sk is None or n is None or pk is None or c is None:
        return None
    plain = box_open(c, n, pk, sk)
    if plain is None:
        return None
    try:
        data = json.loads(plain.decode("utf-8"), parse_constant=_no_constant)
    except (UnicodeDecodeError, ValueError):
        return None
    return read_message(data)


def _no_constant(name: str) -> Any:
    raise ValueError(name)  # NaN, Infinity: not JSON


def _answer_parts(answer: Any) -> list[str] | None:
    if not isinstance(answer, dict) or answer.get("signin") not in RESULTS:
        return None
    if answer["signin"] != "sealed":
        return [f"signin={answer['signin']}"]
    if not valid_key(answer.get("from")) or unb64url(answer.get("box"), most=TAG_LEN + MAX_MESSAGE) is None:
        return None
    if len(answer["box"]) < 1:
        return None
    return ["signin=sealed", f"from={answer['from']}", f"box={answer['box']}"]


def with_answer(url: Any, answer: Any) -> str | None:
    """The way back with the answer in its fragment: after the fragment's own keys (a key of the answer it had already
    is dropped, so a target never reads two). None for a way back that isn't one (deeplinks.valid_return), an answer
    that isn't one, or one that would make the address longer than MAX_ANSWER: the client then answers `failed`."""
    from deeplinks import valid_return  # noqa: PLC0415 - one module of rules uses the other's

    parts = _answer_parts(answer)
    if not isinstance(url, str) or not valid_return(url) or parts is None:
        return None
    head, _, frag = url.partition("#")
    kept = [p for p in frag.split("&") if p and p.partition("=")[0] not in ANSWER_KEYS]
    out = f"{head}#{'&'.join([*kept, *parts])}"
    return out if len(out) <= MAX_ANSWER else None


def read_answer(url: Any) -> dict[str, str] | None:
    """The answer a target finds in the address it was opened at: exactly one `signin`, one of RESULTS; for `sealed`
    exactly one `from` (a key) and one `box`. None for none, a key twice, an unknown result or an address too long."""
    if not isinstance(url, str) or len(url) > MAX_ANSWER or "#" not in url:
        return None
    found: dict[str, list[str]] = {k: [] for k in ANSWER_KEYS}
    for part in url.partition("#")[2].split("&"):
        key, _, value = part.partition("=")
        if key in found:
            found[key].append(value)
    if len(found["signin"]) != 1 or found["signin"][0] not in RESULTS:
        return None
    result = found["signin"][0]
    if result != "sealed":
        return {"signin": result}
    if len(found["from"]) != 1 or len(found["box"]) != 1:
        return None
    frm, sealed = found["from"][0], found["box"][0]
    if not valid_key(frm) or not sealed or unb64url(sealed, most=TAG_LEN + MAX_MESSAGE) is None:
        return None
    return {"signin": "sealed", "from": frm, "box": sealed}
